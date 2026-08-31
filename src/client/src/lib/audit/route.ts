type RouteHandler = (
	request: any,
	context: any
) => Promise<Response> | Response;

export type DirectAuditEvent = {
	action: string;
	targetType?: string;
	targetId?: string;
	metadata?: Record<string, unknown>;
};

export function withAudit<THandler extends RouteHandler>(
	handler: THandler
): THandler {
	return handler;
}

export async function recordAuditEvent(_event: DirectAuditEvent): Promise<void> {}
