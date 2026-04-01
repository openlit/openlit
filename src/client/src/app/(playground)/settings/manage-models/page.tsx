"use client";

import { useState, useEffect } from "react";
import { usePostHog } from "posthog-js/react";
import { CLIENT_EVENTS } from "@/constants/events";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeftIcon, SettingsIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import getMessage from "@/constants/messages";
import ModelListSidebar from "@/components/(playground)/openground/model-list-sidebar";
import ModelEditorPanel from "@/components/(playground)/openground/model-editor-panel";
import { ProviderMetadata, ModelMetadata } from "@/types/openground";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";

interface CustomModel extends ModelMetadata {
	id: string;
	model_id: string;
	provider?: string;
}

export default function SettingsManageModelsPage() {
	const posthog = usePostHog();
	const router = useRouter();
	const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
	const [selectedModel, setSelectedModel] = useState<ModelMetadata | null>(null);
	const [isCustomModel, setIsCustomModel] = useState(false);
	const [isAddingNew, setIsAddingNew] = useState(false);

	const { data: providers, fireRequest: fetchProviders, isLoading: loadingProviders } =
		useFetchWrapper<ProviderMetadata[]>();
	const { data: customModels, fireRequest: fetchCustomModels, isLoading: loadingCustom } =
		useFetchWrapper<Record<string, CustomModel[]>>();

	useEffect(() => {
		posthog?.capture(CLIENT_EVENTS.SETTINGS_MANAGE_MODELS_PAGE_VISITED);
	}, []);

	useEffect(() => {
		loadProviders();
		loadAllCustomModels();
	}, []);

	const loadProviders = () => {
		fetchProviders({
			requestType: "GET",
			url: "/api/openground/providers",
		});
	};

	const loadAllCustomModels = () => {
		fetchCustomModels({
			requestType: "GET",
			url: "/api/openground/models",
		});
	};

	const handleSelectModel = (model: ModelMetadata, provider: string, isCustom: boolean) => {
		setSelectedModel(model);
		setSelectedProvider(provider);
		setIsCustomModel(isCustom);
		setIsAddingNew(false);
	};

	const handleAddNew = (provider: string) => {
		setSelectedProvider(provider);
		setSelectedModel(null);
		setIsCustomModel(true);
		setIsAddingNew(true);
	};

	const handleModelSaved = () => {
		loadAllCustomModels();
		setIsAddingNew(false);
	};

	const handleModelDeleted = () => {
		loadAllCustomModels();
		setSelectedModel(null);
		setSelectedProvider(null);
		setIsCustomModel(false);
	};

	return (
		<div className="flex flex-col h-full w-full overflow-hidden">
			{/* Header */}
			<div className="flex items-center justify-between p-4 border-b border-stone-200 dark:border-stone-800 shrink-0">
				<div className="flex flex-col gap-2">
					<h1 className="text-lg font-semibold text-stone-900 dark:text-stone-100">
						{getMessage().OPENGROUND_MANAGE_MODELS}
					</h1>
					<p className="text-sm text-stone-500 dark:text-stone-400 mt-0.5">
						{getMessage().OPENGROUND_MANAGE_MODELS_DESCRIPTION}
					</p>
				</div>
			</div>

			{/* Main Content - Split Layout */}
			<div className="flex flex-1 overflow-hidden min-h-0">
				<ModelListSidebar
					providers={providers || []}
					customModels={customModels || {}}
					loading={loadingProviders || loadingCustom}
					selectedModel={selectedModel}
					selectedProvider={selectedProvider}
					selectedIsCustom={isCustomModel}
					onSelectModel={handleSelectModel}
					onAddNew={handleAddNew}
				/>

				<div className="flex-1 overflow-auto bg-stone-50 dark:bg-stone-950">
					{selectedModel || isAddingNew ? (
						<ModelEditorPanel
							model={selectedModel}
							provider={selectedProvider}
							isCustomModel={isCustomModel}
							isAddingNew={isAddingNew}
							onSave={handleModelSaved}
							onDelete={handleModelDeleted}
							onCancel={() => {
								setSelectedModel(null);
								setSelectedProvider(null);
								setIsAddingNew(false);
							}}
						/>
					) : (
						<div className="flex flex-col items-center justify-center h-full p-8 text-center">
							<SettingsIcon className="h-16 w-16 text-stone-300 dark:text-stone-700 mb-4" />
							<h3 className="text-lg font-medium text-stone-900 dark:text-stone-100 mb-2">
								{getMessage().OPENGROUND_SELECT_MODEL_TO_VIEW}
							</h3>
							<p className="text-sm text-stone-500 dark:text-stone-400 max-w-md">
								{getMessage().OPENGROUND_SELECT_MODEL_TO_VIEW_DESCRIPTION}
							</p>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
