import { getServiceById, queueAction } from "@/lib/platform/controller";

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

		await queueAction(
			service.controller_instance_id,
			"instrument",
			service.workload_key
		);

		return Response.json({ status: "queued", action: "instrument" });
	} catch (error: any) {
		return Response.json(
			{ error: error.message || "Instrumentation failed" },
			{ status: 500 }
		);
	}
}
