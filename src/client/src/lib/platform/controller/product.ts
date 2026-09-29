import { getOpenLitEdition } from "@/lib/edition";

/** Controller control plane is EE/cloud only. The Go agent stays OSS. */
export function isControllerProductEnabled(): boolean {
	return getOpenLitEdition() !== "oss";
}

export function controllerProductDisabledResponse(): Response {
	return Response.json({ error: "Not found" }, { status: 404 });
}

type RouteHandler = (...args: never[]) => Promise<Response> | Response;

export function withControllerProduct<T extends RouteHandler>(handler: T): T {
	return (async (...args: Parameters<T>) => {
		if (!isControllerProductEnabled()) {
			return controllerProductDisabledResponse();
		}
		return handler(...args);
	}) as T;
}
