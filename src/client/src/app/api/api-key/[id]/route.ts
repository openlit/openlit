import { deleteAPIKey } from "@/lib/platform/api-keys/index";
import asaw from "@/utils/asaw";

export async function DELETE(_: Request, context: any) {
	const { id } = context.params;
	const [err, res] = await asaw(deleteAPIKey(id));
	if (err) {
		return Response.json("Failed to delete API key", {
			status: 400,
		});
	}

	return Response.json({ success: true });
}
