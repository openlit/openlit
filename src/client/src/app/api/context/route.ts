import { SERVER_EVENTS } from "@/constants/events";
import { ContextInput } from "@/types/context";
import { getContexts, createContext } from "@/lib/platform/context";
import PostHogServer from "@/lib/posthog";
import asaw from "@/utils/asaw";

export async function GET() {
	const startTimestamp = Date.now();
	const { err, data }: any = await getContexts();
	if (err) {
		PostHogServer.fireEvent({
			event: SERVER_EVENTS.CONTEXT_LIST_FAILURE,
			startTimestamp,
		});
		return Response.json(err, { status: 400 });
	}

	PostHogServer.fireEvent({
		event: SERVER_EVENTS.CONTEXT_LIST_SUCCESS,
		startTimestamp,
	});
	return Response.json(data);
}

export async function POST(request: Request) {
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
