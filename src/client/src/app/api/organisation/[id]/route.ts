import {
	getOrganisationById,
	updateOrganisation,
	deleteOrganisation,
} from "@/lib/organisation";
import asaw from "@/utils/asaw";

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	const { id } = await params;

	const [err, res] = await asaw(getOrganisationById(id));
	if (err)
		return Response.json(err, {
			status: 400,
		});

	return Response.json(res);
}

export async function PUT(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	const { id } = await params;
	const formData = await request.json();

	const [err, res] = await asaw(
		updateOrganisation(id, { name: formData.name })
	);

	if (err)
		return Response.json(err, {
			status: 400,
		});

	return Response.json(res);
}

export async function DELETE(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	const { id } = await params;

	const [err, res] = await asaw(deleteOrganisation(id));

	if (err)
		return Response.json(err, {
			status: 400,
		});

	return Response.json(res);
}
