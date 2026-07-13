export type StoredAuthSession = {
	session: { expiresAt: string | number | Date };
	user: { id: string };
};

export function sessionKeyFromBearerToken(token: string): string {
	return token.split(".", 1)[0]?.trim() ?? "";
}

export function parseStoredAdminSession(value: string, now = Date.now()): StoredAuthSession | null {
	try {
		const parsed = JSON.parse(value) as Partial<StoredAuthSession>;
		const expiresAt = new Date(parsed.session?.expiresAt ?? Number.NaN).getTime();
		if (!parsed.session || !parsed.user?.id || !Number.isFinite(expiresAt) || expiresAt <= now) return null;
		return parsed as StoredAuthSession;
	} catch {
		return null;
	}
}
