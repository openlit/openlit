jest.mock("@/lib/platform/vault", () => ({
	getSecretsFromDatabaseId: jest.fn(),
}));
jest.mock("@/lib/posthog", () => ({
	__esModule: true,
	default: {
		fireEvent: jest.fn(),
	},
}));
jest.mock("@/constants/messages", () => ({
	__esModule: true,
	default: jest.fn(() => ({
		NO_API_KEY: "No API key",
	})),
}));
jest.mock("@/utils/asaw", () => jest.fn());

import { OPTIONS, POST } from "@/app/api/vault/get-secrets/route";
import { getSecretsFromDatabaseId } from "@/lib/platform/vault";
import asaw from "@/utils/asaw";

class TestHeaders {
	private values = new Map<string, string>();

	constructor(headers?: Record<string, string>) {
		Object.entries(headers || {}).forEach(([key, value]) => {
			this.values.set(key.toLowerCase(), value);
		});
	}

	get(key: string) {
		return this.values.get(key.toLowerCase()) ?? null;
	}
}

class TestResponse {
	status: number;
	headers: TestHeaders;
	private body: unknown;

	constructor(body?: unknown, init?: { status?: number; headers?: Record<string, string> }) {
		this.body = body;
		this.status = init?.status ?? 200;
		this.headers = new TestHeaders(init?.headers);
	}

	static json(body: unknown, init?: { status?: number; headers?: Record<string, string> }) {
		return new TestResponse(body, init);
	}

	async json() {
		return this.body;
	}
}

(global as any).Response = TestResponse;

function makeRequest({
	origin,
	host = "app.openlit.local",
	authorization = "Bearer openlit-test",
	body = {},
}: {
	origin?: string;
	host?: string;
	authorization?: string;
	body?: Record<string, unknown>;
}) {
	const headers: Record<string, string> = {
		host,
		"content-type": "application/json",
	};

	if (origin) headers.origin = origin;
	if (authorization) headers.authorization = authorization;

	return {
		headers: {
			get: (key: string) => headers[key.toLowerCase()] ?? null,
		},
		json: jest.fn().mockResolvedValue(body),
	} as unknown as Request;
}

describe("/api/vault/get-secrets CORS", () => {
	const originalEnv = process.env;

	beforeEach(() => {
		jest.clearAllMocks();
		process.env = { ...originalEnv };
		delete process.env.OPENLIT_ALLOWED_CORS_ORIGINS;
		delete process.env.OPENLIT_ALLOWED_ORIGINS;
		delete process.env.NEXTAUTH_URL;
	});

	afterAll(() => {
		process.env = originalEnv;
	});

	it("rejects evil.com preflight requests", async () => {
		const response = await OPTIONS(
			makeRequest({ origin: "https://evil.com" })
		);

		expect(response.status).toBe(403);
		expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
	});

	it("allows same-origin preflight requests without wildcard CORS", async () => {
		const response = await OPTIONS(
			makeRequest({ origin: "https://app.openlit.local" })
		);

		expect(response.status).toBe(204);
		expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
			"https://app.openlit.local"
		);
		expect(response.headers.get("Access-Control-Allow-Origin")).not.toBe("*");
		expect(response.headers.get("Vary")).toBe("Origin");
	});

	it("allows configured trusted origins", async () => {
		process.env.OPENLIT_ALLOWED_CORS_ORIGINS =
			"https://trusted.example.com,https://docs.example.com";

		const response = await OPTIONS(
			makeRequest({ origin: "https://trusted.example.com" })
		);

		expect(response.status).toBe(204);
		expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
			"https://trusted.example.com"
		);
	});

	it("does not block no-Origin API key clients", async () => {
		(asaw as jest.Mock).mockResolvedValue([null, { OPENAI_API_KEY: "sk-test" }]);

		const response = await POST(makeRequest({ body: { key: "OPENAI_API_KEY" } }));
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(getSecretsFromDatabaseId).toHaveBeenCalledWith({
			apiKey: "openlit-test",
			key: "OPENAI_API_KEY",
			tags: undefined,
		});
		expect(body).toEqual({
			err: null,
			res: { OPENAI_API_KEY: "sk-test" },
		});
	});
});
