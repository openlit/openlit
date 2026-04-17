"use client";

import { useState, useEffect, useMemo } from "react";
import { usePostHog } from "posthog-js/react";
import { CLIENT_EVENTS } from "@/constants/events";
import { Button } from "@/components/ui/button";
import {
	SettingsIcon,
	Download,
	Upload,
	Copy,
	Link as LinkIcon,
	Code2,
} from "lucide-react";
import getMessage from "@/constants/messages";
import ModelListSidebar from "@/components/(playground)/openground/model-list-sidebar";
import ModelEditorPanel from "@/components/(playground)/openground/model-editor-panel";
import SdkUsageDialog from "@/components/(playground)/openground/sdk-usage-dialog";
import { ProviderMetadata, ModelMetadata } from "@/types/openground";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useRootStore } from "@/store";
import { getDatabaseConfigList } from "@/selectors/database-config";
import { Input } from "@/components/ui/input";
import copy from "copy-to-clipboard";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface CustomModel extends ModelMetadata {
	id: string;
	customId?: string;
	model_id: string;
	provider?: string;
	modelType?: string;
}

export default function ManageModelsPage() {
	const m = getMessage();
	const posthog = usePostHog();
	const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
	const [selectedModel, setSelectedModel] = useState<ModelMetadata | null>(null);
	const [isCustomModel, setIsCustomModel] = useState(false);
	const [isAddingNew, setIsAddingNew] = useState(false);
	const [showImport, setShowImport] = useState(false);
	const [showSdkUsage, setShowSdkUsage] = useState(false);
	const [importJson, setImportJson] = useState("");

	// Pull the active database config from the zustand store
	const databaseConfigList = useRootStore(getDatabaseConfigList) || [];
	const activeDbConfig = useMemo(
		() => databaseConfigList.find((item) => !!item.isCurrent),
		[databaseConfigList]
	);
	const dbConfigId = activeDbConfig?.id || "";

	const {
		data: providers,
		fireRequest: fetchProviders,
		isLoading: loadingProviders,
	} = useFetchWrapper<ProviderMetadata[]>();
	const {
		data: customModels,
		fireRequest: fetchCustomModels,
		isLoading: loadingCustom,
	} = useFetchWrapper<Record<string, CustomModel[]>>();
	const { fireRequest: fireImport, isLoading: importing } = useFetchWrapper();

	useEffect(() => {
		posthog?.capture(CLIENT_EVENTS.SETTINGS_MANAGE_MODELS_PAGE_VISITED);
	}, []);

	useEffect(() => {
		loadProviders();
		loadAllCustomModels();
	}, []);

	const loadProviders = () => {
		fetchProviders({ requestType: "GET", url: "/api/openground/providers" });
	};

	const loadAllCustomModels = () => {
		fetchCustomModels({ requestType: "GET", url: "/api/openground/models" });
	};

	const handleSelectModel = (
		model: ModelMetadata,
		provider: string,
		_isCustom: boolean
	) => {
		setSelectedModel(model);
		setSelectedProvider(provider);
		setIsCustomModel(true);
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

	// Build the public pricing URL from the active db config
	const pricingUrl = dbConfigId
		? `${typeof window !== "undefined" ? window.location.origin : ""}/api/pricing/export/${dbConfigId}`
		: "";

	const copyUrl = () => {
		if (!pricingUrl) return;
		copy(pricingUrl);
		toast.success(m.MANAGE_MODELS_PRICING_URL_COPIED, { id: "url-copy" });
	};

	const handleImport = () => {
		let parsed: any;
		try {
			parsed = JSON.parse(importJson);
		} catch {
			toast.error(m.MANAGE_MODELS_INVALID_JSON, { id: "import" });
			return;
		}

		fireImport({
			requestType: "POST",
			url: "/api/openground/models/import",
			body: JSON.stringify(parsed),
			successCb: (res: any) => {
				toast.success(
					`${m.MANAGE_MODELS_IMPORT_SUCCESS}: ${res?.imported ?? 0} imported, ${res?.skipped ?? 0} skipped`,
					{ id: "import" }
				);
				setShowImport(false);
				setImportJson("");
				loadAllCustomModels();
				loadProviders();
			},
			failureCb: (err?: string) => {
				toast.error(err || m.MANAGE_MODELS_IMPORT_FAILED, { id: "import" });
			},
		});
	};

	return (
		<div className="flex flex-col h-full w-full overflow-hidden">
			{/* Header */}
			<div className="flex items-center justify-between p-4 border-b border-stone-200 dark:border-stone-800 shrink-0">
				<div className="flex flex-col gap-2">
					<h1 className="text-lg font-semibold text-stone-900 dark:text-stone-100">
						{m.OPENGROUND_MANAGE_MODELS}
					</h1>
					<p className="text-sm text-stone-500 dark:text-stone-400 mt-0.5">
						{m.OPENGROUND_MANAGE_MODELS_DESCRIPTION}
					</p>
				</div>
				<div className="flex items-center gap-2">
					{pricingUrl && (

						<Tooltip>
							<TooltipTrigger>
								<Button
									variant="outline"
									size="sm"
									className="gap-2"
									onClick={() => setShowSdkUsage(true)}
								>
									<Code2 className="h-4 w-4" />
								</Button>
							</TooltipTrigger>
							<TooltipContent>
								{m.MANAGE_MODELS_SDK_USAGE}
							</TooltipContent>
						</Tooltip>
					)}
					<Tooltip>
						<TooltipTrigger>
							<Button
								variant="outline"
								size="sm"
								className="gap-2"
								onClick={() => setShowImport(true)}
							>
								<Upload className="h-4 w-4" />
							</Button>
						</TooltipTrigger>
						<TooltipContent>
							{m.MANAGE_MODELS_IMPORT_PRICING}
						</TooltipContent>
					</Tooltip>
					<Tooltip>
						<TooltipTrigger>
							<Button
								variant="outline"
								size="sm"
								className="gap-2"
								onClick={() => {
									window.open("/api/openground/models/export", "_blank");
								}}
							>
								<Download className="h-4 w-4" />
							</Button>
						</TooltipTrigger>
						<TooltipContent>
							{m.MANAGE_MODELS_EXPORT_PRICING}
						</TooltipContent>
					</Tooltip>
				</div>
			</div>

			{/* SDK Pricing URL bar */}
			{pricingUrl && (
				<div className="flex items-center gap-3 px-4 py-2.5 bg-stone-50 dark:bg-stone-950 border-b border-stone-200 dark:border-stone-800 shrink-0">
					<LinkIcon className="h-3.5 w-3.5 text-stone-400 shrink-0" />
					<span className="text-xs font-medium text-stone-500 dark:text-stone-400 shrink-0">
						{m.MANAGE_MODELS_PRICING_URL_LABEL}
					</span>
					<Input
						readOnly
						value={pricingUrl}
						onFocus={(e) => e.target.select()}
						className="font-mono text-xs h-8 flex-1 min-w-0"
					/>
					<Button
						variant="outline"
						size="sm"
						className="gap-1.5 shrink-0 h-8"
						onClick={copyUrl}
					>
						<Copy className="h-3.5 w-3.5" />
						{m.COPY}
					</Button>
				</div>
			)}

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
								{m.OPENGROUND_SELECT_MODEL_TO_VIEW}
							</h3>
							<p className="text-sm text-stone-500 dark:text-stone-400 max-w-md">
								{m.OPENGROUND_SELECT_MODEL_TO_VIEW_DESCRIPTION}
							</p>
							{pricingUrl && (
								<Button
									variant="outline"
									size="sm"
									className="gap-2 mt-6"
									onClick={() => setShowSdkUsage(true)}
								>
									<Code2 className="h-4 w-4" />
									{m.MANAGE_MODELS_SDK_USAGE}
								</Button>
							)}
						</div>
					)}
				</div>
			</div>

			{/* Import Dialog */}
			<Dialog open={showImport} onOpenChange={setShowImport}>
				<DialogContent className="sm:max-w-lg">
					<DialogHeader>
						<DialogTitle>{m.MANAGE_MODELS_IMPORT_DIALOG_TITLE}</DialogTitle>
						<DialogDescription>
							{m.MANAGE_MODELS_IMPORT_DIALOG_DESCRIPTION}
						</DialogDescription>
					</DialogHeader>
					<Textarea
						placeholder={`{
  "models": [
    {
      "provider": "openai",
      "model_id": "gpt-4o-2024-08-06",
      "displayName": "GPT-4o (Aug 2024)",
      "inputPricePerMToken": 2.5,
      "outputPricePerMToken": 10
    }
  ]
}`}
						value={importJson}
						onChange={(e) => setImportJson(e.target.value)}
						className="min-h-[200px] text-xs dark:text-stone-100 text-stone-800"
					/>
					<DialogFooter>
						<Button variant="outline" onClick={() => setShowImport(false)}>
							{m.CANCEL}
						</Button>
						<Button onClick={handleImport} disabled={importing || !importJson.trim()}>
							{importing ? m.SAVING : m.MANAGE_MODELS_IMPORT_PRICING}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* SDK Usage Dialog */}
			<SdkUsageDialog
				open={showSdkUsage}
				onOpenChange={setShowSdkUsage}
				pricingUrl={pricingUrl}
			/>
		</div>
	);
}
