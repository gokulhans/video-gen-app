export type Env = {
	DB: D1Database;
	KV: KVNamespace;
	ASSETS: Fetcher;
	AUTH_API_URL?: string;
};

export type AdminUser = {
	id: string;
	email: string;
	name: string;
};

export type AppBindings = {
	Bindings: Env;
	Variables: {
		adminUser: AdminUser;
	};
};
