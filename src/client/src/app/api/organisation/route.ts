import {
	createOrganisation,
	getOrganisationsByUser,
} from "@/lib/organisation";
import asaw from "@/utils/asaw";
import { errorResponse } from "@/helpers/server/response";

export async function GET() {
	const [err, res] = await asaw(getOrganisationsByUser());
	if (err)
		return errorResponse(err);

	return Response.json(res);
}

export async function POST(request: Request) {
	const formData = await request.json();
	const { name } = formData;

	if (!name) {
		return errorResponse("Name is required");
	}

	const [err, res] = await asaw(createOrganisation(name));

	if (err)
		return errorResponse(err);

	return Response.json(res);
}
