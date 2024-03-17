import { deleteAPIKey } from "@/lib/doku/api-key";

export async function DELETE(_: Request, context: any) {
	const { id } = context.params;
	const resp: any = await deleteAPIKey(id);
	if (resp?.err)
		return Response.json(resp.err || "Server error!", {
			status: 400,
		});
	return Response.json(resp);
}
