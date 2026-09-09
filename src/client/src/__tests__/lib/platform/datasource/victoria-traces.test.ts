const mockSafeFetch = jest.fn();

jest.mock("@/lib/platform/connectors/datasource/http/safe-fetch", () => ({
	safeFetch: (...args: unknown[]) => mockSafeFetch(...args),
	SourceResponseError: class SourceResponseError extends Error {
		status: number;
		constructor(status: number, message: string) {
			super(message);
			this.status = status;
		}
	},
	selfHostedNetworkOptions: () => ({
		allowHttp: true,
		allowPrivateNetwork: true,
	}),
}));
jest.mock("@/lib/platform/connectors/datasource/http/secret", () => {
	const messages = jest.requireActual("@/constants/messages/en") as {
		DATA_SOURCE_SECRET_NOT_FOUND: string;
		DATA_SOURCE_SECRET_UNAVAILABLE: string;
		DATA_SOURCE_SECRET_DECRYPT_FAILED: string;
	};
	return {
		resolveSourceSecret: jest.fn(),
		redactableSecretValues: () => ["tok"],
		httpAuthNeedsVault: (authType: unknown) => {
			const type = String(authType || "none").trim().toLowerCase();
			return type === "basic" || type === "bearer";
		},
		canSkipVaultForHttpNoneAuth: (error: unknown, authType: unknown) => {
			const message = error instanceof Error ? error.message : String(error);
			const type = String(authType || "none").trim().toLowerCase();
			if (type && type !== "none" && type !== "auto") return false;
			return (
				message === messages.DATA_SOURCE_SECRET_NOT_FOUND ||
				message === messages.DATA_SOURCE_SECRET_UNAVAILABLE ||
				message === messages.DATA_SOURCE_SECRET_DECRYPT_FAILED
			);
		},
	};
});

import { resolveSourceSecret } from "@/lib/platform/connectors/datasource/http/secret";
import { DATA_SOURCE_SECRET_NOT_FOUND } from "@/constants/messages/en";
import {
	VictoriaTracesAdapter,
	victoriaTracesAdapterFactory,
} from "@/lib/platform/connectors/datasource/victoria-traces/adapter";
import type { TelemetrySourceDescriptor } from "@/lib/platform/connectors/datasource/types";

function descriptor(
	settings: Record<string, unknown> = {}
): TelemetrySourceDescriptor {
	return {
		type: "victoriatraces",
		id: "source-victoriatraces",
		isBuiltIn: false,
		settings: {
			url: "http://victoria-traces:10428",
			allowHttp: true,
			allowPrivateNetwork: true,
			...settings,
		},
		signals: ["traces"],
		name: "VictoriaTraces",
	};
}

beforeEach(() => {
	mockSafeFetch.mockReset();
	(resolveSourceSecret as jest.Mock).mockReset();
	(resolveSourceSecret as jest.Mock).mockResolvedValue({
		raw: "tok",
		credentials: { token: "tok", tenant: "12" },
	});
});

describe("victoria traces adapter", () => {
	it("describes Jaeger-compatible traces with AccountID and ProjectID", () => {
		const info = victoriaTracesAdapterFactory.describe();
		expect(info.type).toBe("victoriatraces");
		expect(info.declaredSignals).toEqual(["traces"]);
		expect(info.configFields.some((field) => field.key === "tenantProject")).toBe(
			true
		);
		expect(
			victoriaTracesAdapterFactory.create(descriptor())
		).toBeInstanceOf(VictoriaTracesAdapter);
	});

	it("health-checks /health with AccountID and ProjectID", async () => {
		mockSafeFetch.mockResolvedValue("OK");
		const adapter = new VictoriaTracesAdapter(
			descriptor({ tenant: "12", tenantProject: "34" })
		);
		const result = await adapter.healthCheck();
		expect(result.ok).toBe(true);
		const url = String(mockSafeFetch.mock.calls[0][0]);
		expect(url).toBe("http://victoria-traces:10428/health");
		const headers = mockSafeFetch.mock.calls[0][1].headers as Record<string, string>;
		expect(headers.AccountID).toBe("12");
		expect(headers.ProjectID).toBe("34");
		expect(headers["X-Scope-OrgID"]).toBeUndefined();
	});

	it("falls back to /select/jaeger/api/services when /health is missing", async () => {
		const { SourceResponseError } = jest.requireMock(
			"@/lib/platform/connectors/datasource/http/safe-fetch"
		) as { SourceResponseError: new (status: number, message: string) => Error };
		mockSafeFetch
			.mockRejectedValueOnce(new SourceResponseError(404, "not found"))
			.mockResolvedValueOnce({ data: ["checkout"] });
		const adapter = new VictoriaTracesAdapter(descriptor({ tenant: "12" }));
		const result = await adapter.healthCheck();
		expect(result.ok).toBe(true);
		expect(String(mockSafeFetch.mock.calls[1][0])).toBe(
			"http://victoria-traces:10428/select/jaeger/api/services"
		);
	});

	it("still health-checks when the vault secret is missing and auth is none", async () => {
		const { DATA_SOURCE_SECRET_NOT_FOUND } = jest.requireActual(
			"@/constants/messages/en"
		) as { DATA_SOURCE_SECRET_NOT_FOUND: string };
		(resolveSourceSecret as jest.Mock).mockRejectedValue(
			new Error(DATA_SOURCE_SECRET_NOT_FOUND)
		);
		mockSafeFetch.mockResolvedValue("OK");
		const adapter = new VictoriaTracesAdapter(
			descriptor({ authType: "none", tenant: "12" })
		);
		await expect(adapter.healthCheck()).resolves.toMatchObject({ ok: true });
		expect(mockSafeFetch).toHaveBeenCalled();
	});

	it("does not double-prefix when the URL already includes /select/jaeger", async () => {
		mockSafeFetch.mockResolvedValue("OK");
		const adapter = new VictoriaTracesAdapter(
			descriptor({ url: "http://victoria-traces:10428/select/jaeger" })
		);
		await adapter.healthCheck();
		expect(String(mockSafeFetch.mock.calls[0][0])).toBe(
			"http://victoria-traces:10428/health"
		);
	});
});
