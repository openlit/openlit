"use client";

import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, CheckCircle, Info } from "lucide-react";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import getMessage from "@/constants/messages";

interface ModelMetadata {
	id: string;
	displayName: string;
	contextWindow?: number;
	inputPricePerMToken?: number;
	outputPricePerMToken?: number;
}

interface ProviderMetadata {
	providerId: string;
	displayName: string;
	supportedModels: ModelMetadata[];
}

export default function ChatSettingsForm() {
	const m = getMessage();
	const [provider, setProvider] = useState("");
	const [model, setModel] = useState("");
	const [vaultId, setVaultId] = useState("");
	const [providers, setProviders] = useState<ProviderMetadata[]>([]);
	const [vaultSecrets, setVaultSecrets] = useState<any[]>([]);
	const [saving, setSaving] = useState(false);
	const [loading, setLoading] = useState(true);
	const [hasExistingConfig, setHasExistingConfig] = useState(false);

	// Load existing config, providers from manage-models, and vault secrets
	useEffect(() => {
		Promise.all([
			fetch("/api/chat/config").then((r) => r.json()),
			fetch("/api/openground/providers").then((r) => r.json()),
			fetch("/api/vault/get", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({}),
			}).then((r) => r.json()),
		])
			.then(([configRes, providersRes, vaultRes]) => {
				if (configRes.data?.provider) {
					setProvider(configRes.data.provider);
					setModel(configRes.data.model || "");
					setVaultId(configRes.data.vaultId || "");
					setHasExistingConfig(true);
				}
				if (Array.isArray(providersRes)) {
					setProviders(providersRes);
				} else if (providersRes?.data && Array.isArray(providersRes.data)) {
					setProviders(providersRes.data);
				}
				if (Array.isArray(vaultRes)) {
					setVaultSecrets(vaultRes);
				} else if (vaultRes?.data) {
					setVaultSecrets(vaultRes.data);
				}
			})
			.catch(() => {
				toast.error(m.CHAT_SETTINGS_LOAD_FAILED);
			})
			.finally(() => setLoading(false));
	}, []);

	const availableModels = useMemo(() => {
		if (!provider) return [];
		const p = providers.find((pr) => pr.providerId === provider);
		return p?.supportedModels || [];
	}, [provider, providers]);

	const handleProviderChange = (newProvider: string) => {
		setProvider(newProvider);
		const p = providers.find((pr) => pr.providerId === newProvider);
		const models = p?.supportedModels || [];
		const currentModelExists = models.some((md) => md.id === model);
		if (!currentModelExists) {
			setModel("");
		}
	};

	const handleSave = async () => {
		if (!provider || !model || !vaultId) {
			toast.error(m.CHAT_SETTINGS_FILL_ALL);
			return;
		}

		setSaving(true);
		try {
			const res = await fetch("/api/chat/config", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ provider, model, vaultId }),
			});

			if (!res.ok) {
				const err = await res.json();
				throw new Error(typeof err === "string" ? err : JSON.stringify(err));
			}

			setHasExistingConfig(true);
			toast.success(m.CHAT_SETTINGS_SAVED);
		} catch (e: any) {
			toast.error(e.message || m.CHAT_SETTINGS_SAVE_FAILED);
		} finally {
			setSaving(false);
		}
	};

	if (loading) {
		return (
			<div className="flex items-center justify-center py-12">
				<Loader2 className="h-6 w-6 animate-spin text-stone-400" />
			</div>
		);
	}

	const selectedProviderName = providers.find((p) => p.providerId === provider)?.displayName;
	const selectedModelObj = availableModels.find((md) => md.id === model);
	const selectedModelName = selectedModelObj?.displayName;
	const selectedVaultName = vaultSecrets.find((s: any) => s.id === vaultId)?.key;

	return (
		<div className="max-w-lg space-y-6">
			{/* Current config indicator */}
			{hasExistingConfig && (
				<div className="flex items-start gap-3 p-4 rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800">
					<CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
					<div className="flex-1">
						<div className="flex items-center gap-2">
							<p className="text-sm font-medium text-green-800 dark:text-green-200">
								{m.CONFIGURED}
							</p>
							<Tooltip>
								<TooltipTrigger asChild>
									<Info className="h-3.5 w-3.5 text-green-600 dark:text-green-400 cursor-help" />
								</TooltipTrigger>
								<TooltipContent side="right" className="max-w-xs text-xs space-y-1.5 p-3">
									<p className="font-medium">Chat Configuration</p>
									<p><span className="text-stone-400">Provider:</span> {selectedProviderName || provider}</p>
									<p><span className="text-stone-400">Model:</span> {selectedModelName || model}</p>
									<p><span className="text-stone-400">API Key:</span> {selectedVaultName || "configured"}</p>
									{selectedModelObj && (
										<>
											<hr className="border-stone-200 dark:border-stone-700" />
											<p className="font-medium">Pricing (per message)</p>
											<p><span className="text-stone-400">Input:</span> ${selectedModelObj.inputPricePerMToken}/M tokens</p>
											<p><span className="text-stone-400">Output:</span> ${selectedModelObj.outputPricePerMToken}/M tokens</p>
											<p><span className="text-stone-400">Context:</span> {selectedModelObj.contextWindow?.toLocaleString()} tokens</p>
											<hr className="border-stone-200 dark:border-stone-700" />
											<p className="font-medium">Cost calculation</p>
											<p className="text-stone-400">cost = (input_tokens / 1M) × input_price + (output_tokens / 1M) × output_price</p>
										</>
									)}
								</TooltipContent>
							</Tooltip>
						</div>
						<p className="text-xs text-green-600 dark:text-green-400 mt-0.5">
							{selectedProviderName} / {selectedModelName || model} / {selectedVaultName || vaultId}
						</p>
					</div>
				</div>
			)}

			<div className="space-y-2">
				<label className="text-sm font-medium text-stone-700 dark:text-stone-300">
					{m.CHAT_SETTINGS_PROVIDER_LABEL}
				</label>
				<Select value={provider} onValueChange={handleProviderChange}>
					<SelectTrigger className="bg-white dark:bg-stone-900">
						<SelectValue placeholder={m.CHAT_SETTINGS_PROVIDER_PLACEHOLDER} />
					</SelectTrigger>
					<SelectContent>
						{providers.map((p) => (
							<SelectItem key={p.providerId} value={p.providerId}>
								{p.displayName}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			<div className="space-y-2">
				<label className="text-sm font-medium text-stone-700 dark:text-stone-300">
					{m.CHAT_SETTINGS_MODEL_LABEL}
				</label>
				<Select value={model} onValueChange={setModel} disabled={!provider}>
					<SelectTrigger className="bg-white dark:bg-stone-900">
						<SelectValue
							placeholder={
								provider
									? m.CHAT_SETTINGS_MODEL_PLACEHOLDER
									: m.CHAT_SETTINGS_SELECT_PROVIDER_FIRST
							}
						/>
					</SelectTrigger>
					<SelectContent>
						{availableModels.map((md) => (
							<SelectItem key={md.id} value={md.id}>
								{md.displayName}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<p className="text-xs text-stone-400 dark:text-stone-500">
					{m.CHAT_SETTINGS_MODEL_HINT}{" "}
					<a
						href="/settings/manage-models"
						className="underline hover:text-stone-600 dark:hover:text-stone-300"
					>
						{m.CHAT_SETTINGS_MANAGE_MODELS}
					</a>
					{m.CHAT_SETTINGS_MODEL_HINT_SUFFIX}
				</p>
			</div>

			<div className="space-y-2">
				<label className="text-sm font-medium text-stone-700 dark:text-stone-300">
					{m.CHAT_SETTINGS_API_KEY_LABEL}
				</label>
				<Select value={vaultId} onValueChange={setVaultId}>
					<SelectTrigger className="bg-white dark:bg-stone-900">
						<SelectValue placeholder={m.CHAT_SETTINGS_API_KEY_PLACEHOLDER} />
					</SelectTrigger>
					<SelectContent>
						{vaultSecrets.map((secret: any) => (
							<SelectItem key={secret.id} value={secret.id}>
								{secret.key}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<p className="text-xs text-stone-400 dark:text-stone-500">
					{m.CHAT_SETTINGS_API_KEY_HINT_PREFIX}{" "}
					<a
						href="/vault"
						className="underline hover:text-stone-600 dark:hover:text-stone-300"
					>
						{m.FEATURE_VAULT}
					</a>{" "}
					{m.CHAT_SETTINGS_API_KEY_HINT_SUFFIX}
				</p>
			</div>

			<Button onClick={handleSave} disabled={saving}>
				{saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
				{hasExistingConfig ? m.OPENGROUND_UPDATE_CONFIGURATION : m.CHAT_SETTINGS_SAVE}
			</Button>
		</div>
	);
}
