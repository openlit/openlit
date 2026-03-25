import { ContextInput } from "@/types/context";
import { getContexts, createContext } from "@/lib/platform/context";
import asaw from "@/utils/asaw";

export async function GET() {
	const { err, data }: any = await getContexts();
	if (err) {
		return Response.json(err, { status: 400 });
	}

	return Response.json(data);
}

export async function POST(request: Request) {
	const formData = await request.json();

	const contextInput: Partial<ContextInput> = {
		name: formData.name,
		content: formData.content,
		description: formData.description,
		tags: formData.tags,
		meta_properties: formData.meta_properties,
		status: formData.status,
	};

	const [err, res]: any = await asaw(createContext(contextInput));
	if (err) {
		return Response.json(err, { status: 400 });
	}

	return Response.json(res);
}
