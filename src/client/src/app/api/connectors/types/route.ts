import { getCurrentUser } from "@/lib/session";
import { withConnectorAccess } from "@/lib/access/connector-route";
import { availableConnectorTypeDescriptors } from "@/lib/platform/connectors/catalog";
import { overlayScannerConfigFields } from "@/lib/platform/connectors/scanner/cli-schema";
import { trustablConfigFields } from "@/lib/platform/connectors/scanner/config-fields";
import { probeTrustablRuntime } from "@/lib/platform/connectors/scanner/runtime";

async function GETHandler() {
	const user = await getCurrentUser();
	if (!user) return Response.json("Unauthorized", { status: 401 });

	const types = availableConnectorTypeDescriptors();
	const runtime = await probeTrustablRuntime().catch(() => null);
	return Response.json({
		categories: ["datasource", "notification", "memory", "scanner", "repository", "vector-store", "model-provider"],
		types: overlayScannerConfigFields(
			types,
			runtime?.schema ? trustablConfigFields(runtime.schema) : undefined
		),
	});
}

export const GET = withConnectorAccess("read", GETHandler);
