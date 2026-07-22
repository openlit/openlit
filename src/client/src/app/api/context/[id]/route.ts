import { withAudit } from "@/lib/audit/route";
import { SERVER_EVENTS } from "@/constants/events";
import { ContextInput } from "@/types/context";
import { getContextById, updateContext, deleteContext } from "@/lib/platform/context";
import PostHogServer from "@/lib/posthog";
import asaw from "@/utils/asaw";
import { withRouteAccess } from "@/lib/access/route-access";

async function GETHandler(_: Request, context: any) {
	const { id } = context.params;
	const { err, data }: any = await getContextById(id);
	if (err) {
		return Response.json(err, { status: 400 });
	}

	return Response.json(data);
}

async function PUTHandler(request: Request, context: any) {
	const startTimestamp = Date.now();
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
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.CONTEXT_UPDATE_FAILURE,
			startTimestamp,
		});
		return Response.json(err, { status: 400 });
	}

	PostHogServer.fireEvent({
		event: SERVER_EVENTS.CONTEXT_UPDATE_SUCCESS,
		startTimestamp,
	});
	return Response.json(res);
}

async function DELETEHandler(_: Request, context: any) {
	const startTimestamp = Date.now();
	const { id } = context.params;
	const [err, res] = await deleteContext(id);
	if (err) {
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.CONTEXT_DELETE_FAILURE,
			startTimestamp,
		});
		return Response.json(err, { status: 400 });
	}

	PostHogServer.fireEvent({
		event: SERVER_EVENTS.CONTEXT_DELETE_SUCCESS,
		startTimestamp,
	});
	return Response.json(res);
}

export const GET = withRouteAccess("context.read", GETHandler);
export const PUT = withAudit(withRouteAccess("context.update", PUTHandler));
export const DELETE = withAudit(withRouteAccess("context.delete", DELETEHandler));
