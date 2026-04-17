"use client";

import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SearchIcon, PlusIcon, ChevronDownIcon, ChevronRightIcon, PencilIcon } from "lucide-react";
import getMessage from "@/constants/messages";
import { ProviderMetadata, ModelMetadata } from "@/types/openground";
import { cn } from "@/lib/utils";

interface CustomModel extends ModelMetadata {
	id: string;
	customId?: string; // UUID from database
	model_id: string; // Model identifier like "gpt-4o"
	provider?: string;
	modelType?: string;
	isDefault?: boolean;
}

interface ModelListSidebarProps {
	providers: ProviderMetadata[];
	customModels: Record<string, CustomModel[]>;
	loading: boolean;
	selectedModel: ModelMetadata | null;
	selectedProvider: string | null;
	selectedIsCustom: boolean;
	onSelectModel: (model: ModelMetadata, provider: string, isCustom: boolean) => void;
	onAddNew: (provider: string) => void;
}

export default function ModelListSidebar({
	providers,
	customModels,
	loading,
	selectedModel,
	selectedProvider,
	selectedIsCustom,
	onSelectModel,
	onAddNew,
}: ModelListSidebarProps) {
	const [searchQuery, setSearchQuery] = useState("");
	const [expandedProviders, setExpandedProviders] = useState<Set<string>>(new Set());

	const toggleProvider = (providerId: string) => {
		const newExpanded = new Set(expandedProviders);
		if (newExpanded.has(providerId)) {
			newExpanded.delete(providerId);
		} else {
			newExpanded.add(providerId);
		}
		setExpandedProviders(newExpanded);
	};

	const filteredProviders = useMemo(() => {
		if (!searchQuery.trim()) return providers;

		const query = searchQuery.toLowerCase();
		return providers.filter((provider) => {
			const matchesProviderName = provider.displayName.toLowerCase().includes(query);
			const matchesModelName = (customModels[provider.providerId] || []).some(
				(model) =>
					model.displayName.toLowerCase().includes(query) ||
					(model.model_id || "").toLowerCase().includes(query)
			);

			return matchesProviderName || matchesModelName;
		});
	}, [providers, customModels, searchQuery]);

	const isModelSelected = (model: CustomModel, provider: string) => {
		if (selectedProvider !== provider) return false;
		if (!selectedModel) return false;

		const selectedCustomModel = selectedModel as any;
		const currentKey = model.customId || model.id || model.model_id;
		const selectedKey =
			selectedCustomModel.customId || selectedCustomModel.id || selectedCustomModel.model_id;
		return currentKey === selectedKey;
	};

	return (
		<div className="w-80 border-r border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 flex flex-col">
			{/* Search */}
			<div className="p-4 border-b border-stone-200 dark:border-stone-800">
				<div className="relative">
					<SearchIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-stone-400" />
					<Input
						placeholder={getMessage().OPENGROUND_SEARCH_MODELS}
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						className="pl-9"
					/>
				</div>
			</div>

			{/* Provider List */}
			<div className="flex-1 overflow-y-auto">
				{loading ? (
					<div className="p-4 text-center text-sm text-stone-500">
						{getMessage().LOADING}...
					</div>
				) : filteredProviders.length === 0 ? (
					<div className="p-4 text-center text-sm text-stone-500">
						{getMessage().OPENGROUND_NO_MODELS_FOUND}
					</div>
				) : (
					<div className="p-2">
						{filteredProviders.map((provider) => {
							const isExpanded = expandedProviders.has(provider.providerId);
							const providerModels = customModels[provider.providerId] || [];
							const totalModels = providerModels.length;

							return (
								<div key={provider.providerId} className="mb-2">
									{/* Provider Header */}
									<button
										onClick={() => toggleProvider(provider.providerId)}
										className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
									>
										<div className="flex items-center gap-2">
											{isExpanded ? (
												<ChevronDownIcon className="h-4 w-4 text-stone-500" />
											) : (
												<ChevronRightIcon className="h-4 w-4 text-stone-500" />
											)}
											<span className="font-medium text-sm text-stone-900 dark:text-stone-100">
												{provider.displayName}
											</span>
											<Badge variant="secondary" className="text-xs">
												{totalModels}
											</Badge>
										</div>
										<Button
											variant="ghost"
											size="sm"
											className="h-6 w-6 p-0 text-stone-500"
											onClick={(e) => {
												e.stopPropagation();
												onAddNew(provider.providerId);
											}}
										>
											<PlusIcon className="h-3 w-3" />
										</Button>
									</button>

									{/* Models List — all editable */}
									{isExpanded && (
										<div className="ml-4 mt-1 space-y-1">
											{providerModels.length === 0 ? (
												<div className="text-xs text-stone-400 dark:text-stone-500 px-2 py-2">
													{getMessage().OPENGROUND_NO_MODELS_FOUND}
												</div>
											) : (
												providerModels.map((model) => (
													<button
														key={model.customId || model.id || model.model_id}
														onClick={() => onSelectModel(model, provider.providerId, true)}
														className={cn(
															"w-full text-left p-2 rounded-md transition-colors border-l-2 group/model",
															isModelSelected(model, provider.providerId)
																? "bg-primary/10 dark:bg-primary/20 border-primary text-stone-900 dark:text-stone-100"
																: "border-transparent hover:bg-stone-100 dark:hover:bg-stone-800 text-stone-700 dark:text-stone-300"
														)}
													>
														<div className="flex items-center justify-between">
															<div className="flex items-center gap-2">
																<div className="text-sm font-medium">{model.displayName}</div>
																{model.isDefault ? (
																	<Badge variant="outline" className="text-xs h-4">Default</Badge>
																) : (
																	<Badge className="text-xs h-4">Custom</Badge>
																)}
															</div>
															<PencilIcon className="h-3 w-3 text-stone-400 opacity-0 group-hover/model:opacity-100 transition-opacity" />
														</div>
														<div className="flex items-center gap-2 mt-1">
															<Badge variant="outline" className="text-xs">
																{(model.contextWindow || 0).toLocaleString()} tokens
															</Badge>
															<Badge variant="outline" className="text-xs">
																${model.inputPricePerMToken}/M
															</Badge>
														</div>
													</button>
												))
											)}
										</div>
									)}
								</div>
							);
						})}
					</div>
				)}
			</div>
		</div>
	);
}
