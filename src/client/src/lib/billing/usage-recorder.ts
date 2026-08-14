import { FeatureId } from "@/features";

export type UsageRecorderInput = {
	organisationId: string;
	projectId?: string | null;
	featureId: FeatureId;
	quantity?: number;
	periodStart: Date;
	periodEnd: Date;
};

export async function recordOrganisationUsageEvent(_input: UsageRecorderInput) {
	return null;
}
