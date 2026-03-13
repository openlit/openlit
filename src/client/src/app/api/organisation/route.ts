import {
	createOrganisation,
	getOrganisationsByUser,
} from "@/lib/organisation";
import asaw from "@/utils/asaw";

export async function GET() {
	const [err, res] = await asaw(getOrganisationsByUser());
	if (err)
		return Response.json(err, {
			status: 400,
		});

	return Response.json(res);
}

export async function POST(request: Request) {
	const formData = await request.json();
	const { name } = formData;

	if (!name) {
		return Response.json("Name is required", {
			status: 400,
		});
	}

	const [err, res] = await asaw(createOrganisation(name));

	if (err)
		return Response.json(err, {
			status: 400,
		});

	return Response.json(res);
}
