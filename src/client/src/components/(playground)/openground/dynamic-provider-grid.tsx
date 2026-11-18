"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useRootStore } from "@/store";
import { CheckCircle2Icon, SettingsIcon } from "lucide-react";
import { useEffect, useState } from "react";
import ProviderConfigDialog from "./provider-config-dialog";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { toast } from "sonner";
import getMessage from "@/constants/messages";

export default function DynamicProviderGrid() {
	const availableProviders = useRootStore((state) => state.openground.availableProviders);
	const selectedProvidersNew = useRootStore((state) => state.openground.selectedProvidersNew);
	const loadAvailableProviders = useRootStore((state) => state.openground.loadAvailableProviders);
	const addProviderNew = useRootStore((state) => state.openground.addProviderNew);

	const { data: providerConfigsData, fireRequest: fireConfigRequest } =
		useFetchWrapper<any[]>();
	const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
	const [configDialogOpen, setConfigDialogOpen] = useState(false);
	const [providerConfigs, setProviderConfigs] = useState<Record<string, boolean>>({});

	useEffect(() => {
		loadAvailableProviders();
		loadProviderConfigs();
	}, []);

	useEffect(() => {
		if (providerConfigsData) {
			const configMap: Record<string, boolean> = {};
			providerConfigsData.forEach((config: any) => {
				configMap[config.provider] = config.isActive;
			});
			setProviderConfigs(configMap);
		}
	}, [providerConfigsData]);

	const loadProviderConfigs = () => {
		fireConfigRequest({
			requestType: "GET",
			url: "/api/openground/config",
			failureCb: (err?: string) => {
				toast.error(err || getMessage().OPENGROUND_LOAD_CONFIG_FAILED, {
					id: "provider-configs",
				});
			},
		});
	};

	const handleProviderClick = (providerId: string) => {
		const hasConfig = providerConfigs[providerId];

		if (hasConfig) {
			// Always allow adding provider (can select same provider multiple times with different models)
			const provider = availableProviders.find((p) => p.providerId === providerId);
			if (provider && provider.supportedModels.length > 0) {
				addProviderNew(providerId, provider.supportedModels[0].id, true);
				toast.success(`${provider.displayName} ${getMessage().OPENGROUND_PROVIDER_ADDED}`, {
					id: "provider-add",
				});
			}
		} else {
			// Open config dialog
			setSelectedProvider(providerId);
			setConfigDialogOpen(true);
		}
	};

	const handleEditConfig = (providerId: string, event: React.MouseEvent) => {
		event.stopPropagation();
		setSelectedProvider(providerId);
		setConfigDialogOpen(true);
	};

	const getProviderCount = (providerId: string) => {
		return selectedProvidersNew.filter((p) => p.provider === providerId).length;
	};

	const handleConfigComplete = () => {
		setConfigDialogOpen(false);
		setSelectedProvider(null);
		loadProviderConfigs();
	};

	return (
		<>
			<Card className="border border-stone-200 dark:border-stone-800">
				<CardHeader className="p-4 pb-2">
					<CardTitle className="text-sm font-medium text-stone-700 dark:text-stone-300">
						{getMessage().OPENGROUND_SELECT_PROVIDERS}
					</CardTitle>
				</CardHeader>
				<CardContent className="p-4 pt-0">
					<div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
						{availableProviders.map((provider) => {
							const hasConfig = providerConfigs[provider.providerId];
							const providerCount = getProviderCount(provider.providerId);

							return (
								<div
									key={provider.providerId}
									role="button"
									tabIndex={0}
									className={`relative cursor-pointer rounded-md border bg-white p-4 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 dark:bg-stone-950 ${providerCount > 0
										? "border-primary bg-primary/5 dark:border-primary dark:bg-primary/10"
										: hasConfig
											? "border-stone-200 hover:border-primary/60 dark:border-stone-800 dark:hover:border-primary/60"
											: "border-stone-200 hover:border-stone-400 dark:border-stone-800 dark:hover:border-stone-600"
										}`}
									onClick={() => handleProviderClick(provider.providerId)}
									onKeyDown={(e) => {
										if (e.target !== e.currentTarget) return;
										if (e.key === "Enter" || e.key === " ") {
											e.preventDefault();
											handleProviderClick(provider.providerId);
										}
									}}
								>
									{providerCount > 0 && (
										<Badge className="absolute -right-2 -top-2 z-10 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-xs text-white hover:bg-primary">
											{providerCount}
										</Badge>
									)}
									{hasConfig && (
										<Button
											variant="ghost"
											size="sm"
											className="absolute right-2 top-2 z-10 h-6 w-6 p-0 text-stone-500 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800"
											onClick={(e) => handleEditConfig(provider.providerId, e)}
											title={getMessage().OPENGROUND_EDIT_PROVIDER_CONFIG}
											aria-label={getMessage().OPENGROUND_EDIT_PROVIDER_CONFIG}
										>
											<SettingsIcon className="h-3 w-3" />
										</Button>
									)}
									<div className="flex flex-col items-center gap-2">
										<div
											className={`flex h-10 w-10 items-center justify-center rounded-md text-base font-semibold ${providerCount > 0
												? "bg-primary text-white"
												: "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300"
												}`}
										>
											{provider.displayName.charAt(0)}
										</div>
										<div className="space-y-0.5">
											<p className="text-sm font-medium text-stone-900 dark:text-stone-100">
												{provider.displayName}
											</p>
											<p className="text-xs text-stone-500 dark:text-stone-400">
												{getMessage().OPENGROUND_MODEL_COUNT(provider.supportedModels.length)}
											</p>
										</div>
										{hasConfig ? (
											<Badge
												variant="outline"
												className="border-emerald-200 bg-emerald-50 text-xs text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-300"
											>
												<CheckCircle2Icon className="mr-1 h-3 w-3" />
												{getMessage().CONFIGURED}
											</Badge>
										) : (
											<Badge
												variant="outline"
												className="border-amber-200 bg-amber-50 text-xs text-amber-700 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-300"
											>
												<SettingsIcon className="mr-1 h-3 w-3" />
												{getMessage().CONFIGURE}
											</Badge>
										)}
									</div>
								</div>
							);
						})}
					</div>

					{selectedProvidersNew.length > 0 && (
						<div className="mt-4 rounded-md border border-stone-200 bg-stone-50 px-4 py-3 dark:border-stone-800 dark:bg-stone-900">
							<p className="text-sm font-medium text-stone-900 dark:text-stone-100">
								{getMessage().OPENGROUND_PROVIDERS_SELECTED(selectedProvidersNew.length)}
							</p>
							<p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
								{getMessage().OPENGROUND_CLICK_PROVIDER_CARD_TO_CHANGE_MODEL_OR_SETTINGS}
							</p>
						</div>
					)}
				</CardContent>
			</Card>

			{selectedProvider && (
				<ProviderConfigDialog
					providerId={selectedProvider}
					open={configDialogOpen}
					onOpenChange={setConfigDialogOpen}
					onComplete={handleConfigComplete}
				/>
			)}
		</>
	);
}
