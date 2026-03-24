import { pingClickhouse } from "@/lib/platform/clickhouse/helpers";
import asaw from "@/utils/asaw";
import { sanitizeErrorMessage } from "@/utils/validation";

export async function POST() {
	const [err, res] = await asaw(pingClickhouse());
	if (err)
		return Response.json(sanitizeErrorMessage(err, "Database connection failed"), {
			status: 400,
		});

	return Response.json(res);
}