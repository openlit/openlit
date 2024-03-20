import { createConnection, getConnection } from "@/lib/doku/connection";

export async function GET() {
	const { err, data }: any = await getConnection();
	if (err)
		return Response.json(err, {
			status: 400,
		});
	return Response.json(data);
}

export async function POST(request: Request) {
	const formData = await request.json();

	const { err, data }: any = await createConnection(formData);
	if (err)
		return Response.json(err, {
			status: 400,
		});

	return Response.json(data);
}
