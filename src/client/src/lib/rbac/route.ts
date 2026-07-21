import { getCurrentUser } from "@/lib/session";
import getMessage from "@/constants/messages";
import { getDBConfigByIdForUser } from "@/lib/db-config";
import {
	getCurrentOrganisation,
	getCurrentProjectForOrganisation,
} from "@/lib/organisation";
import { OPENLIT_CONTEXT_HEADERS } from "@/constants/openlit-context";

type RouteContext = {
	params?: Record<string, string> | Promise<Record<string, string>>;
};

type RouteHandler = (
	request: any,
	context: any
) => Promise<Response> | Response;

function firstString(...values: unknown[]) {
	for (const value of values) {
		if (typeof value === "string" && value.trim()) return value;
	}
	return undefined;
}

function extractDatabaseConfigId(body: any, request: Request) {
	const selectedConfig = body?.selectedConfig;
	return firstString(
		body?.databaseConfigId,
		body?.dbConfigId,
		typeof selectedConfig === "string" ? selectedConfig : undefined,
		selectedConfig?.databaseConfigId,
		selectedConfig?.dbConfigId,
		request.headers?.get?.(OPENLIT_CONTEXT_HEADERS.databaseConfigId)
	);
}

export function withPermission<THandler extends RouteHandler>(
	_permission: string,
	handler: THandler
): THandler {
	return handler;
}

export function withEntitledPermission<THandler extends RouteHandler>(
	_featureId: string,
	_permission: string,
	handler: THandler
): THandler {
	return handler;
}

export function withDbConfigAccess<THandler extends RouteHandler>(
	handler: THandler
): THandler {
	return (async (request: Request, context: RouteContext = {}) => {
		const messages = getMessage();
		const user = await getCurrentUser();
		if (!user) return Response.json({ error: messages.UNAUTHORIZED_USER }, { status: 401 });

		const body =
			typeof request.clone === "function"
				? await request.clone().json().catch(() => ({}))
				: {};
		const databaseConfigId = extractDatabaseConfigId(body, request);
		if (!databaseConfigId) {
			const currentOrganisation = await getCurrentOrganisation();
			const currentProject = currentOrganisation?.id
				? await getCurrentProjectForOrganisation(currentOrganisation.id)
				: null;

			if (currentOrganisation?.id && !currentProject?.id) {
				return Response.json(
					{ error: messages.PROJECT_ACCESS_REQUIRED },
					{ status: 403 }
				);
			}

			return handler(request, context);
		}

		const dbConfig = await getDBConfigByIdForUser({
			id: databaseConfigId,
			userId: user.id,
		});
		if (!dbConfig) {
			return Response.json(
				{ error: messages.PROJECT_ACCESS_REQUIRED },
				{ status: 403 }
			);
		}

		return handler(request, context);
	}) as THandler;
}
