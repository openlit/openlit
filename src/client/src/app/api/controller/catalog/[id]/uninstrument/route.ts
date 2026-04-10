import { getServiceById, getControllerIdsForWorkload, queueAction, updateDesiredStatus } from "@/lib/platform/controller";

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
		if (!service.workload_key) {
			return Response.json(
				{ error: "Service is missing workload_key" },
				{ status: 500 }
			);
		}

		await updateDesiredStatus(service.workload_key, service.cluster_id || "default", {
			desired_instrumentation_status: "none",
		});

		const controllerIds = await getControllerIdsForWorkload(
			service.service_name,
			service.namespace || "",
			service.cluster_id || "default"
		);
		const targets = controllerIds.data?.map((r) => r.controller_instance_id) || [];
		if (targets.length === 0) {
			targets.push(service.controller_instance_id);
		}

		await Promise.all(
			targets.map((cid) =>
				queueAction(cid, "uninstrument", service.workload_key)
			)
		);

		return Response.json({ status: "queued", action: "uninstrument", controllers: targets.length });
	} catch (error: any) {
		return Response.json(
			{ error: error.message || "Uninstrumentation failed" },
			{ status: 500 }
		);
	}
}
