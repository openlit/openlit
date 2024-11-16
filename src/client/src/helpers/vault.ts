import { SecretInput } from "@/constants/vault";

export function verifySecretInput(secretInput: SecretInput) {
	if (secretInput.key.length === 0) {
		return {
			success: false,
			err: "Key should be present!",
		};
	}

	return { success: true };
}

export function normalizeSecretDataForSDK(secretData: any[]) {
	return secretData.reduce((acc, secret) => {
		acc[secret.key] = secret.value;
		return acc;
	}, {});
}
