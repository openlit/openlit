import { generateAPIKey, getAPIKeys } from "@/lib/api-key";

export async function GET() {
	const res: any = await getAPIKeys();
	return Response.json(res);
}

export async function POST(request: Request) {
	const formData = await request.json();
	const name = formData.name;

	if (!name)
		return Response.json("Please provide a name for the key", {
			status: 400,
		});

	const [err, res]: any = await generateAPIKey({ name });
	if (err)
		return Response.json(err, {
			status: 400,
		});

	return Response.json(res);
}
