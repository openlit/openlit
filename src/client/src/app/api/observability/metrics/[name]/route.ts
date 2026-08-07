import { MetricParams, TimeLimit } from "@/lib/platform/common";
import { getMetricDetailRecord } from "@/lib/platform/metrics/read";
import { getRequestEnvironment } from "@/constants/openlit-context";
import { withRouteAccess } from "@/lib/access/route-access";

async function POSTHandler(
	request: Request,
	{ params }: { params: { name: string } }
) {
	const formData = await request.json();
	const metricName = decodeURIComponent(params.name);
	const metricType = formData.metricType as string | undefined;
	const serviceName = formData.serviceName as string | undefined;
	const metricParams: MetricParams = {
		timeLimit: formData.timeLimit as TimeLimit,
		selectedConfig: formData.selectedConfig || {},
		environment: typeof formData.environment === "string" ? formData.environment : getRequestEnvironment(request),
	};

	return Response.json(
		await getMetricDetailRecord(metricName, metricType, serviceName, metricParams)
	);
}

export const POST = withRouteAccess("observability.read", POSTHandler, { requireDbConfig: true });
