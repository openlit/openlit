import {
	acceptInvitation,
	declineInvitation,
	cancelInvitation,
} from "@/lib/organisation";
import asaw from "@/utils/asaw";

// Accept invitation
export async function POST(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	const { id } = await params;

	const [err, res] = await asaw(acceptInvitation(id));

	if (err)
		return Response.json(err, {
			status: 400,
		});

	return Response.json(res);
}

// Decline or cancel invitation
export async function DELETE(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	const { id } = await params;
	const url = new URL(request.url);
	const isCancel = url.searchParams.get("cancel") === "true";

	const [err, res] = await asaw(
		isCancel ? cancelInvitation(id) : declineInvitation(id)
	);

	if (err)
		return Response.json(err, {
			status: 400,
		});

	return Response.json(res);
}
