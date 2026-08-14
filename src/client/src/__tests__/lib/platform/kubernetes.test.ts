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
});
