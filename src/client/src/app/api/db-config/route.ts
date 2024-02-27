import { getDBConfigByUser, upsertDBConfig } from "@/lib/db-config";
import asaw from "@/utils/asaw";

export async function GET() {
	const [err, res]: any = await asaw(getDBConfigByUser());
	if (err)
		return Response.json(err, {
			status: 400,
		});

	return Response.json(res);
}

export async function POST(request: Request) {
	const formData = await request.json();
	const id = formData.id;
	const name = formData.name;
	const environment = formData.environment;
	const meta = formData.meta;

	const [err, res]: any = await asaw(
		upsertDBConfig({ name, environment, meta }, id)
	);

	if (err)
		return Response.json(err, {
			status: 400,
		});

	return Response.json(res);
}
