import { DokuParams, TimeLimit, getData } from "@/lib/doku";

export async function POST(request: Request) {
	const formData = await request.json();
	const timeLimit = formData.timeLimit as TimeLimit | null;

	const params: DokuParams = {};
	if (timeLimit) params.timeLimit = timeLimit;

	const res: any = await getData(params);
	return Response.json(res);
}
