type RouteHandler = (
	request: any,
	context: any
) => Promise<Response> | Response;

export async function requireCurrentOrganisationPermission(_permission: string) {
	return null;
}

export async function requireCurrentOrganisationEntitledPermission(
	_featureId: string,
	_permission: string
) {
	return null;
}

export function withCurrentOrganisationPermission<THandler extends RouteHandler>(
	_permission: string,
	handler: THandler
): THandler {
	return handler;
}
