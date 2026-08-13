type RouteHandler = (
	request: any,
	context: any
) => Promise<Response> | Response;

export function withAudit<THandler extends RouteHandler>(
	handler: THandler
): THandler {
	return handler;
}
