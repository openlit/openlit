type RouteHandler = (
	request: any,
	context: any
) => Promise<Response> | Response;

function passthrough<THandler extends RouteHandler>(handler: THandler): THandler {
	return handler;
}

export const withOtterReadAccess = passthrough;
export const withOtterChatAccess = passthrough;
export const withOtterConfigureAccess = passthrough;
export const withOtterDbReadAccess = passthrough;
export const withOtterDbChatAccess = passthrough;
