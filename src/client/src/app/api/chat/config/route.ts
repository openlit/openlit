import { getChatConfig, upsertChatConfig } from "@/lib/platform/chat/config";
import { getCurrentUser } from "@/lib/session";
import { NextRequest } from "next/server";
import asaw from "@/utils/asaw";

export async function GET() {
	const user = await getCurrentUser();
	if (!user) {
		return Response.json("Unauthorized", { status: 401 });
	}

	const { data, err } = await getChatConfig();

	if (err) {
		return Response.json(err, { status: 400 });
	}

	return Response.json({ data });
}

export async function POST(request: NextRequest) {
	const user = await getCurrentUser();
	if (!user) {
		return Response.json("Unauthorized", { status: 401 });
	}

	const formData = await request.json();

	if (!formData.provider || !formData.model || !formData.vaultId) {
		return Response.json("Missing required fields: provider, model, vaultId", {
			status: 400,
		});
	}

	const [err, data] = await asaw(
		upsertChatConfig({
			provider: formData.provider,
			model: formData.model,
			vaultId: formData.vaultId,
			meta: formData.meta || "{}",
		})
	);

	if (err) {
		return Response.json(err, { status: 400 });
	}

	return Response.json(data);
}
