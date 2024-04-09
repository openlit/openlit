import { DokuRequestParams } from "@/lib/doku/common";
import { getRequests } from "@/lib/doku/request";
import {
	validateMetricsRequest,
	validateMetricsRequestType,
} from "@/helpers/doku";

export async function POST(request: Request) {
	const formData = await request.json();
	const timeLimit = formData.timeLimit;
	const config = formData.config || {};
	const limit = formData.limit || 10;
	const offset = formData.offset || 0;

	const params: DokuRequestParams = {
		timeLimit: {
			start: timeLimit.start,
			end: timeLimit.end,
		},
		config,
		limit,
		offset,
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
	return Response.json(res);
}
