const REDACTED_KEYS = /token|secret|password|credential|authorization|cookie|api[-_]?key/i;

export function sanitizeAuditValue(value: unknown, depth = 0): unknown {
	if (depth > 5) return "[truncated]";
	if (value === null || typeof value === "boolean" || typeof value === "number") return value;
	if (typeof value === "string") return value.length > 500 ? `${value.slice(0, 500)}…` : value;
	if (Array.isArray(value)) return value.slice(0, 30).map((item) => sanitizeAuditValue(item, depth + 1));
	if (typeof value === "object") {
		const result: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(value).slice(0, 50)) result[key] = REDACTED_KEYS.test(key) ? "[redacted]" : sanitizeAuditValue(item, depth + 1);
		return result;
	}
	return String(value);
}
