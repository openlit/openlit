import { evaluate } from "@/lib/platform/evaluate";

export async function POST(request: Request) {
	const formData = await request.json();

	const response = await evaluate(formData);
	return Response.json(response);
}
