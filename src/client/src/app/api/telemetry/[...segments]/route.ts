import type { NextRequest } from "next/server";
import { withRouteAccess } from "@/lib/access/route-access";

type RouteContext = { params: { segments: string[] } };
type RouteHandler = (request: Request, context?: any) => Promise<Response>;

async function post(request: Request, context: RouteContext, path: string): Promise<Response> {
	const modules: Record<string, () => Promise<{ POST: RouteHandler }>> = {
		"exception": () => import("@/app/api/metrics/exception/route"),
		"exception/grouped": () => import("@/app/api/metrics/exception/grouped/route"),
		"request": () => import("@/app/api/metrics/request/route"),
		"request/attribute-keys": () => import("@/app/api/metrics/request/attribute-keys/route"),
		"request/config": () => import("@/app/api/metrics/request/config/route"),
		"request/duration/average": () => import("@/app/api/metrics/request/duration/average/route"),
		"request/exist": () => import("@/app/api/metrics/request/exist/route"),
		"request/grouped": () => import("@/app/api/metrics/request/grouped/route"),
		"request/time": () => import("@/app/api/metrics/request/time/route"),
		"request/total": () => import("@/app/api/metrics/request/total/route"),
		"llm/category": () => import("@/app/api/metrics/llm/category/route"),
		"llm/endpoint": () => import("@/app/api/metrics/llm/endpoint/route"),
		"llm/cost/application": () => import("@/app/api/metrics/llm/cost/application/route"),
		"llm/cost/environment": () => import("@/app/api/metrics/llm/cost/environment/route"),
		"llm/cost/request/average": () => import("@/app/api/metrics/llm/cost/request/average/route"),
		"llm/cost/total": () => import("@/app/api/metrics/llm/cost/total/route"),
		"llm/model/time": () => import("@/app/api/metrics/llm/model/time/route"),
		"llm/model/top": () => import("@/app/api/metrics/llm/model/top/route"),
		"llm/token/time": () => import("@/app/api/metrics/llm/token/time/route"),
		"llm/token/request/average": () => import("@/app/api/metrics/llm/token/request/average/route"),
		"llm/generation-health": () => import("@/app/api/metrics/llm/generation-health/route"),
		"vector/application": () => import("@/app/api/metrics/vector/application/route"),
		"vector/environment": () => import("@/app/api/metrics/vector/environment/route"),
		"vector/operation": () => import("@/app/api/metrics/vector/operation/route"),
		"vector/system": () => import("@/app/api/metrics/vector/system/route"),
		"gpu/fanspeed/time": () => import("@/app/api/metrics/gpu/fanspeed/time/route"),
		"gpu/memory/average": () => import("@/app/api/metrics/gpu/memory/average/route"),
		"gpu/memory/time": () => import("@/app/api/metrics/gpu/memory/time/route"),
		"gpu/power/average": () => import("@/app/api/metrics/gpu/power/average/route"),
		"gpu/power/time": () => import("@/app/api/metrics/gpu/power/time/route"),
		"gpu/temperature/average": () => import("@/app/api/metrics/gpu/temperature/average/route"),
		"gpu/temperature/time": () => import("@/app/api/metrics/gpu/temperature/time/route"),
		"gpu/utilization/average": () => import("@/app/api/metrics/gpu/utilization/average/route"),
		"gpu/utilization/time": () => import("@/app/api/metrics/gpu/utilization/time/route"),
	};
	const loader = modules[path];
	if (!loader) return Response.json({ err: `Unknown telemetry route: ${path}` }, { status: 404 });
	return (await loader()).POST(request, context);
}

async function POSTHandler(request: NextRequest, context: RouteContext) {
	return post(request, context, context.params.segments.join("/"));
}

async function GETHandler(request: NextRequest, context: RouteContext) {
	const segments = context.params.segments;
	if (segments.length === 4 && segments[0] === "request" && segments[1] === "span" && segments[3] === "heirarchy") {
		const handler = (await import("@/app/api/metrics/request/span/[id]/heirarchy/route")).GET;
		return handler(request, { params: { id: segments[2] } });
	}
	if (segments.length === 3 && segments[0] === "request" && segments[1] === "span") {
		const handler = (await import("@/app/api/metrics/request/span/[id]/route")).GET;
		return handler(request, { params: { id: segments[2] } });
	}
	if (segments.length === 3 && segments[0] === "request" && segments[1] === "trace") {
		const handler = (await import("@/app/api/metrics/request/trace/[id]/route")).GET;
		return handler(request, { params: { id: segments[2] } });
	}
	return Response.json({ err: `Unknown telemetry route: ${segments.join("/")}` }, { status: 404 });
}

export const GET = withRouteAccess("observability.read", GETHandler, { requireDbConfig: true });
export const POST = withRouteAccess("observability.read", POSTHandler, { requireDbConfig: true });
