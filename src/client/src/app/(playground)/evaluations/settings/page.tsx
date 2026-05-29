"use client";

import SecretForm from "@/components/(playground)/vault/form";
import { Button } from "@/components/ui/button";
import { EVALUATION_ENGINES } from "@/constants/evaluation-engines";
import { CLIENT_EVENTS } from "@/constants/events";
import getMessage from "@/constants/messages";
import { EvaluationConfig } from "@/types/evaluation";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { usePostHog } from "posthog-js/react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import Link from "next/link";
import { Zap, Settings2, Clock, Play, Info, SettingsIcon } from "lucide-react";
import { ProviderMetadata, ModelMetadata } from "@/types/openground";
import { Badge } from "@/components/ui/badge";

const EvaluationVaultCreate = ({
	successCallback,
}: {
	successCallback: () => void;
}) => (
	<div className="flex flex-wrap items-center gap-1 w-full text-stone-600 dark:text-stone-400 text-sm mt-1">
		{getMessage().EVALUATION_VAULT_KEY_NOT_FOUND}
		<SecretForm successCallback={successCallback}>
			<Button
				variant="ghost"
				className="py-0 h-auto px-0 text-xs text-primary hover:bg-transparent"
			>
				{getMessage().EVALUATION_CREATE_NEW}
			</Button>
		</SecretForm>
	</div>
);

const EVALUATION_TOAST_ID = "evaluation-config";

