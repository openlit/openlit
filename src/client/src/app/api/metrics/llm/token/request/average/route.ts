import { withRouteAccess } from "@/lib/access/route-access";
import {
	type TokenParams,
	getAverageTokensPerRequest,
} from "@/lib/platform/llm/token";
import {
	validateMetricsRequest,
	validateMetricsRequestType,
} from "@/helpers/server/platform";
import { TimeLimit } from "@/lib/platform/common";
import { getRequestEnvironment } from "@/constants/openlit-context";

async function POSTHandler(request: Request) {
	const formData = await request.json();
	const timeLimit = formData.timeLimit as TimeLimit;

	const params: TokenParams = {
		timeLimit,
		type: formData.type,
		selectedConfig: formData.selectedConfig,
		environment:
			typeof formData.environment === "string"
				? formData.environment
				: getRequestEnvironment(request),
	};

	const validationParam = validateMetricsRequest(
		params,
		validateMetricsRequestType.AVERAGE_REQUEST_TOKEN
	);

	if (!validationParam.success)
		return Response.json(validationParam.err, {
			status: 400,
		});

	const res: any = await getAverageTokensPerRequest(params);
	return Response.json(res);
}

export const POST = withRouteAccess("metrics.read", POSTHandler, { requireDbConfig: true });
