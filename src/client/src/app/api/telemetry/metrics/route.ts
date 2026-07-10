import { MetricParams, TimeLimit } from "@/lib/platform/common";
import { getMetrics, getMetricsConfig } from "@/lib/platform/observability";
import {
	validateMetricsRequest,
	validateMetricsRequestType,
} from "@/helpers/server/platform";
import { resolveDbConfigId } from "@/helpers/server/auth";

export async function POST(request: Request) {
	try {
		const [authErr, databaseConfigId] = await resolveDbConfigId(request);
		if (authErr) {
			return Response.json({ err: authErr }, { status: 401 });
		}

		const formData = await request.json();
		const limit = formData.limit || 25;
		const offset = formData.offset || 0;
		const params: MetricParams = {
			timeLimit: formData.timeLimit as TimeLimit,
			limit,
			offset,
			selectedConfig: formData.selectedConfig || {},
			sorting: formData.sorting || {},
			databaseConfigId,
		};

		const validation = validateMetricsRequest(
			params,
			validateMetricsRequestType.GET_ALL
		);
		if (!validation.success) return Response.json(validation.err, { status: 400 });

		const res: any = await getMetrics(params);

		const { searchParams } = new URL(request.url);
		const includeFilters = (searchParams.get("includeFilters") === "true") || (formData.includeFilters === true);

		if (includeFilters && !res.err) {
			const configRes = await getMetricsConfig(params);
			res.pagination = { limit, offset, total: res.total || 0 };
			res.filters = (configRes.data as any)?.[0] || {};
		}

		return Response.json(res);
	} catch (error: any) {
		console.error("Error in telemetry metrics route:", error);
		return Response.json({ err: error.message || "Internal Server Error" }, { status: 500 });
	}
}
