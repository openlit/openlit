"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
	Radar,
	Copy,
	Check,
	KeyRound,
	Info,
} from "lucide-react";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { getPingStatus } from "@/selectors/database-config";
import { useRootStore } from "@/store";
import { ApiKey } from "@/types/api-key";
import copy from "copy-to-clipboard";
import KubernetesSvg from "@/components/svg/kubernetes";
import DockerSvg from "@/components/svg/docker";
import LinuxSvg from "@/components/svg/linux";

const TABS = [
	{ id: "kubernetes", label: "Kubernetes", icon: KubernetesSvg },
	{ id: "docker", label: "Docker", icon: DockerSvg },
	{ id: "linux", label: "Linux", icon: LinuxSvg },
] as const;

type TabId = (typeof TABS)[number]["id"];

function buildCommands(
	tab: TabId,
	openlitUrl: string,
	apiKey?: string
): string {
	const keyLine = apiKey ? `\n  -e OPENLIT_API_KEY="${apiKey}" \\` : "";
	const helmKeyFlag = apiKey
		? `\n  --set controller.apiKey="${apiKey}"`
		: "";
	const systemdKey = apiKey
		? `\nEnvironment="OPENLIT_API_KEY=${apiKey}"`
		: "";

	switch (tab) {
		case "linux":
			return [
				`curl -fsSL https://github.com/openlit/openlit/releases/latest/download/openlit-controller-linux-amd64 \\`,
				`  -o /usr/local/bin/openlit-controller`,
				`chmod +x /usr/local/bin/openlit-controller`,
				``,
				`# Create a systemd service`,
				`cat > /etc/systemd/system/openlit-controller.service << 'EOF'`,
				`[Unit]`,
				`Description=OpenLIT Controller`,
				`After=network.target`,
				``,
				`[Service]`,
				`Environment="OPENLIT_URL=${openlitUrl}"`,
				`Environment="OTEL_EXPORTER_OTLP_ENDPOINT=${openlitUrl.replace(/:\d+$/, ":4318")}"`,
				...(apiKey ? [`Environment="OPENLIT_API_KEY=${apiKey}"`] : []),
				`ExecStart=/usr/local/bin/openlit-controller`,
				`Restart=always`,
				``,
				`[Install]`,
				`WantedBy=multi-user.target`,
				`EOF`,
				``,
				`systemctl daemon-reload`,
				`systemctl enable --now openlit-controller`,
			].join("\n");
		case "docker":
			return [
				`docker run -d --privileged --pid=host \\`,
				`  -e OPENLIT_URL="${openlitUrl}" \\`,
				`  -e OTEL_EXPORTER_OTLP_ENDPOINT="${openlitUrl.replace(/:\d+$/, ":4318")}" \\`,
				...(apiKey ? [`  -e OPENLIT_API_KEY="${apiKey}" \\`] : []),
				`  -v /proc:/host/proc:ro \\`,
				`  -v /sys/kernel/debug:/sys/kernel/debug:ro \\`,
				`  -v /sys/fs/bpf:/sys/fs/bpf:rw \\`,
				`  -v /var/run/docker.sock:/var/run/docker.sock \\`,
				`  -e OPENLIT_PROC_ROOT="/host/proc" \\`,
				`  ghcr.io/openlit/controller:latest`,
			].join("\n");
		case "kubernetes":
			return [
				`helm repo add openlit https://openlit.github.io/helm`,
				`helm repo update`,
				`helm upgrade --install openlit openlit/openlit \\`,
				`  --set openlit-controller.enabled=true`,
				...(apiKey
					? [`  --set openlit-controller.apiKey="${apiKey}"`]
					: []),
			].join("\n");
	}
}

export default function NoController() {
	const [activeTab, setActiveTab] = useState<TabId>("kubernetes");
	const [copied, setCopied] = useState(false);
	const [openlitUrl, setOpenlitUrl] = useState("http://localhost:3000");

	const pingStatus = useRootStore(getPingStatus);
	const { data: apiKeys, fireRequest } = useFetchWrapper<ApiKey[]>();

	useEffect(() => {
		if (typeof window !== "undefined") {
			setOpenlitUrl(window.location.origin);
		}
	}, []);

	const fetchKeys = useCallback(() => {
		fireRequest({
			requestType: "GET",
			url: "/api/api-key",
		});
	}, [fireRequest]);

	useEffect(() => {
		if (pingStatus !== "pending") fetchKeys();
	}, [pingStatus, fetchKeys]);

	const firstKey = apiKeys && apiKeys.length > 0 ? apiKeys[0].apiKey : undefined;

	const commands = useMemo(
		() => buildCommands(activeTab, openlitUrl, firstKey),
		[activeTab, openlitUrl, firstKey]
	);

	const handleCopy = () => {
		copy(commands);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<div className="flex flex-col items-center justify-center w-full py-16 px-4">
			<div className="max-w-2xl w-full">
				<div className="flex flex-col items-center mb-8">
					<div className="w-16 h-16 bg-stone-100 dark:bg-stone-800 rounded-full flex items-center justify-center mb-4">
						<Radar className="w-8 h-8 text-stone-500 dark:text-stone-400" />
					</div>
					<h2 className="text-2xl font-semibold text-stone-700 dark:text-stone-200 mb-2">
						No controllers detected
					</h2>
					<p className="text-stone-500 dark:text-stone-400 text-center max-w-md">
						Install the OpenLIT Controller to automatically discover and
						instrument LLM API calls using eBPF.
					</p>
				</div>

				{firstKey && (
					<div className="flex items-start gap-3 mb-4 p-3 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30">
						<KeyRound className="w-4 h-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
						<p className="text-sm text-emerald-700 dark:text-emerald-300">
							Commands below are pre-filled with your API key and
							dashboard URL. The controller will authenticate
							automatically.
						</p>
					</div>
				)}

				{!firstKey && (
					<div className="flex items-start gap-3 mb-4 p-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30">
						<Info className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
						<p className="text-sm text-amber-700 dark:text-amber-300">
							<strong>Recommended:</strong> Create an API key in{" "}
							<a
								href="/settings"
								className="underline hover:text-amber-900 dark:hover:text-amber-100"
							>
								Settings &rarr; API Keys
							</a>{" "}
							to secure your controller connection. Once created,
							refresh this page to see pre-filled commands.
						</p>
					</div>
				)}

				<div className="border dark:border-stone-700 rounded-lg overflow-hidden">
					<div className="flex border-b dark:border-stone-700">
						{TABS.map((tab) => {
							const Icon = tab.icon;
							return (
								<button
									key={tab.id}
									onClick={() => setActiveTab(tab.id)}
									className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
										activeTab === tab.id
											? "bg-stone-100 dark:bg-stone-800 text-stone-900 dark:text-stone-100 border-b-2 border-stone-900 dark:border-stone-100"
											: "text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-300"
									}`}
								>
									<Icon className="w-4 h-4" />
									{tab.label}
								</button>
							);
						})}
					</div>
					<div className="relative p-4 bg-stone-50 dark:bg-stone-900">
						<button
							onClick={handleCopy}
							className="absolute top-3 right-3 p-1.5 rounded-md text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 hover:bg-stone-200 dark:hover:bg-stone-800 transition-colors"
							title="Copy to clipboard"
						>
							{copied ? (
								<Check className="w-4 h-4 text-emerald-500" />
							) : (
								<Copy className="w-4 h-4" />
							)}
						</button>
						<pre className="text-sm font-mono text-stone-700 dark:text-stone-300 whitespace-pre-wrap pr-8">
							{commands}
						</pre>
					</div>
				</div>
			</div>
		</div>
	);
}
