import { withDbConfigAccess } from "@/lib/rbac/route";

type RouteHandler = (
	request: any,
	context: any
) => Promise<Response> | Response;

export type RouteAccessKey = string;

export async function requireRouteAccess(_access: RouteAccessKey) {
	return null;
}

export function withRouteAccess<THandler extends RouteHandler>(
	_access: RouteAccessKey,
	handler: THandler,
	options: { requireDbConfig?: boolean } = {}
): THandler {
	if (options.requireDbConfig) {
		return withDbConfigAccess(handler);
	}
	return handler;
}