export default function EvaluationSettingsPage() {
	const [provider, setProvider] = useState("");
	const [model, setModel] = useState("");
	// Engine is always "vercel" — kept in state for saving to meta (future-proofing)
	const [engine] = useState<string>(EVALUATION_ENGINES[0].id);
	const [autoEvaluation, setAutoEvaluation] = useState(false);
	const [recurringTime, setRecurringTime] = useState("");
	const [vaultId, setVaultId] = useState("");
	const [vaultKeys, setVaultKeys] = useState<{ label: string; value: string }[]>(
		[]
	);

	const {
		fireRequest: getConfig,
		data: config,
		isLoading: isLoadingConfig,
	} = useFetchWrapper<EvaluationConfig>();
	const { fireRequest: saveConfig, isLoading: isSaving } = useFetchWrapper();
	const { fireRequest: getVaultKeys } = useFetchWrapper();
	const { data: providers, fireRequest: fetchProviders } =
		useFetchWrapper<ProviderMetadata[]>();
	const posthog = usePostHog();

	useEffect(() => {
		getConfig({
			requestType: "GET",
			url: "/api/evaluation/config",
			responseDataKey: "data",
		});
		getVaultKeys({
			requestType: "POST",
			url: "/api/vault/get",
			responseDataKey: "data",
			body: JSON.stringify({}),
			successCb: (res: any) => {
				setVaultKeys(
					res?.length ? res.map((k: any) => ({ label: k.key, value: k.id })) : []
				);
			},
		});
		fetchProviders({
			requestType: "GET",
			url: "/api/openground/providers",
		});
	}, []);

	useEffect(() => {
		if (config) {
			setProvider(config.provider || "");
			setModel(config.model || "");
			setAutoEvaluation(config.auto || false);
			setRecurringTime(config.recurringTime || "");
			setVaultId(config.vaultId || "");
		}
	}, [config]);

	const selectedProviderMeta = useMemo(
		() => (providers || []).find((p) => p.providerId === provider),
		[providers, provider]
	);
	const modelOptions = useMemo(
		() => selectedProviderMeta?.supportedModels || [],
		[selectedProviderMeta]
	);

	const handleSave = () => {
		if (!provider || !model || !vaultId) {
			toast.error(getMessage().EVALUATION_CONFIG_INVALID, {
				id: EVALUATION_TOAST_ID,
			});
			return;
		}
		toast.loading(getMessage().EVALUATION_CONFIG_MODIFYING, {
			id: EVALUATION_TOAST_ID,
		});

		const meta = JSON.parse(config?.meta || "{}");
		meta.engine = engine;

		saveConfig({
			body: JSON.stringify({
				id: config?.id,
				provider,
				model,
				vaultId,
				auto: autoEvaluation,
				recurringTime: recurringTime || "* * * * *",
				meta: JSON.stringify(meta),
			}),
			requestType: "POST",
			url: "/api/evaluation/config",
			responseDataKey: "data",
			successCb: () => {
				toast.success(
					config?.id ? getMessage().EVALUATION_UPDATED : getMessage().EVALUATION_CREATED,
					{ id: EVALUATION_TOAST_ID }
				);
				getConfig({
					requestType: "GET",
					url: "/api/evaluation/config",
					responseDataKey: "data",
				});
				posthog?.capture(
					config?.id
						? CLIENT_EVENTS.EVALUATION_CONFIG_UPDATED_SUCCESS
						: CLIENT_EVENTS.EVALUATION_CONFIG_CREATED_SUCCESS
				);
			},
			failureCb: (err?: string) => {
				toast.error(err || getMessage().EVALUATION_CONFIG_UPDATING_FAILED, {
					id: EVALUATION_TOAST_ID,
				});
			},
		});
	};

	if (isLoadingConfig && !config) {
		return (
			<div className="flex flex-1 h-full w-full p-6">
				<div className="animate-pulse grid gap-4 w-full max-w-3xl">
					<div className="h-40 bg-stone-100 dark:bg-stone-900 rounded-xl" />
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col flex-1 h-full w-full p-6 overflow-auto gap-6">
			{/* Page header */}
			<div className="space-y-1">
				<h1 className="text-lg font-semibold text-stone-900 dark:text-stone-100">
					{getMessage().EVALUATION_ENGINE_TITLE}
				</h1>
				<p className="text-sm text-stone-500 dark:text-stone-400">
					{getMessage().EVALUATION_ENGINE_DESCRIPTION}
				</p>
			</div>
			<Card className="border-blue-200 dark:border-blue-900/50 bg-blue-50/50 dark:bg-blue-950/20">
				<CardContent className="pt-6">
					<div className="flex gap-3">
						<Info className="size-5 text-blue-600 dark:text-blue-500 shrink-0 mt-0.5" />
						<div className="text-sm text-stone-600 dark:text-stone-400">
							<p className="font-medium text-stone-700 dark:text-stone-300 mb-1">
								{getMessage().EVALUATION_MANUAL_AND_AUTO}
							</p>
							<p>{getMessage().EVALUATION_MANUAL_AND_AUTO_DESCRIPTION}</p>
						</div>
					</div>
				</CardContent>
			</Card>
			<div className="grid grid-cols-3 gap-4">
				<div className="col-span-2 grid gap-4">
					{/* Configuration Card */}
					<Card className="border-stone-200 dark:border-stone-800 shadow-sm">
						<CardHeader className="pb-4">
							<CardTitle className="text-base flex items-center gap-2">
								<Settings2 className="size-4" />
								{getMessage().EVALUATION_CONFIG_SECTION}
							</CardTitle>
							<p className="text-sm text-stone-500 dark:text-stone-400 font-normal">
								{getMessage().EVALUATION_ENGINE_DESCRIPTION}
							</p>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="flex items-center gap-2 text-xs text-stone-500 dark:text-stone-400 bg-stone-100 dark:bg-stone-800 rounded-md px-3 py-2">
								<Info className="size-3.5 shrink-0" />
								<span>Powered by <span className="font-medium text-stone-700 dark:text-stone-300">Vercel AI SDK</span></span>
							</div>

							<div className="grid gap-3">
								<div className="flex items-center justify-between">
									<Label>{getMessage().EVALUATION_PROVIDER_LABEL}</Label>
									<Link href="/manage-models">
										<Button variant="ghost" size="sm" className="h-7 text-xs px-2">
											<SettingsIcon className="h-3 w-3 mr-1" />
											{getMessage().OPENGROUND_MANAGE_MODELS}
										</Button>
									</Link>
								</div>
								<Select
									value={provider}
									onValueChange={(v) => {
										setProvider(v);
										setModel("");
									}}
								>
									<SelectTrigger>
										<SelectValue placeholder={getMessage().EVALUATION_SELECT_PROVIDER} />
									</SelectTrigger>
									<SelectContent>
										{(providers || []).map((p) => (
											<SelectItem key={p.providerId} value={p.providerId}>
												{p.displayName}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							<div className="grid gap-3">
								<Label>{getMessage().EVALUATION_MODEL_LABEL}</Label>
								<Select
									value={model}
									onValueChange={setModel}
									disabled={!provider}
								>
									<SelectTrigger className="h-auto">
										<SelectValue
											placeholder={
												provider
													? getMessage().EVALUATION_MODEL_PLACEHOLDER
													: getMessage().EVALUATION_SELECT_PROVIDER_FIRST
											}
										/>
									</SelectTrigger>
									<SelectContent>
										{modelOptions.map((m) => (
											<SelectItem key={m.id} value={m.id}>
												<div className="flex flex-col items-start gap-0.5">
													<span className="text-sm">{m.displayName}</span>
													<div className="flex gap-1.5 text-xs text-stone-500">
														<Badge variant="secondary" className="text-xs h-4 px-1">
															{m.contextWindow.toLocaleString()}
														</Badge>
														<Badge variant="outline" className="text-xs h-4 px-1">
															${m.inputPricePerMToken}/M
														</Badge>
													</div>
												</div>
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								<p className="text-xs text-stone-500 dark:text-stone-400">
									{getMessage().EVALUATION_MODEL_CUSTOM_HINT}
								</p>
							</div>

							<div className="grid gap-3">
								<Label>{getMessage().EVALUATION_API_KEY_VAULT}</Label>
								<Select value={vaultId} onValueChange={setVaultId}>
									<SelectTrigger>
										<SelectValue placeholder={getMessage().EVALUATION_SELECT_VAULT_KEY} />
									</SelectTrigger>
									<SelectContent>
										{vaultKeys.map((o) => (
											<SelectItem key={o.value} value={o.value}>
												{o.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								<EvaluationVaultCreate
									successCallback={() =>
										getVaultKeys({
											requestType: "POST",
											url: "/api/vault/get",
											responseDataKey: "data",
											body: JSON.stringify({}),
											successCb: (res: any) => {
												setVaultKeys(
													res?.length
														? res.map((k: any) => ({
															label: k.key,
															value: k.id,
														}))
														: []
												);
											},
										})
									}
								/>
							</div>
						</CardContent>
					</Card>
				</div>
				<div className="grid gap-4">
					{/* Auto Evaluation Card */}
					<Card className="border-stone-200 dark:border-stone-800 shadow-sm">
						<CardHeader className="pb-4">
							<CardTitle className="text-base flex items-center gap-2">
								<Zap className="size-4" />
								{getMessage().EVALUATION_AUTO_TITLE}
							</CardTitle>
							<p className="text-sm text-stone-500 dark:text-stone-400 font-normal">
								{getMessage().EVALUATION_AUTO_DESCRIPTION}
							</p>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="flex items-center justify-between rounded-lg border border-stone-200 dark:border-stone-700 p-4">
								<div className="space-y-0.5">
									<Label>{getMessage().EVALUATION_ENABLE_AUTO}</Label>
									<p className="text-xs text-stone-500 dark:text-stone-400">
										{getMessage().EVALUATION_ENABLE_AUTO_DESCRIPTION}
									</p>
								</div>
								<Switch
									checked={autoEvaluation}
									onCheckedChange={setAutoEvaluation}
								/>
							</div>
							{autoEvaluation && (
								<div className="grid gap-3">
									<Label className="flex items-center gap-2">
										<Clock className="size-3.5" />
										{getMessage().EVALUATION_CRON_SCHEDULE}
									</Label>
									<Input
										placeholder={getMessage().EVALUATION_CRON_PLACEHOLDER}
										value={recurringTime}
										onChange={(e) => setRecurringTime(e.target.value)}
									/>
									<p className="text-xs text-stone-500 dark:text-stone-400">
										{getMessage().EVALUATION_CRON_HELP}
									</p>
								</div>
							)}
						</CardContent>
					</Card>

					<Button onClick={handleSave} disabled={isSaving} className="w-full sm:w-auto bg-primary dark:bg-primary text-white dark:text-white hover:bg-primary/90 dark:hover:bg-primary/90">
						{isSaving
							? getMessage().EVALUATION_SAVING
							: config?.id
								? getMessage().EVALUATION_SAVE_CHANGES
								: getMessage().EVALUATION_CREATE_CONFIG}
					</Button>

					{/* Manual Evaluation Section */}
					<Card className="border-stone-200 dark:border-stone-800 shadow-sm">
						<CardHeader className="pb-4">
							<CardTitle className="text-base flex items-center gap-2">
								<Play className="size-4" />
								{getMessage().EVALUATION_MANUAL_TITLE}
							</CardTitle>
							<p className="text-sm text-stone-500 dark:text-stone-400 font-normal">
								{getMessage().EVALUATION_MANUAL_DESCRIPTION}
							</p>
						</CardHeader>
						<CardContent className="space-y-4">
							<ol className="list-decimal list-inside space-y-2 text-sm text-stone-600 dark:text-stone-400 mb-3">
								<li>{getMessage().EVALUATION_MANUAL_STEP_1}</li>
								<li>{getMessage().EVALUATION_MANUAL_STEP_2}</li>
								<li>{getMessage().EVALUATION_MANUAL_STEP_3}</li>
							</ol>
							<Link href="/requests">
								<Button variant="default">{getMessage().EVALUATION_GO_TO_REQUESTS}</Button>
							</Link>
						</CardContent>
					</Card>
				</div>
			</div>
		</div>
	);
}
