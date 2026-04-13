"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import getMessage from "@/constants/messages";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import {
	CircleDollarSign,
	Clock,
	Info,
	Play,
	Workflow,
	Zap,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";

interface PricingConfig {
	id?: string;
	auto?: boolean;
	recurringTime?: string;
	meta?: string;
}

const PRICING_TOAST_ID = "pricing-config";

export default function PricingPage() {
	const m = getMessage();
	const [autoPricing, setAutoPricing] = useState(false);
	const [recurringTime, setRecurringTime] = useState("");

	const {
		fireRequest: getConfig,
		data: config,
		isLoading: isLoadingConfig,
	} = useFetchWrapper<PricingConfig>();
	const { fireRequest: saveConfig, isLoading: isSaving } = useFetchWrapper();

	useEffect(() => {
		getConfig({
			requestType: "GET",
			url: "/api/pricing/config",
			responseDataKey: "data",
		});
	}, []);

	useEffect(() => {
		if (config) {
			setAutoPricing(config.auto || false);
			setRecurringTime(config.recurringTime || "");
		}
	}, [config]);

	const handleSave = () => {
		toast.loading(m.SAVING, { id: PRICING_TOAST_ID });

		saveConfig({
			body: JSON.stringify({
				id: config?.id,
				auto: autoPricing,
				recurringTime: recurringTime || "* * * * *",
				meta: config?.meta || "{}",
			}),
			requestType: "POST",
			url: "/api/pricing/config",
			responseDataKey: "data",
			successCb: () => {
				toast.success(m.PRICING_CONFIG_SAVED, { id: PRICING_TOAST_ID });
				getConfig({
					requestType: "GET",
					url: "/api/pricing/config",
					responseDataKey: "data",
				});
			},
			failureCb: (err?: string) => {
				toast.error(err || m.OPERATION_FAILED, {
					id: PRICING_TOAST_ID,
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
				<h1 className="text-lg font-semibold text-stone-900 dark:text-stone-100 flex items-center gap-2">
					<CircleDollarSign className="size-5" />
					{m.PRICING_TITLE}
				</h1>
				<p className="text-sm text-stone-500 dark:text-stone-400">
					{m.PRICING_PAGE_DESCRIPTION}
				</p>
			</div>

			{/* Single info bar (replaces the large left description card) */}
			<Card className="border-blue-200 dark:border-blue-900/50 bg-blue-50/50 dark:bg-blue-950/20">
				<CardContent className="py-3">
					<div className="flex items-start gap-3">
						<Info className="size-4 text-blue-600 dark:text-blue-500 shrink-0 mt-0.5" />
						<p className="text-xs text-stone-600 dark:text-stone-400 leading-relaxed">
							{m.PRICING_INFO_BAR}{" "}
							<Link
								href="/manage-models"
								className="font-medium text-stone-700 dark:text-stone-300 underline"
							>
								{m.OPENGROUND_MANAGE_MODELS}
							</Link>
							.
						</p>
					</div>
				</CardContent>
			</Card>

			{/* Auto + Manual side-by-side to save vertical space */}
			<div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
				<Card className="border-stone-200 dark:border-stone-800 shadow-sm flex flex-col">
					<CardHeader className="pb-4">
						<CardTitle className="text-base flex items-center gap-2">
							<Zap className="size-4" />
							{m.PRICING_AUTO_TITLE}
						</CardTitle>
						<p className="text-sm text-stone-500 dark:text-stone-400 font-normal">
							{m.PRICING_AUTO_DESCRIPTION}
						</p>
					</CardHeader>
					<CardContent className="space-y-4 flex-1">
						<div className="flex items-center justify-between rounded-lg border border-stone-200 dark:border-stone-700 p-4">
							<div className="space-y-0.5">
								<Label>{m.PRICING_AUTO_ENABLE_LABEL}</Label>
								<p className="text-xs text-stone-500 dark:text-stone-400">
									{m.PRICING_AUTO_ENABLE_HINT}
								</p>
							</div>
							<Switch
								checked={autoPricing}
								onCheckedChange={setAutoPricing}
							/>
						</div>
						{autoPricing && (
							<div className="grid gap-3">
								<Label className="flex items-center gap-2">
									<Clock className="size-3.5" />
									{m.PRICING_AUTO_CRON_LABEL}
								</Label>
								<Input
									placeholder={m.PRICING_AUTO_CRON_PLACEHOLDER}
									value={recurringTime}
									onChange={(e) => setRecurringTime(e.target.value)}
								/>
								<p className="text-xs text-stone-500 dark:text-stone-400">
									{m.PRICING_AUTO_CRON_HELP}
								</p>
							</div>
						)}
						<Button
							onClick={handleSave}
							disabled={isSaving}
							className="bg-primary dark:bg-primary text-white dark:text-white hover:bg-primary/90 dark:hover:bg-primary/90"
						>
							{isSaving
								? m.SAVING
								: config?.id
									? m.PRICING_UPDATE
									: m.PRICING_SAVE}
						</Button>
					</CardContent>
				</Card>

				<Card className="border-stone-200 dark:border-stone-800 shadow-sm flex flex-col">
					<CardHeader className="pb-4">
						<CardTitle className="text-base flex items-center gap-2">
							<Play className="size-4" />
							{m.PRICING_MANUAL_TITLE}
						</CardTitle>
						<p className="text-sm text-stone-500 dark:text-stone-400 font-normal">
							{m.PRICING_MANUAL_DESCRIPTION}
						</p>
					</CardHeader>
					<CardContent className="space-y-4 flex-1">
						<ol className="list-decimal list-inside space-y-2 text-sm text-stone-600 dark:text-stone-400">
							<li>{m.PRICING_MANUAL_STEP_1}</li>
							<li>{m.PRICING_MANUAL_STEP_2}</li>
							<li>{m.PRICING_MANUAL_STEP_3}</li>
						</ol>
						<Link href="/requests">
							<Button variant="default">{m.PRICING_GO_TO_REQUESTS}</Button>
						</Link>
					</CardContent>
				</Card>
			</div>

			{/* How auto pricing works */}
			<Card className="border-stone-200 dark:border-stone-800 shadow-sm">
				<CardHeader className="pb-3">
					<CardTitle className="text-base flex items-center gap-2">
						<Workflow className="size-4" />
						{m.PRICING_HOW_AUTO_WORKS_TITLE}
					</CardTitle>
					<p className="text-sm text-stone-500 dark:text-stone-400 font-normal">
						{m.PRICING_HOW_AUTO_WORKS_DESCRIPTION}
					</p>
				</CardHeader>
				<CardContent>
					<ol className="list-decimal list-inside space-y-2 text-sm text-stone-600 dark:text-stone-400 marker:text-stone-400">
						<li>{m.PRICING_HOW_AUTO_WORKS_STEP_1}</li>
						<li>{m.PRICING_HOW_AUTO_WORKS_STEP_2}</li>
						<li>{m.PRICING_HOW_AUTO_WORKS_STEP_3}</li>
						<li>{m.PRICING_HOW_AUTO_WORKS_STEP_4}</li>
						<li>{m.PRICING_HOW_AUTO_WORKS_STEP_5}</li>
						<li>{m.PRICING_HOW_AUTO_WORKS_STEP_6}</li>
					</ol>
				</CardContent>
			</Card>
		</div>
	);
}
