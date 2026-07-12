import type { Env } from "../env";

type CleanupRow={id:string;bucket:string;object_key:string;upload_asset_id:string|null;attempts:number};

export async function sweepAssetCleanupOutbox(env:Env,now=Date.now(),limit=100):Promise<{claimed:number;completed:number;failed:number}>{
	const rows=await env.DB.prepare("SELECT id,bucket,object_key,upload_asset_id,attempts FROM asset_cleanup_outbox WHERE status IN ('pending','retry') AND next_attempt_at<=? ORDER BY next_attempt_at,id LIMIT ?").bind(now,limit).all<CleanupRow>();
	let claimed=0,completed=0,failed=0;
	for(const row of rows.results){
		const claim=await env.DB.prepare("UPDATE asset_cleanup_outbox SET status='processing',attempts=attempts+1 WHERE id=? AND status IN ('pending','retry') AND next_attempt_at<=?").bind(row.id,now).run();
		if((claim.meta.changes??0)!==1)continue;
		claimed++;
		try{
			const bucket=row.bucket==='assets'?env.ASSETS_BUCKET:row.bucket==='renders'?env.RENDERS_BUCKET:row.bucket==='exports'?env.EXPORTS_BUCKET:env.UPLOADS_BUCKET;
			await bucket.delete(row.object_key);
			if(row.upload_asset_id)await env.DB.prepare("DELETE FROM user_upload_assets WHERE id=?").bind(row.upload_asset_id).run();
			await env.DB.prepare("UPDATE asset_cleanup_outbox SET status='completed',completed_at=?,last_error=NULL WHERE id=?").bind(Date.now(),row.id).run();completed++;
		}catch(error){
			const next=Date.now()+Math.min(24*60*60_000,30_000*2**Math.min(row.attempts,10));
			await env.DB.prepare("UPDATE asset_cleanup_outbox SET status='retry',next_attempt_at=?,last_error=? WHERE id=?").bind(next,error instanceof Error?error.message.slice(0,500):String(error).slice(0,500),row.id).run();failed++;
		}
	}
	return{claimed,completed,failed};
}
