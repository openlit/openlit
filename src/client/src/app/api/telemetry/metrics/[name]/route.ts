import { MetricParams, TimeLimit } from "@/lib/platform/common";
import { getMetricDetailRecord } from "@/lib/platform/metrics/read";

export async function POST(
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
	};

	return Response.json(
		await getMetricDetailRecord(metricName, metricType, serviceName, metricParams)
	);
}
