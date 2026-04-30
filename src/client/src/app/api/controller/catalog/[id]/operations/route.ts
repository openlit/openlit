import { getFeatureHandler } from "@/lib/platform/controller/features";

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ id: string }> }
) {
	try {
		const { id } = await params;
		const body = await request.json();
		const { feature, operation, payload } = body as {
			feature?: string;
			operation?: string;
			payload?: Record<string, unknown>;
		};

		if (!feature || !operation) {
			return Response.json(
				{ error: "Both 'feature' and 'operation' are required" },
				{ status: 400 }
			);
		}

		const handler = getFeatureHandler(feature);
		if (!handler) {
			return Response.json(
				{ error: `Unknown feature: "${feature}"` },
				{ status: 400 }
			);
		}

		const validationError = handler.validatePayload(
			operation,
			payload || {}
		);
		if (validationError) {
			return Response.json({ error: validationError }, { status: 400 });
		}

		return handler.applyOperation(id, operation, payload || {});
	} catch (error: any) {
		return Response.json(
			{ error: error.message || "Operation failed" },
			{ status: 500 }
		);
	}
}
