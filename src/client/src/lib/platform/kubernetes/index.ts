import { consoleLog } from "@/utils/log";

const DISABLED_PROVIDER_INSTRUMENTORS = [
	"openai",
	"anthropic",
	"cohere",
	"mistral",
	"groq",
	"google_ai_studio",
	"azure_ai",
	"bedrock",
	"together",
	"fireworks",
	"deepseek",
	"ollama",
	"huggingface",
	"vllm",
].join(",");

interface CreateAgentInstrumentationParams {
	namespace: string;
	serviceName: string;
	otlpEndpoint?: string;
}

export function buildAutoInstrumentationCRD({
	namespace,
	serviceName,
	otlpEndpoint,
}: CreateAgentInstrumentationParams) {
	return {
		apiVersion: "openlit.io/v1alpha1",
		kind: "AutoInstrumentation",
		metadata: {
			name: `openlit-agent-${serviceName}`,
			namespace,
		},
		spec: {
			selector: {
				matchLabels: {
					"app.kubernetes.io/name": serviceName,
				},
			},
			python: {
				instrumentation: {
					enabled: true,
					provider: "openlit",
					env: [
						{
							name: "OPENLIT_DISABLED_INSTRUMENTORS",
							value: DISABLED_PROVIDER_INSTRUMENTORS,
						},
					],
				},
			},
			otlp: {
				endpoint:
					otlpEndpoint ||
					process.env.OPENLIT_OTLP_ENDPOINT ||
					"http://otel-collector:4318",
			},
		},
	};
}

export async function createAgentInstrumentation(
	params: CreateAgentInstrumentationParams
): Promise<{ err?: string; data?: any }> {
	const crd = buildAutoInstrumentationCRD(params);

	// If running in K8s, use the in-cluster service account.
	// Otherwise, this requires a kubeconfig to be available.
	// We use dynamic import to avoid bundling @kubernetes/client-node
	// when it's not needed.
	try {
		const k8s = await import("@kubernetes/client-node");
		const kc = new k8s.KubeConfig();
		kc.loadFromDefault();

		const customApi = kc.makeApiClient(k8s.CustomObjectsApi);

		const result = await customApi.createNamespacedCustomObject({
			group: "openlit.io",
			version: "v1alpha1",
			namespace: params.namespace,
			plural: "autoinstrumentations",
			body: crd,
		});

		return { data: result };
	} catch (error: any) {
		consoleLog(error);

		if (error.body?.message) {
			return { err: error.body.message };
		}

		return {
			err:
				error.message ||
				"Failed to create AutoInstrumentation CRD. Ensure the OpenLIT operator is installed and K8s access is configured.",
		};
	}
}

export async function deleteAgentInstrumentation(
	namespace: string,
	serviceName: string
): Promise<{ err?: string; data?: any }> {
	try {
		const k8s = await import("@kubernetes/client-node");
		const kc = new k8s.KubeConfig();
		kc.loadFromDefault();

		const customApi = kc.makeApiClient(k8s.CustomObjectsApi);

		const result = await customApi.deleteNamespacedCustomObject({
			group: "openlit.io",
			version: "v1alpha1",
			namespace,
			plural: "autoinstrumentations",
			name: `openlit-agent-${serviceName}`,
		});

		return { data: result };
	} catch (error: any) {
		consoleLog(error);
		return {
			err: error.body?.message || error.message || "Failed to delete CRD",
		};
	}
}
