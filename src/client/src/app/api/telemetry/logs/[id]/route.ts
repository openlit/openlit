import { getLogByRowId } from "@/lib/platform/logs/read";
import { getRequestEnvironment } from "@/constants/openlit-context";
import { withRouteAccess } from "@/lib/access/route-access";

async function GETHandler(
	request: Request,
	{ params }: { params: { id: string } }
) {
	const url = new URL(request.url);
	const aroundTimestamp =
		url.searchParams.get("aroundTimestamp") || undefined;
	const sourceId = url.searchParams.get("sourceId") || undefined;
	const environment =
		url.searchParams.get("environment") ||
		getRequestEnvironment(request) ||
		undefined;

	try {
		return Response.json(
			await getLogByRowId(params.id, {
				aroundTimestamp,
				sourceId: sourceId || undefined,
				environment: environment || undefined,
			})
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return Response.json(
			{ err: message, code: "TELEMETRY_SOURCE_UNAVAILABLE" },
			{ status: 503 }
		);
	}
}

export const GET = withRouteAccess("logs.read", GETHandler, {
	requireDbConfig: true,
});
