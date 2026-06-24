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
	_options: { requireDbConfig?: boolean } = {}
): THandler {
	return handler;
}
