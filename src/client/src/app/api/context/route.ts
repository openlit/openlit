import { withAudit } from "@/lib/audit/route";
import { SERVER_EVENTS } from "@/constants/events";
import { ContextInput } from "@/types/context";
import { getContexts, createContext } from "@/lib/platform/context";
import PostHogServer from "@/lib/posthog";
import asaw from "@/utils/asaw";
import { withRouteAccess } from "@/lib/access/route-access";

async function GETHandler() {
	const { err, data }: any = await getContexts();
	if (err) {
		return Response.json(err, { status: 400 });
	}

	return Response.json(data);
}

async function POSTHandler(request: Request) {
	const startTimestamp = Date.now();
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
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.CONTEXT_CREATE_FAILURE,
			startTimestamp,
		});
		return Response.json(err, { status: 400 });
	}

	PostHogServer.fireEvent({
		event: SERVER_EVENTS.CONTEXT_CREATE_SUCCESS,
		startTimestamp,
	});
	return Response.json(res);
}

export const GET = withRouteAccess("context.read", GETHandler);
export const POST = withAudit(withRouteAccess("context.create", POSTHandler));
