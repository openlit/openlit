import { getServiceById, getControllerInstances } from "@/lib/platform/controller";
import {
	createAgentInstrumentation,
	deleteAgentInstrumentation,
	getAgentInstrumentation,
} from "@/lib/platform/kubernetes";

async function getK8sService(params: Promise<{ id: string }>) {
	const { id } = await params;

	const serviceRes = await getServiceById(id);
	if (!serviceRes.data || serviceRes.data.length === 0) {
		return {
			error: Response.json({ error: "Service not found" }, { status: 404 }),
		};
	}

	const service = serviceRes.data[0];

	const instancesRes = await getControllerInstances();
	const isK8s = instancesRes.data?.some((i) => i.mode === "kubernetes");

	if (!isK8s) {
		return {
			error: Response.json(
				{
					error:
						"Agent SDK injection is only available in Kubernetes mode. " +
						"No Kubernetes-mode controller instances detected.",
				},
				{ status: 400 }
			),
		};
	}

	return { service, namespace: service.namespace || "default" };
}

export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const result = await getK8sService(params);
		if ("error" in result) return result.error;

		const status = await getAgentInstrumentation(
			result.namespace,
			result.service.service_name
		);

		if (status.err) {
			return Response.json({ error: status.err }, { status: 502 });
		}

		return Response.json({
			enabled: !!status.exists,
			service: result.service.service_name,
			namespace: result.namespace,
		});
	} catch (error: any) {
		return Response.json(
			{ error: error.message || "Agent instrumentation lookup failed" },
			{ status: 500 }
		);
	}
}

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const serviceContext = await getK8sService(params);
		if ("error" in serviceContext) return serviceContext.error;

		const body = await request.json().catch(() => ({}));
		const otlpEndpoint = body?.otlp_endpoint;

		const creation = await createAgentInstrumentation({
			namespace: serviceContext.namespace,
			serviceName: serviceContext.service.service_name,
			otlpEndpoint,
		});

		if (creation.err) {
			return Response.json({ error: creation.err }, { status: 502 });
		}

		return Response.json({
			status: "created",
			message:
				"AutoInstrumentation CRD created. Agent SDK will be injected on next pod restart. " +
				"Only agent framework instrumentors are enabled (LLM provider data comes from eBPF).",
			service: serviceContext.service.service_name,
			namespace: serviceContext.namespace,
		});
	} catch (error: any) {
		return Response.json(
			{ error: error.message || "Agent instrumentation failed" },
			{ status: 500 }
		);
	}
}

export async function DELETE(
	_request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const result = await getK8sService(params);
		if ("error" in result) return result.error;

		const deletion = await deleteAgentInstrumentation(
			result.namespace,
			result.service.service_name
		);

		if (deletion.err) {
			return Response.json({ error: deletion.err }, { status: 502 });
		}

		return Response.json({
			status: "deleted",
			message: "Agent observability disabled.",
			service: result.service.service_name,
			namespace: result.namespace,
		});
	} catch (error: any) {
		return Response.json(
			{ error: error.message || "Agent instrumentation delete failed" },
			{ status: 500 }
		);
	}
}
