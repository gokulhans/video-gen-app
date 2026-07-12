export const ADMIN_PERMISSIONS = [
	"catalog.read", "catalog.write", "catalog.publish",
	"providers.read", "providers.write", "providers.publish",
	"pricing.read", "pricing.write", "pricing.publish",
	"voices.read", "voices.write", "characters.read", "characters.write", "characters.moderate",
	"jobs.read", "audit.read", "legacy.read", "legacy.write",
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

export function parsePermissions(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return [...new Set(value.filter((item): item is string => typeof item === "string" && item.length <= 100))];
}

export function can(user: { isSuperAdmin: boolean; permissions: readonly string[] }, permission: AdminPermission): boolean {
	return user.isSuperAdmin || user.permissions.includes("*") || user.permissions.includes(permission);
}
