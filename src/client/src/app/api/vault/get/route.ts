import { SecretGetFilters } from "@/types/vault";
import { getSecrets } from "@/lib/platform/vault";
import { errorResponse } from "@/helpers/server/response";

export async function POST(request: Request) {
	const formData = await request.json();

	const filters: SecretGetFilters = {
		key: formData.key,
		tags: formData.tags,
	};

	const { err, data }: any = await getSecrets(filters);
	if (err) {
		return errorResponse(err);
	}

	return Response.json(data);
}
