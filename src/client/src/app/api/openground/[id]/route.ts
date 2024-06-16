import { getOpengroundRequest } from "@/lib/platform/openground";

export async function GET(_: Request, { params }: { params: { id: string } }) {
	const response = await getOpengroundRequest(params.id);
	return Response.json(response);
}
