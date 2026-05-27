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
import { Loader2, CheckCircle, Info, Settings } from "lucide-react";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import getMessage from "@/constants/messages";
import SecretForm from "@/components/(playground)/vault/form";

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
		<div className="flex h-full flex-col bg-white dark:bg-stone-950">
			<div className="flex shrink-0 items-center justify-between gap-3 border-b border-stone-200 bg-stone-50 px-4 py-3 dark:border-stone-800 dark:bg-stone-900">
				<div className="min-w-0">
					<div className="flex items-center gap-2 text-sm font-semibold text-stone-900 dark:text-stone-100">
						<Settings className="h-4 w-4 text-primary" />
						{m.CHAT_SETTINGS_TITLE}
					</div>
					<div className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">
						{m.CHAT_SETTINGS_DESCRIPTION}
					</div>
				</div>
				{hasExistingConfig && (
					<div className="flex min-w-0 shrink-0 items-center gap-1.5 rounded-md border border-stone-200 bg-white px-2 py-1 dark:border-stone-800 dark:bg-stone-950">
						<CheckCircle className="h-3 w-3 shrink-0 text-green-600 dark:text-green-400" />
						<div className="min-w-0">
							<div className="text-[11px] font-medium leading-4 text-stone-900 dark:text-stone-100">
								{m.CONFIGURED}
							</div>
							<div className="max-w-[260px] truncate text-[10px] leading-3 text-stone-500 dark:text-stone-400">
								{selectedProviderName || provider} / {selectedModelName || model} / {selectedVaultName || vaultId}
							</div>
						</div>
						<Tooltip>
							<TooltipTrigger asChild>
								<Info className="h-3 w-3 shrink-0 cursor-help text-stone-400 hover:text-stone-600 dark:hover:text-stone-200" />
							</TooltipTrigger>
							<TooltipContent side="bottom" className="max-w-xs space-y-1.5 p-3 text-xs">
								<p className="font-medium">{m.CHAT_SETTINGS_CONFIG_TOOLTIP_TITLE}</p>
								<p><span className="text-stone-400">{m.CHAT_SETTINGS_CONFIG_PROVIDER}:</span> {selectedProviderName || provider}</p>
								<p><span className="text-stone-400">{m.CHAT_SETTINGS_CONFIG_MODEL}:</span> {selectedModelName || model}</p>
								<p><span className="text-stone-400">{m.CHAT_SETTINGS_CONFIG_API_KEY}:</span> {selectedVaultName || m.CHAT_SETTINGS_CONFIG_API_KEY_CONFIGURED}</p>
								{selectedModelObj && (
									<>
										<hr className="border-stone-200 dark:border-stone-700" />
										<p className="font-medium">{m.CHAT_SETTINGS_CONFIG_PRICING}</p>
										<p><span className="text-stone-400">{m.CHAT_SETTINGS_CONFIG_INPUT}:</span> ${selectedModelObj.inputPricePerMToken}/M {m.CHAT_TOKENS}</p>
										<p><span className="text-stone-400">{m.CHAT_SETTINGS_CONFIG_OUTPUT}:</span> ${selectedModelObj.outputPricePerMToken}/M {m.CHAT_TOKENS}</p>
										<p><span className="text-stone-400">{m.CHAT_SETTINGS_CONFIG_CONTEXT}:</span> {selectedModelObj.contextWindow?.toLocaleString()} {m.CHAT_TOKENS}</p>
										<hr className="border-stone-200 dark:border-stone-700" />
										<p className="font-medium">{m.CHAT_SETTINGS_CONFIG_COST_CALCULATION}</p>
										<p className="text-stone-400">{m.CHAT_SETTINGS_CONFIG_COST_FORMULA}</p>
									</>
								)}
							</TooltipContent>
						</Tooltip>
					</div>
				)}
			</div>

			<div className="min-h-0 flex-1 overflow-auto px-4 py-4">
				<div className="max-w-lg space-y-6">
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
						href="/manage-models"
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
				<div className="flex flex-wrap items-center gap-1 text-xs text-stone-400 dark:text-stone-500">
					{m.CHAT_SETTINGS_API_KEY_HINT_PREFIX}{" "}
					<a
						href="/vault"
						className="underline hover:text-stone-600 dark:hover:text-stone-300"
					>
						{m.FEATURE_VAULT}
					</a>{" "}
					{m.CHAT_SETTINGS_API_KEY_HINT_SUFFIX}
					{" "}
					{m.CHAT_SETTINGS_OR}
					{" "}
					<SecretForm
						successCallback={() => {
							// Reload vault secrets after creation
							fetch("/api/vault/get", {
								method: "POST",
								headers: { "Content-Type": "application/json" },
								body: JSON.stringify({}),
							})
								.then((r) => r.json())
								.then((res) => {
									const secrets = Array.isArray(res) ? res : res?.data || [];
									setVaultSecrets(secrets);
									// Auto-select the newly created secret (last one)
									if (secrets.length > 0) {
										setVaultId(secrets[secrets.length - 1].id);
									}
								})
								.catch(() => {});
						}}
					>
						<Button
							variant="ghost"
							className="py-0 h-auto px-0 text-xs text-primary hover:bg-transparent underline"
						>
							{m.EVALUATION_CREATE_NEW}
						</Button>
					</SecretForm>
				</div>
			</div>

			<Button onClick={handleSave} disabled={saving}>
				{saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
				{hasExistingConfig ? m.OPENGROUND_UPDATE_CONFIGURATION : m.CHAT_SETTINGS_SAVE}
			</Button>
				</div>
			</div>
		</div>
	);
}
