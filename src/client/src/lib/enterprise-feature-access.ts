export type EnterpriseFeatureOrganisation = {
	id: string;
	name: string;
	role: string;
	plan?: string;
	status?: string;
	isCurrent?: boolean;
};

export type EnterpriseFeatureAccount = EnterpriseFeatureOrganisation;

export type EnterpriseFeatureAccessSnapshot = {
	accounts: EnterpriseFeatureOrganisation[];
	selectedAccountId: string;
	accessByAccountId: Record<string, Record<string, boolean | undefined>>;
};

export async function getEnterpriseFeatureAccessSnapshot(): Promise<EnterpriseFeatureAccessSnapshot> {
	return {
		accounts: [],
		selectedAccountId: "",
		accessByAccountId: {},
	};
}
