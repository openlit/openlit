const mockCreateNamespacedCustomObject = jest.fn();
const mockGetNamespacedCustomObject = jest.fn();
const mockDeleteNamespacedCustomObject = jest.fn();
const mockLoadFromDefault = jest.fn();
const mockMakeApiClient = jest.fn(() => ({
	createNamespacedCustomObject: mockCreateNamespacedCustomObject,
	getNamespacedCustomObject: mockGetNamespacedCustomObject,
	deleteNamespacedCustomObject: mockDeleteNamespacedCustomObject,
}));

jest.mock("@/utils/log", () => ({
	consoleLog: jest.fn(),
}));

jest.mock("@kubernetes/client-node", () => ({
	KubeConfig: jest.fn().mockImplementation(() => ({
		loadFromDefault: mockLoadFromDefault,
		makeApiClient: mockMakeApiClient,
	})),
	CustomObjectsApi: jest.fn(),
}));

import { consoleLog } from "@/utils/log";
import {
	buildAutoInstrumentationCRD,
	createAgentInstrumentation,
	deleteAgentInstrumentation,
	getAgentInstrumentation,
} from "@/lib/platform/kubernetes";

describe("platform kubernetes helpers", () => {
	const originalEndpoint = process.env.OPENLIT_OTLP_ENDPOINT;

	beforeEach(() => {
		jest.clearAllMocks();
		delete process.env.OPENLIT_OTLP_ENDPOINT;
	});

	afterEach(() => {
		if (originalEndpoint === undefined) {
			delete process.env.OPENLIT_OTLP_ENDPOINT;
		} else {
			process.env.OPENLIT_OTLP_ENDPOINT = originalEndpoint;
		}
	});

	it("builds AutoInstrumentation CRDs with default and override endpoints", () => {
		expect(
			buildAutoInstrumentationCRD({
				namespace: "default",
				serviceName: "api",
			})
		).toMatchObject({
			metadata: { name: "openlit-agent-api", namespace: "default" },
			spec: {
				selector: {
					matchLabels: { "app.kubernetes.io/name": "api" },
				},
				otlp: { endpoint: "http://otel-collector:4318" },
			},
		});

		process.env.OPENLIT_OTLP_ENDPOINT = "http://env-collector:4318";
		expect(
			buildAutoInstrumentationCRD({
				namespace: "default",
				serviceName: "api",
				otlpEndpoint: "http://override:4318",
			}).spec.otlp.endpoint
		).toBe("http://override:4318");
		expect(
			buildAutoInstrumentationCRD({
				namespace: "default",
				serviceName: "api",
			}).spec.otlp.endpoint
		).toBe("http://env-collector:4318");
	});

	it("creates AutoInstrumentation custom objects", async () => {
		mockCreateNamespacedCustomObject.mockResolvedValueOnce({ body: "created" });

		await expect(
			createAgentInstrumentation({
				namespace: "default",
				serviceName: "api",
			})
		).resolves.toEqual({ data: { body: "created" } });

		expect(mockLoadFromDefault).toHaveBeenCalled();
		expect(mockCreateNamespacedCustomObject).toHaveBeenCalledWith(
			expect.objectContaining({
				group: "openlit.io",
				version: "v1alpha1",
				namespace: "default",
				plural: "autoinstrumentations",
				body: expect.objectContaining({
					metadata: { name: "openlit-agent-api", namespace: "default" },
				}),
			})
		);
	});

	it("returns Kubernetes error messages for create failures", async () => {
		mockCreateNamespacedCustomObject.mockRejectedValueOnce({
			body: { message: "already exists" },
		});

		await expect(
			createAgentInstrumentation({
				namespace: "default",
				serviceName: "api",
			})
		).resolves.toEqual({ err: "already exists" });
		expect(consoleLog).toHaveBeenCalledWith({ body: { message: "already exists" } });
	});

	it("falls back to error.message when create failures have no body.message", async () => {
		mockCreateNamespacedCustomObject.mockRejectedValueOnce(
			new Error("connection refused")
		);

		await expect(
			createAgentInstrumentation({
				namespace: "default",
				serviceName: "api",
			})
		).resolves.toEqual({ err: "connection refused" });
	});

	it("falls back to a default message when create failures have neither body.message nor message", async () => {
		mockCreateNamespacedCustomObject.mockRejectedValueOnce({});

		await expect(
			createAgentInstrumentation({
				namespace: "default",
				serviceName: "api",
			})
		).resolves.toEqual({
			err: "Failed to create AutoInstrumentation CRD. Ensure the OpenLIT operator is installed and K8s access is configured.",
		});
	});

	it("reads existing AutoInstrumentation custom objects", async () => {
		mockGetNamespacedCustomObject.mockResolvedValueOnce({ body: "found" });

		await expect(getAgentInstrumentation("default", "api")).resolves.toEqual({
			data: { body: "found" },
			exists: true,
		});

		expect(mockGetNamespacedCustomObject).toHaveBeenCalledWith({
			group: "openlit.io",
			version: "v1alpha1",
			namespace: "default",
			plural: "autoinstrumentations",
			name: "openlit-agent-api",
		});
	});

	it("maps Kubernetes 404s to exists=false", async () => {
		mockGetNamespacedCustomObject.mockRejectedValueOnce({ statusCode: 404 });

		await expect(getAgentInstrumentation("default", "api")).resolves.toEqual({
			exists: false,
		});
	});

	it("maps a body.code 404 to exists=false when statusCode is not 404", async () => {
		mockGetNamespacedCustomObject.mockRejectedValueOnce({
			body: { code: 404 },
		});

		await expect(getAgentInstrumentation("default", "api")).resolves.toEqual({
			exists: false,
		});
	});

	it("returns body.message for non-404 get failures", async () => {
		mockGetNamespacedCustomObject.mockRejectedValueOnce({
			statusCode: 500,
			body: { message: "internal error" },
		});

		await expect(getAgentInstrumentation("default", "api")).resolves.toEqual({
			err: "internal error",
		});
	});

	it("falls back to error.message for non-404 get failures without body.message", async () => {
		mockGetNamespacedCustomObject.mockRejectedValueOnce(
			new Error("network unreachable")
		);

		await expect(getAgentInstrumentation("default", "api")).resolves.toEqual({
			err: "network unreachable",
		});
	});

	it("falls back to a default message for non-404 get failures with no message at all", async () => {
		mockGetNamespacedCustomObject.mockRejectedValueOnce({});

		await expect(getAgentInstrumentation("default", "api")).resolves.toEqual({
			err: "Failed to read AutoInstrumentation CRD",
		});
	});

	it("deletes AutoInstrumentation custom objects and reports errors", async () => {
		mockDeleteNamespacedCustomObject.mockResolvedValueOnce({ body: "deleted" });
		await expect(deleteAgentInstrumentation("default", "api")).resolves.toEqual({
			data: { body: "deleted" },
		});

		mockDeleteNamespacedCustomObject.mockRejectedValueOnce(new Error("no access"));
		await expect(deleteAgentInstrumentation("default", "api")).resolves.toEqual({
			err: "no access",
		});
	});

	it("prefers body.message over error.message for delete failures", async () => {
		mockDeleteNamespacedCustomObject.mockRejectedValueOnce({
			body: { message: "forbidden" },
			message: "generic error",
		});

		await expect(deleteAgentInstrumentation("default", "api")).resolves.toEqual({
			err: "forbidden",
		});
	});

	it("falls back to a default message when delete failures have neither body.message nor message", async () => {
		mockDeleteNamespacedCustomObject.mockRejectedValueOnce({});

		await expect(deleteAgentInstrumentation("default", "api")).resolves.toEqual({
			err: "Failed to delete CRD",
		});
	});
});
