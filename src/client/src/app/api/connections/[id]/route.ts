import { deleteConnection } from "@/lib/doku/connection";

export async function DELETE(_: Request, context: any) {
	const { id } = context.params;
	const resp: any = await deleteConnection(id);
	if (resp?.err)
		return Response.json(resp.err || "Server error!", {
			status: 400,
		});
	return Response.json(resp);
}
