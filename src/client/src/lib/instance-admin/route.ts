import getMessage from "@/constants/messages";
import { getCurrentUser } from "@/lib/session";
// Alias import so enterprise can replace how admins are resolved.
import { isInstanceAdminUser } from "@/lib/instance-admin";

type RouteHandler = (request: any, context: any) => Promise<Response> | Response;

// Middleware rejects non-admin tokens early, but the token claim can be stale,
// so every instance admin route re-checks against the database.
export function withInstanceAdmin<THandler extends RouteHandler>(handler: THandler): THandler {
	return (async (request: Request, context: unknown) => {
		const messages = getMessage();
		const user = await getCurrentUser();
		if (!user) {
			return Response.json({ error: messages.UNAUTHORIZED_USER }, { status: 401 });
		}
		if (!(await isInstanceAdminUser(user.id))) {
			return Response.json({ error: messages.INSTANCE_ADMIN_REQUIRED }, { status: 403 });
		}
		return handler(request, context);
	}) as THandler;
}
