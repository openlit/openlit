import { MetricParams, TimeLimit } from "@/lib/platform/common";
import { getRequests, getRequestsConfig } from "@/lib/platform/request";
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
		const timeLimit = formData.timeLimit as TimeLimit;
		const limit = formData.limit || 10;
		const offset = formData.offset || 0;
		const selectedConfig = formData.selectedConfig || {};
		const sorting = formData.sorting || {};

		const params: MetricParams = {
			timeLimit,
			limit,
			offset,
			selectedConfig,
			sorting,
			databaseConfigId,
		};

		const validationParam = validateMetricsRequest(
			params,
			validateMetricsRequestType.GET_ALL
		);

		if (!validationParam.success)
			return Response.json(validationParam.err, {
				status: 400,
			});

		const res: any = await getRequests(params);

		const { searchParams } = new URL(request.url);
		const includeFilters = (searchParams.get("includeFilters") === "true") || (formData.includeFilters === true);

		if (includeFilters && !res.err) {
			const configRes = await getRequestsConfig(params);
			res.pagination = { limit, offset, total: res.total || 0 };
			res.filters = (configRes.data as any)?.[0] || {};
		}

		return Response.json(res);
	} catch (error: any) {
		console.error("Error in telemetry trace route:", error);
		return Response.json({ err: error.message || "Internal Server Error" }, { status: 500 });
	}
}
