export interface Context {
	id: string;
	name: string;
	content: string;
	description: string;
	tags: string;
	meta_properties: string;
	status: "ACTIVE" | "INACTIVE";
	created_by: string;
	created_at: string;
	updated_at: string;
}

export interface ContextInput {
	id?: string;
	name: string;
	content: string;
	description?: string;
	tags?: string;
	meta_properties?: string;
	status?: "ACTIVE" | "INACTIVE";
}
