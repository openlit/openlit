"use client";

import { useState, useCallback, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import type {
	ControllerInstance,
	ControllerConfig,
	ControllerHealth,
	ControllerService,
	PayloadExtractionConfig,
} from "@/types/controller";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { toast } from "sonner";
import { formatBrowserDateTime } from "@/utils/date";
import { useDynamicBreadcrumbs } from "@/utils/hooks/useBreadcrumbs";
import {
	ArrowLeft,
	ChevronDown,
	ChevronRight,
	Save,
	Loader2,
} from "lucide-react";
import LinuxSvg from "@/components/svg/linux";
import KubernetesSvg from "@/components/svg/kubernetes";
import DockerSvg from "@/components/svg/docker";

const HEALTH_STYLES: Record<ControllerHealth, string> = {
	healthy: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
	degraded:
		"bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
	error: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

const SUPPORTED_PROVIDERS: Array<keyof PayloadExtractionConfig> = [
	"openai",
	"anthropic",
	"gemini",
	"cohere",
	"mistral",
	"groq",
	"deepseek",
	"together",
	"fireworks",
	"vercel_ai",
	"vertex_ai",
	"azure_inference",
	"bedrock",
];

const PROVIDER_LABELS: Record<string, string> = {
	openai: "OpenAI",
	anthropic: "Anthropic",
	gemini: "Gemini",
	cohere: "Cohere",
	mistral: "Mistral",
	groq: "Groq",
	deepseek: "DeepSeek",
	together: "Together AI",
	fireworks: "Fireworks AI",
	vercel_ai: "Vercel AI Gateway",
	vertex_ai: "Vertex AI",
	azure_inference: "Azure AI Inference",
	bedrock: "AWS Bedrock",
};

const DEFAULT_PAYLOAD_EXTRACTION: PayloadExtractionConfig = {
	openai: false,
	anthropic: false,
	gemini: false,
	cohere: false,
	mistral: false,
	groq: false,
	deepseek: false,
	together: false,
	fireworks: false,
	vercel_ai: false,
	vertex_ai: false,
	azure_inference: false,
	azure_openai: false,
	bedrock: false,
	litellm: false,
	ollama: false,
};

const DEFAULT_CONFIG: ControllerConfig = {
	export: {
		otlp_endpoint: "http://localhost:4318",
		otlp_headers: {},
		otlp_protocol: "http/protobuf",
	},
	discovery: {
		auto_discover: true,
		instrument: [],
		exclude: [],
	},
	payload_extraction: DEFAULT_PAYLOAD_EXTRACTION,
	custom_llm_hosts: [],
	environment: "default",
};

export default function ControllerDetailPage() {
	const params = useParams();
	const instanceId = params.instance_id as string;
	const router = useRouter();

	const {
		fireRequest: fetchInstance,
		data: instance,
		isLoading: instanceLoading,
	} = useFetchWrapper<ControllerInstance>();

	useEffect(() => {
		if (instanceId) {
			fetchInstance({
				requestType: "GET",
				url: `/api/controller/instances/${instanceId}`,
				responseDataKey: "data",
			});
		}
	}, [instanceId, fetchInstance]);
	useDynamicBreadcrumbs(
		{
			title: instance?.node_name || instance?.instance_id || "Controller",
		},
		[instance?.node_name, instance?.instance_id]
	);

	if (instanceLoading || !instance) {
		return (
			<div className="flex flex-col w-full gap-4 p-1">
				<div className="flex items-center justify-center py-16 text-stone-400">
					<Loader2 className="w-5 h-5 animate-spin mr-2" />
					Loading controller...
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col w-full gap-4 p-1 overflow-y-auto">
			<button
				onClick={() => router.push("/instrumentation-hub")}
				className="flex items-center gap-2 text-sm text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 w-fit transition-colors"
			>
				<ArrowLeft className="w-4 h-4" />
				Back to Hub
			</button>
			<ControllerHeader instance={instance} />
			<ControllerConfigEditor instance={instance} />
		</div>
	);
}

function ControllerHeader({ instance }: { instance: ControllerInstance }) {
	return (
		<div className="border dark:border-stone-800 rounded-lg p-6">
			<div className="flex items-start justify-between">
				<div className="flex items-start gap-4">
					<div className="w-10 h-10 bg-stone-200 dark:bg-stone-700 rounded-full flex items-center justify-center">
						{instance.mode === "kubernetes" ? (
							<KubernetesSvg className="w-5 h-5 text-stone-600 dark:text-stone-300" />
						) : instance.mode === "docker" ? (
							<DockerSvg className="w-5 h-5 text-stone-600 dark:text-stone-300" />
						) : (
							<LinuxSvg className="w-5 h-5 text-stone-600 dark:text-stone-300" />
						)}
					</div>
					<div>
						<h2 className="text-xl font-semibold text-stone-700 dark:text-stone-200">
							{instance.node_name || instance.instance_id}
						</h2>
						<p className="text-sm text-stone-500 dark:text-stone-400 mt-1">
							{instance.version && `v${instance.version} · `}
							{instance.mode === "kubernetes" ? "Kubernetes" : instance.mode === "docker" ? "Docker" : "Linux"} ·{" "}
							Last heartbeat{" "}
							{formatBrowserDateTime(instance.last_heartbeat)}
						</p>
					</div>
				</div>
				<Badge
					variant="outline"
					className={HEALTH_STYLES[instance.status] || ""}
				>
					{instance.status}
				</Badge>
			</div>
			<div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-5">
				<Stat label="Services Discovered" value={instance.services_discovered} />
				<Stat label="Instrumented" value={instance.services_instrumented} />
			</div>
			{instance.resource_attributes &&
				Object.keys(instance.resource_attributes).length > 0 && (
					<ResourceAttributesPanel attrs={instance.resource_attributes} />
				)}
		</div>
	);
}

function Stat({ label, value }: { label: string; value: number }) {
	return (
		<div className="border dark:border-stone-700 rounded-lg p-3">
			<div className="text-lg font-semibold text-stone-900 dark:text-stone-100">
				{value}
			</div>
			<div className="text-xs text-stone-500 dark:text-stone-400">
				{label}
			</div>
		</div>
	);
}

function ResourceAttributesPanel({
	attrs,
}: {
	attrs: Record<string, string>;
}) {
	const entries = Object.entries(attrs).sort(([a], [b]) =>
		a.localeCompare(b)
	);
	return (
		<div className="mt-5 border dark:border-stone-700 rounded-lg overflow-hidden">
			<div className="px-4 py-2.5 bg-stone-50 dark:bg-stone-800 border-b dark:border-stone-700">
				<span className="text-xs font-medium text-stone-500 dark:text-stone-400 uppercase tracking-wide">
					Resource Attributes
				</span>
			</div>
			<div className="max-h-72 overflow-y-auto px-4 py-3">
				<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2">
					{entries.map(([key, value]) => (
						<div key={key} className="flex flex-col min-w-0">
							<span className="text-[11px] text-stone-400 dark:text-stone-500 font-mono break-all">
								{key}
							</span>
							<span className="text-sm text-stone-700 dark:text-stone-300 break-all">
								{value}
							</span>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}

function ControllerConfigEditor({
	instance,
}: {
	instance: ControllerInstance;
}) {
	const {
		fireRequest: fetchConfig,
		data: savedConfig,
		isLoading: configLoading,
		isFetched: configFetched,
	} = useFetchWrapper<ControllerConfig | null>();
	const {
		fireRequest: fetchServices,
		data: services,
		isFetched: servicesFetched,
	} = useFetchWrapper<ControllerService[]>();
	const { fireRequest: saveConfig, isLoading: saving } = useFetchWrapper();

	const [config, setConfig] = useState<ControllerConfig>(DEFAULT_CONFIG);

	useEffect(() => {
		fetchConfig({
			requestType: "GET",
			url: `/api/controller/config?instance_id=${instance.instance_id}`,
			responseDataKey: "data",
		});
	}, [instance.instance_id, fetchConfig]);

	useEffect(() => {
		fetchServices({
			requestType: "GET",
			url: "/api/controller/catalog",
			responseDataKey: "data",
		});
	}, [fetchServices]);

	useEffect(() => {
		if (!configFetched) return;
		const defaults = buildDefaultConfig(instance.instance_id, services || []);
		if (savedConfig) {
			setConfig(mergeConfig(defaults, savedConfig));
			return;
		}
		if (servicesFetched) {
			setConfig(defaults);
		}
	}, [configFetched, savedConfig, services, servicesFetched, instance.instance_id]);

	const handleSave = useCallback(() => {
		saveConfig({
			requestType: "POST",
			url: "/api/controller/config",
			body: JSON.stringify({
				instance_id: instance.instance_id,
				config,
			}),
			successCb: () => {
				toast.success(
					"Configuration saved. Controller will pick it up on next poll."
				);
			},
			failureCb: (err: any) => {
				toast.error(`Failed to save config: ${err}`);
			},
		});
	}, [config, instance.instance_id, saveConfig]);

	if (configLoading && !configFetched) {
		return (
			<div className="flex items-center justify-center py-8 text-stone-400">
				<Loader2 className="w-4 h-4 animate-spin mr-2" />
				Loading configuration...
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-6 max-w-3xl">
			<ConfigSection title="General">
				<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
					<div>
						<label className="block text-xs font-medium text-stone-500 dark:text-stone-400 mb-1">
							Environment
						</label>
						<input
							type="text"
							value={config.environment || "default"}
							onChange={(e) =>
								setConfig((prev) => ({
									...prev,
									environment: e.target.value,
								}))
							}
							className="w-full px-3 py-2 text-sm border dark:border-stone-700 rounded-md bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-1 focus:ring-stone-400"
							placeholder="default"
						/>
						<p className="text-xs text-stone-400 mt-1">
							Sets deployment.environment on all traces (matches
							OpenLIT SDK convention)
						</p>
					</div>
				</div>
			</ConfigSection>

			<ConfigSection title="Export Settings">
				<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
					<div>
						<label className="block text-xs font-medium text-stone-500 dark:text-stone-400 mb-1">
							OTLP Endpoint
						</label>
						<input
							type="text"
							value={config.export.otlp_endpoint}
							onChange={(e) =>
								setConfig((prev) => ({
									...prev,
									export: {
										...prev.export,
										otlp_endpoint: e.target.value,
									},
								}))
							}
							className="w-full px-3 py-2 text-sm border dark:border-stone-700 rounded-md bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-1 focus:ring-stone-400"
							placeholder="http://localhost:4318"
						/>
					</div>
					<div>
						<label className="block text-xs font-medium text-stone-500 dark:text-stone-400 mb-1">
							OTLP Protocol
						</label>
						<select
							value={config.export.otlp_protocol}
							onChange={(e) =>
								setConfig((prev) => ({
									...prev,
									export: {
										...prev.export,
										otlp_protocol: e.target.value,
									},
								}))
							}
							className="w-full px-3 py-2 text-sm border dark:border-stone-700 rounded-md bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-1 focus:ring-stone-400"
						>
							<option value="http/protobuf">HTTP/Protobuf</option>
							<option value="grpc">gRPC</option>
						</select>
					</div>
				</div>
				<HeadersEditor
					headers={config.export.otlp_headers}
					onChange={(headers) =>
						setConfig((prev) => ({
							...prev,
							export: {
								...prev.export,
								otlp_headers: headers,
							},
						}))
					}
				/>
			</ConfigSection>

			<ConfigSection title="Discovery">
				<div className="flex flex-col gap-3">
					<ToggleRow
						label="Auto-discover LLM services"
						description="Automatically scan for applications making LLM API calls"
						checked={config.discovery.auto_discover}
						onChange={(v) =>
							setConfig((prev) => ({
								...prev,
								discovery: {
									...prev.discovery,
									auto_discover: v,
								},
							}))
						}
					/>
				</div>
			</ConfigSection>

			<ConfigSection title="Custom LLM Hosts">
				<p className="text-xs text-stone-400 mb-3">
					Add custom hostnames for self-hosted LLM proxies (e.g.
					LiteLLM, Ollama, Azure per-deployment endpoints).
					Comma-separated. The controller will resolve these and monitor
					traffic to them.
				</p>
				<input
					type="text"
					value={(config.custom_llm_hosts || []).join(", ")}
					onChange={(e) =>
						setConfig((prev) => ({
							...prev,
							custom_llm_hosts: e.target.value
								.split(",")
								.map((h) => h.trim())
								.filter(Boolean),
						}))
					}
					className="w-full px-3 py-2 text-sm border dark:border-stone-700 rounded-md bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-1 focus:ring-stone-400"
					placeholder="litellm.internal:4000, ollama.internal:11434, my-azure.openai.azure.com"
				/>
			</ConfigSection>

			<ConfigSection title="Payload Extraction (LLM Providers)">
				<p className="text-xs text-stone-400 mb-3">
					Enable payload extraction to capture GenAI span attributes
					(prompts, completions, tokens) for each provider.
				</p>
				<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
					{SUPPORTED_PROVIDERS.map((key) => (
						<ToggleRow
							key={key}
							label={PROVIDER_LABELS[key]}
							checked={config.payload_extraction[key]}
							onChange={(v) =>
								setConfig((prev) => ({
									...prev,
									payload_extraction: {
										...prev.payload_extraction,
										[key]: v,
									},
								}))
							}
							compact
						/>
					))}
				</div>
			</ConfigSection>

			<div className="flex justify-end pt-2">
				<button
					onClick={handleSave}
					disabled={saving}
					className="flex items-center gap-2 px-4 py-2 bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 rounded-lg text-sm font-medium hover:bg-stone-800 dark:hover:bg-stone-200 disabled:opacity-50 transition-colors"
				>
					{saving ? (
						<Loader2 className="w-4 h-4 animate-spin" />
					) : (
						<Save className="w-4 h-4" />
					)}
					{saving ? "Saving..." : "Save Configuration"}
				</button>
			</div>
		</div>
	);
}

function ConfigSection({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	const [open, setOpen] = useState(true);

	return (
		<div className="border dark:border-stone-700 rounded-lg overflow-hidden">
			<button
				onClick={() => setOpen(!open)}
				className="w-full flex items-center justify-between px-4 py-3 bg-white dark:bg-stone-800 hover:bg-stone-50 dark:hover:bg-stone-800/80 transition-colors"
			>
				<span className="text-sm font-medium text-stone-700 dark:text-stone-300">
					{title}
				</span>
				{open ? (
					<ChevronDown className="w-4 h-4 text-stone-400" />
				) : (
					<ChevronRight className="w-4 h-4 text-stone-400" />
				)}
			</button>
			{open && (
				<div className="px-4 py-4 bg-white dark:bg-stone-800/50 border-t dark:border-stone-700">
					{children}
				</div>
			)}
		</div>
	);
}

function ToggleRow({
	label,
	description,
	checked,
	onChange,
	compact,
}: {
	label: string;
	description?: string;
	checked: boolean;
	onChange: (v: boolean) => void;
	compact?: boolean;
}) {
	return (
		<label
			className={`flex items-center justify-between ${compact ? "py-1" : "py-2"} cursor-pointer group`}
		>
			<div className="flex-1 mr-3">
				<span
					className={`text-stone-700 dark:text-stone-300 ${compact ? "text-xs" : "text-sm font-medium"}`}
				>
					{label}
				</span>
				{description && (
					<p className="text-xs text-stone-400 mt-0.5">
						{description}
					</p>
				)}
			</div>
			<div
				role="switch"
				aria-checked={checked}
				onClick={() => onChange(!checked)}
				className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
					checked
						? "bg-stone-900 dark:bg-stone-100"
						: "bg-stone-300 dark:bg-stone-600"
				}`}
			>
				<span
					className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white dark:bg-stone-900 shadow ring-0 transition duration-200 ease-in-out ${
						checked ? "translate-x-4" : "translate-x-0"
					}`}
				/>
			</div>
		</label>
	);
}

function HeadersEditor({
	headers,
	onChange,
}: {
	headers: Record<string, string>;
	onChange: (headers: Record<string, string>) => void;
}) {
	const entries = Object.entries(headers);

	const addHeader = () => {
		onChange({ ...headers, "": "" });
	};

	const removeHeader = (key: string) => {
		const next = { ...headers };
		delete next[key];
		onChange(next);
	};

	const updateHeader = (oldKey: string, newKey: string, value: string) => {
		const next: Record<string, string> = {};
		for (const [k, v] of Object.entries(headers)) {
			if (k === oldKey) {
				next[newKey] = value;
			} else {
				next[k] = v;
			}
		}
		onChange(next);
	};

	return (
		<div className="mt-3">
			<label className="block text-xs font-medium text-stone-500 dark:text-stone-400 mb-2">
				OTLP Headers
			</label>
			{entries.length > 0 && (
				<div className="flex flex-col gap-2 mb-2">
					{entries.map(([key, value], idx) => (
						<div key={idx} className="flex items-center gap-2">
							<input
								type="text"
								value={key}
								onChange={(e) =>
									updateHeader(key, e.target.value, value)
								}
								placeholder="Header name"
								className="flex-1 px-2 py-1.5 text-xs border dark:border-stone-700 rounded-md bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-1 focus:ring-stone-400"
							/>
							<input
								type="text"
								value={value}
								onChange={(e) =>
									updateHeader(key, key, e.target.value)
								}
								placeholder="Value"
								className="flex-1 px-2 py-1.5 text-xs border dark:border-stone-700 rounded-md bg-white dark:bg-stone-800 text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-1 focus:ring-stone-400"
							/>
							<button
								onClick={() => removeHeader(key)}
								className="text-xs text-red-500 hover:text-red-700 dark:hover:text-red-400 px-1"
							>
								Remove
							</button>
						</div>
					))}
				</div>
			)}
			<button
				onClick={addHeader}
				className="text-xs text-stone-500 hover:text-stone-700 dark:hover:text-stone-300 underline"
			>
				+ Add Header
			</button>
		</div>
	);
}

function mergeConfig(
	defaults: ControllerConfig,
	saved: ControllerConfig
): ControllerConfig {
	return {
		export: {
			otlp_endpoint:
				saved.export?.otlp_endpoint || defaults.export.otlp_endpoint,
			otlp_headers:
				saved.export?.otlp_headers || defaults.export.otlp_headers,
			otlp_protocol:
				saved.export?.otlp_protocol || defaults.export.otlp_protocol,
		},
		discovery: {
			auto_discover:
				saved.discovery?.auto_discover ??
				defaults.discovery.auto_discover,
			instrument:
				saved.discovery?.instrument || defaults.discovery.instrument,
			exclude: saved.discovery?.exclude || defaults.discovery.exclude,
			kubernetes: saved.discovery?.kubernetes,
		},
		payload_extraction: {
			...defaults.payload_extraction,
			...saved.payload_extraction,
		},
		custom_llm_hosts:
			saved.custom_llm_hosts || defaults.custom_llm_hosts || [],
		environment: saved.environment || defaults.environment || "default",
	};
}

function buildDefaultConfig(
	instanceId: string,
	services: ControllerService[]
): ControllerConfig {
	const relevantServices = services.filter(
		(service) => service.controller_instance_id === instanceId
	);
	const sourceServices = relevantServices.some(
		(service) => service.instrumentation_status === "instrumented"
	)
		? relevantServices.filter(
				(service) => service.instrumentation_status === "instrumented"
			)
		: relevantServices;

	const payloadExtraction = { ...DEFAULT_PAYLOAD_EXTRACTION };
	for (const service of sourceServices) {
		for (const provider of service.llm_providers || []) {
			if (provider in payloadExtraction) {
				payloadExtraction[provider as keyof PayloadExtractionConfig] = true;
			}
		}
	}

	return {
		...DEFAULT_CONFIG,
		payload_extraction: payloadExtraction,
	};
}
