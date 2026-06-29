import { getPrompts } from "@/lib/platform/prompt";
import { errorResponse } from "@/helpers/server/response";

export async function POST() {
	const { err, data }: any = await getPrompts();
	if (err) {
		return errorResponse(err);
	}

	return Response.json(data);
}
