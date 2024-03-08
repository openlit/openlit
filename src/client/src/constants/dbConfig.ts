export type DatabaseConfig = {
	id: string;
	name: string;
	environment: string;
	username: string;
	password?: string;
	host: string;
	port: string;
	database: string;
	query?: string;
};
