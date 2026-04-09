import { getServiceById, getCollectorInstances } from "@/lib/platform/collector";
import { createAgentInstrumentation } from "@/lib/platform/kubernetes";

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const { id } = await params;

		const serviceRes = await getServiceById(id);
		if (!serviceRes.data || serviceRes.data.length === 0) {
			return Response.json(
				{ error: "Service not found" },
				{ status: 404 }
			);
		}

		const service = serviceRes.data[0];

		const instancesRes = await getCollectorInstances();
		const isK8s = instancesRes.data?.some(
			(i) => i.mode === "kubernetes"
		);

		if (!isK8s) {
			return Response.json(
				{
					error:
						"Agent SDK injection is only available in Kubernetes mode. " +
						"No Kubernetes-mode collector instances detected.",
				},
				{ status: 400 }
			);
		}

		const namespace = service.namespace || "default";

		const body = await request.json().catch(() => ({}));
		const otlpEndpoint = body?.otlp_endpoint;

		const result = await createAgentInstrumentation({
			namespace,
			serviceName: service.service_name,
			otlpEndpoint,
		});

		if (result.err) {
			return Response.json({ error: result.err }, { status: 502 });
		}

		return Response.json({
			status: "created",
			message:
				"AutoInstrumentation CRD created. Agent SDK will be injected on next pod restart. " +
				"Only agent framework instrumentors are enabled (LLM provider data comes from eBPF).",
			service: service.service_name,
			namespace,
		});
	} catch (error: any) {
		return Response.json(
			{ error: error.message || "Agent instrumentation failed" },
			{ status: 500 }
		);
	}
}
