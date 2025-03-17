import { SecretInput } from "@/types/vault";
import { upsertSecret } from "@/lib/platform/vault";
import asaw from "@/utils/asaw";

export async function POST(request: Request) {
	const formData = await request.json();

	const promptInput: SecretInput = {
		key: formData.key,
		value: formData.value,
		tags: formData.tags,
	};

	const [err, res]: any = await asaw(upsertSecret(promptInput));

	if (err) {
		return Response.json(err, {
			status: 400,
		});
	}

	return Response.json(res);
}

export async function PUT(request: Request) {
	const formData = await request.json();

	const secretInput: SecretInput = {
		id: formData.id,
		key: formData.key,
		value: formData.value,
		tags: formData.tags,
	};

	const [err, res]: any = await asaw(upsertSecret(secretInput));

	if (err) {
		return Response.json(err, {
			status: 400,
		});
	}

	return Response.json(res);
}
