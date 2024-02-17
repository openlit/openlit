import { doku_apikeys } from "@prisma/client";

export function maskingKey(key: string) {
	return key.slice(0, 3) + "..." + key.slice(-3);
}

export function normalizeAPIKeys(params: doku_apikeys[] | null | undefined) {
	if (params?.length)
		return params.map((p) => ({ ...p, api_key: maskingKey(p.api_key) }));
}
