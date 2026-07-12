/**
 * Safety net for a Worker/Workflow failure between credit reservation and
 * settlement. The normal P-Video workflow owns this path; the cron only
 * touches reservations that are both expired and well beyond the maximum
 * expected processing window. Every mutation is conditional and keyed by the
 * job, so retries cannot mint a second refund.
 */
const MAX_ROWS = 50;
const STALE_AFTER_MS = 2 * 60 * 60 * 1000;

type StaleReservation = { job_id: string; user_id: string; amount: number; project_id: string | null };

export async function reconcileExpiredCreditReservations(db: D1Database, now = Date.now()): Promise<{ scanned: number; released: number }> {
	const cutoff = now - STALE_AFTER_MS;
	const rows = await db.prepare(`
		SELECT r.job_id, r.user_id, r.amount, j.project_id
		FROM credit_reservations r
		JOIN generation_jobs j ON j.id = r.job_id
		WHERE r.status = 'reserved'
		  AND r.expires_at <= ?1
		  AND j.updated_at <= ?2
		  AND j.status NOT IN ('completed', 'failed', 'cancelled')
		ORDER BY r.expires_at ASC
		LIMIT ?3
	`).bind(now, cutoff, MAX_ROWS).all<StaleReservation>();

	let released = 0;
	for (const row of rows.results) {
		const operationKey = `generation:${row.job_id}:reconcile-release`;
		const transactionId = `tx_reconcile_release_${row.job_id}`;
		const notificationId = `notification_${row.job_id}_reconciled`;
		const result = await db.batch([
			db.prepare(`
				INSERT OR IGNORE INTO token_transactions
					(id, user_id, amount, type, description, project_id, operation_key, created_at)
				SELECT ?1, user_id, amount, 'generation_refund', ?2, ?3, ?4, ?5
				FROM credit_reservations
				WHERE job_id = ?6 AND user_id = ?7 AND status = 'reserved' AND expires_at <= ?5
				  AND NOT EXISTS (SELECT 1 FROM token_transactions WHERE operation_key = ?4)
			`).bind(transactionId, `Released stale generation reservation ${row.job_id}`, row.project_id, operationKey, now, row.job_id, row.user_id),
			db.prepare(`
				UPDATE user SET tokens = tokens + (
					SELECT amount FROM credit_reservations WHERE job_id = ?1 AND user_id = ?2 AND status = 'reserved'
				), updated_at = ?3
				WHERE id = ?2 AND EXISTS (SELECT 1 FROM token_transactions WHERE id = ?5 AND operation_key = ?4)
				  AND EXISTS (SELECT 1 FROM credit_reservations WHERE job_id = ?1 AND user_id = ?2 AND status = 'reserved' AND expires_at <= ?3)
			`).bind(row.job_id, row.user_id, now, operationKey, transactionId),
			db.prepare(`
				UPDATE credit_reservations SET status = 'released', settlement_transaction_id = ?1, settled_at = ?2, updated_at = ?2
				WHERE job_id = ?3 AND user_id = ?4 AND status = 'reserved' AND expires_at <= ?2
			`).bind(transactionId, now, row.job_id, row.user_id),
			db.prepare(`
				UPDATE generation_jobs SET status = 'failed', error_code = 'reservation_expired', error_message = 'Generation timed out before settlement; reserved credits were returned.', updated_at = ?1
				WHERE id = ?2 AND user_id = ?3 AND status NOT IN ('completed', 'failed', 'cancelled') AND updated_at <= ?4
			`).bind(now, row.job_id, row.user_id, cutoff),
			db.prepare(`
				INSERT OR IGNORE INTO notifications
					(id, user_id, type, title, message, project_id, job_id, deep_link, dedupe_key, metadata, is_read, push_sent, email_sent, created_at)
				VALUES (?1, ?2, 'generation_failed', 'Generation timed out', 'Your reserved credits were returned. You can try again.', ?3, ?4, ?5, ?6, ?7, 0, 0, 0, ?8)
			`).bind(notificationId, row.user_id, row.project_id, row.job_id, `/generation/${row.job_id}`, `generation-reconciled:${row.job_id}`, JSON.stringify({ reason: 'reservation_expired' }), now),
		]);
		const reservationUpdate = result[2]?.meta.changes ?? 0;
		if (reservationUpdate > 0) released += 1;
	}
	return { scanned: rows.results.length, released };
}
