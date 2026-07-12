export type AdminUser = {
	id: string;
	email: string;
	name: string;
	isSuperAdmin: boolean;
	permissions: readonly string[];
};

export type AppBindings = {
	Bindings: Cloudflare.Env;
	Variables: {
		adminUser: AdminUser;
		requestId: string;
	};
};
