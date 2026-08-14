import { SecretGetFilters } from "@/types/vault";
import { getSecrets } from "@/lib/platform/vault";
import { errorResponse } from "@/helpers/server/response";
import { resolveDbConfigId } from "@/helpers/server/auth";

export async function POST(request: Request) {
	const [authErr, databaseConfigId] = await resolveDbConfigId(request);
	if (authErr) {
		return Response.json({ err: authErr }, { status: 401 });
	}

	const formData = await request.json();

	const filters: SecretGetFilters = {
		key: formData.key,
		tags: formData.tags,
		databaseConfigId,
	};

	const { err, data }: any = await getSecrets(filters);
	if (err) {
		return errorResponse(err);
	}

	return Response.json(data);
}
