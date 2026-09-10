import { getCurrentUser } from "@/lib/session";
import { withConnectorAccess } from "@/lib/access/connector-route";
import { availableConnectorTypeDescriptors } from "@/lib/platform/connectors/catalog";

async function GETHandler() {
	const user = await getCurrentUser();
	if (!user) return Response.json("Unauthorized", { status: 401 });

	const types = availableConnectorTypeDescriptors();
	return Response.json({
		categories: ["datasource", "notification", "memory", "vector-store", "model-provider"],
		types,
	});
}

export const GET = withConnectorAccess("read", GETHandler);
