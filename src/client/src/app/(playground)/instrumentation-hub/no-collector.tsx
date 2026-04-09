"use client";

import { useState } from "react";
import { Radar, Terminal, Container, Ship } from "lucide-react";

const TABS = [
	{ id: "linux", label: "Linux", icon: Terminal },
	{ id: "docker", label: "Docker", icon: Container },
	{ id: "kubernetes", label: "Kubernetes", icon: Ship },
] as const;

type TabId = (typeof TABS)[number]["id"];

const INSTALL_COMMANDS: Record<TabId, string[]> = {
	linux: [
		"curl -sSL https://get.openlit.io/collector | sudo bash",
		"# Edit /etc/openlit-collector/config.yaml to set your OpenLIT URL",
		"sudo systemctl start openlit-collector",
	],
	docker: [
		"docker run -d --privileged --pid=host \\",
		"  -e OPENLIT_URL=http://<OPENLIT_HOST>:3000 \\",
		"  -p 4321:4321 \\",
		"  ghcr.io/openlit/openlit-collector:latest",
	],
	kubernetes: [
		"helm repo add openlit https://openlit.github.io/helm",
		"helm install openlit-collector openlit/openlit-collector \\",
		"  --set openlit.url=http://openlit:3000",
	],
};

export default function NoCollector() {
	const [activeTab, setActiveTab] = useState<TabId>("linux");

	return (
		<div className="flex flex-col items-center justify-center w-full py-16 px-4">
			<div className="max-w-2xl w-full">
				<div className="flex flex-col items-center mb-8">
					<div className="w-16 h-16 bg-stone-100 dark:bg-stone-800 rounded-full flex items-center justify-center mb-4">
						<Radar className="w-8 h-8 text-stone-500 dark:text-stone-400" />
					</div>
					<h2 className="text-2xl font-semibold text-stone-700 dark:text-stone-200 mb-2">
						No collectors detected
					</h2>
					<p className="text-stone-500 dark:text-stone-400 text-center max-w-md">
						Install the openlit-collector to automatically discover and
						instrument LLM API calls using eBPF.
					</p>
				</div>

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
					<div className="p-4 bg-stone-50 dark:bg-stone-900">
						<pre className="text-sm font-mono text-stone-700 dark:text-stone-300 whitespace-pre-wrap">
							{INSTALL_COMMANDS[activeTab].join("\n")}
						</pre>
					</div>
				</div>
			</div>
		</div>
	);
}
