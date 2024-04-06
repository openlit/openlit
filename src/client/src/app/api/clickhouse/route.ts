import { pingClickhouse } from "@/lib/doku/clickhouse";
import asaw from "@/utils/asaw";

export async function POST() {
	const [err, res] = await asaw(pingClickhouse());
	if (err)
		return Response.json(err, {
			status: 400,
		});

	return Response.json(res);
}