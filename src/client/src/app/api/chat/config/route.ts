import { getChatConfig, upsertChatConfig } from "@/lib/platform/chat/config";
import { resolveRequestAuth } from "@/helpers/server/auth";
import { NextRequest } from "next/server";
import asaw from "@/utils/asaw";
import getMessage from "@/constants/messages";

export async function GET(request: NextRequest) {
	const [authErr, auth] = await resolveRequestAuth(request);
	if (authErr || !auth) {
		return Response.json("Unauthorized", { status: 401 });
	}

	const { data, err } = await getChatConfig(auth.databaseConfigId);

	if (err) {
		return Response.json(err, { status: 400 });
	}

	return Response.json({ data });
}

export async function POST(request: NextRequest) {
	const [authErr, auth] = await resolveRequestAuth(request);
	if (authErr || !auth) {
		return Response.json("Unauthorized", { status: 401 });
	}

	let formData: Record<string, any>;
	try {
		formData = await request.json();
	} catch {
		return Response.json(getMessage().MALFORMED_INPUTS, { status: 400 });
	}

	if (!formData?.provider || !formData.model || !formData.vaultId) {
		return Response.json("Missing required fields: provider, model, vaultId", {
			status: 400,
		});
	}

	const [thrown, result] = await asaw(
		upsertChatConfig(
			{
				provider: formData.provider,
				model: formData.model,
				vaultId: formData.vaultId,
				meta: formData.meta || "{}",
			},
			auth.databaseConfigId
		)
	);

	// upsertChatConfig reports failures as `{ err }` rather than throwing.
	const err = thrown || (result as { err?: unknown } | null)?.err;
	if (err) {
		return Response.json(err, { status: 400 });
	}

	return Response.json(result);
}
