import { ContextInput } from "@/types/context";
import { getContextById, updateContext, deleteContext } from "@/lib/platform/context";
import asaw from "@/utils/asaw";

export async function GET(_: Request, context: any) {
	const { id } = context.params;
	const { err, data }: any = await getContextById(id);
	if (err) {
		return Response.json(err, { status: 400 });
	}

	return Response.json(data);
}

export async function PUT(request: Request, context: any) {
	const { id } = context.params;
	const formData = await request.json();

	const contextInput: Partial<ContextInput> = {
		name: formData.name,
		content: formData.content,
		description: formData.description,
		tags: formData.tags,
		meta_properties: formData.meta_properties,
		status: formData.status,
	};

	const [err, res]: any = await asaw(updateContext(id, contextInput));
	if (err) {
		return Response.json(err, { status: 400 });
	}

	return Response.json(res);
}

export async function DELETE(_: Request, context: any) {
	const { id } = context.params;
	const [err, res] = await deleteContext(id);
	if (err) {
		return Response.json(err, { status: 400 });
	}

	return Response.json(res);
}
