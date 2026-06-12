export type AuditLookupRecord = {
	id: string;
	label: string;
	description?: string | null;
};

export type AuditLookupStore = {
	actors: Record<string, AuditLookupRecord>;
	projects: Record<string, AuditLookupRecord>;
	databaseConfigs: Record<string, AuditLookupRecord>;
	targets: Record<string, AuditLookupRecord>;
	setLookups: (lookups: {
		actors?: AuditLookupRecord[];
		projects?: AuditLookupRecord[];
		databaseConfigs?: AuditLookupRecord[];
		targets?: AuditLookupRecord[];
	}) => void;
	reset: () => void;
};
