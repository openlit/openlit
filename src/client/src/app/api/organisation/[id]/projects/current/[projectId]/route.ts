import { withAudit } from "@/lib/audit/route";
import { withPermission } from "@/lib/rbac/route";
import { setCurrentProject } from "@/lib/organisation";
import asaw from "@/utils/asaw";
import getMessage from "@/constants/messages";

async function POSTHandler(
	_request: Request,
	{ params }: { params: { id: string; projectId: string } }
) {
	const [err, res] = await asaw(
		setCurrentProject(params.id, params.projectId)
	);

	if (err) {
		const status =
			String(err).includes(getMessage().PROJECT_ACCESS_REQUIRED) ? 403 : 400;
		return Response.json(err, { status });
	}

	return Response.json(res);
}

export const POST = withAudit(withPermission("projects:read", POSTHandler));
