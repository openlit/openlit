import { generateOrReturnAPIKey } from "@/lib/platform/prompt/api-keys";
import asaw from "@/utils/asaw";

export async function POST() {
	const [err, res]: any = await asaw(generateOrReturnAPIKey());

	if (err)
		return Response.json(err, {
			status: 400,
		});

	return Response.json(res);
}
