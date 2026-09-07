"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import getMessage from "@/constants/messages";
import type { ScannerScanInput } from "@/lib/platform/connectors/scanner/types";

export type ScannerRunDefaults = {
	target: string;
	ref: string;
	detectors: string;
	strict: boolean;
	secretScan: boolean;
	vulnScan: boolean;
	licenseScan: boolean;
	requireSigned: boolean;
	rulesRepo: string;
	rulesRef: string;
	rulesSource: string;
	noRulesUpdate: boolean;
	verbose: boolean;
};

export const EMPTY_SCANNER_RUN_DEFAULTS: ScannerRunDefaults = {
	target: "",
	ref: "",
	detectors: "",
	strict: false,
	secretScan: false,
	vulnScan: false,
	licenseScan: false,
	requireSigned: true,
	rulesRepo: "",
	rulesRef: "",
	rulesSource: "environment",
	noRulesUpdate: false,
	verbose: false,
};

export default function ScannerRunParamsDialog({
	open,
	defaults,
	onClose,
	onRun,
}: {
	open: boolean;
	defaults: ScannerRunDefaults;
	onClose: () => void;
	onRun: (input: ScannerScanInput) => void;
}) {
	const messages = getMessage();
	const [values, setValues] = useState<ScannerRunDefaults>(defaults);

	useEffect(() => {
		if (!open) return;
		setValues(defaults);
	}, [open, defaults]);

	const setField = <K extends keyof ScannerRunDefaults>(key: K, value: ScannerRunDefaults[K]) => {
		setValues((current) => ({ ...current, [key]: value }));
	};

	return (
		<Dialog open={open} onOpenChange={(next) => !next && onClose()}>
			<DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950">
				<DialogHeader>
					<DialogTitle>{messages.SCANNER_RUN_PARAMS_TITLE}</DialogTitle>
					<DialogDescription>{messages.SCANNER_RUN_PARAMS_DESCRIPTION}</DialogDescription>
				</DialogHeader>
				<div className="space-y-4">
					<section className="space-y-3">
						<p className="text-xs font-semibold text-stone-950 dark:text-stone-50">
							{messages.SCANNER_RUN_PARAMS_TARGET_SECTION}
						</p>
						<div className="grid gap-3 sm:grid-cols-2">
							<div className="space-y-1.5 sm:col-span-2">
								<Label className="text-xs">{messages.SCANNER_FIELD_TARGET}</Label>
								<Input
									value={values.target}
									onChange={(event) => setField("target", event.target.value)}
									className="bg-white dark:bg-stone-900"
								/>
								<p className="text-[11px] leading-5 text-stone-500 dark:text-stone-400">
									{messages.SCANNER_FIELD_TARGET_HELP}
								</p>
							</div>
							<div className="space-y-1.5">
								<Label className="text-xs">{messages.SCANNER_FIELD_REF}</Label>
								<Input
									value={values.ref}
									onChange={(event) => setField("ref", event.target.value)}
									className="bg-white dark:bg-stone-900"
								/>
								<p className="text-[11px] leading-5 text-stone-500 dark:text-stone-400">
									{messages.SCANNER_FIELD_REF_HELP}
								</p>
							</div>
							<div className="space-y-1.5">
								<Label className="text-xs">{messages.SCANNER_FIELD_DETECTORS}</Label>
								<Input
									value={values.detectors}
									onChange={(event) => setField("detectors", event.target.value)}
									placeholder="claude_sdk,mcp"
									className="bg-white dark:bg-stone-900"
								/>
								<p className="text-[11px] leading-5 text-stone-500 dark:text-stone-400">
									{messages.SCANNER_FIELD_DETECTORS_HELP}
								</p>
							</div>
						</div>
					</section>

					<section className="space-y-3">
						<p className="text-xs font-semibold text-stone-950 dark:text-stone-50">
							{messages.SCANNER_RUN_PARAMS_SCAN_SECTION}
						</p>
						<div className="grid gap-2 sm:grid-cols-2">
							<FlagSwitch
								label={messages.SCANNER_FIELD_STRICT}
								description={messages.SCANNER_FIELD_STRICT_HELP}
								checked={values.strict}
								onCheckedChange={(checked) => setField("strict", checked)}
							/>
							<FlagSwitch
								label={messages.SCANNER_FIELD_SECRET_SCAN}
								description={messages.SCANNER_FIELD_SECRET_SCAN_HELP}
								checked={values.secretScan}
								onCheckedChange={(checked) => setField("secretScan", checked)}
							/>
							<FlagSwitch
								label={messages.SCANNER_FIELD_VULN_SCAN}
								description={messages.SCANNER_FIELD_VULN_SCAN_HELP}
								checked={values.vulnScan}
								onCheckedChange={(checked) => setField("vulnScan", checked)}
							/>
							<FlagSwitch
								label={messages.SCANNER_FIELD_LICENSE_SCAN}
								description={messages.SCANNER_FIELD_LICENSE_SCAN_HELP}
								checked={values.licenseScan}
								onCheckedChange={(checked) => setField("licenseScan", checked)}
							/>
							<FlagSwitch
								label={messages.SCANNER_FIELD_VERBOSE}
								description={messages.SCANNER_FIELD_VERBOSE_HELP}
								checked={values.verbose}
								onCheckedChange={(checked) => setField("verbose", checked)}
							/>
						</div>
					</section>

					<section className="space-y-3">
						<p className="text-xs font-semibold text-stone-950 dark:text-stone-50">
							{messages.SCANNER_RUN_PARAMS_RULES_SECTION}
						</p>
						<div className="grid gap-3 sm:grid-cols-2">
							<div className="space-y-1.5">
								<Label className="text-xs">{messages.SCANNER_FIELD_RULES_SOURCE}</Label>
								<Select
									value={values.rulesSource}
									onValueChange={(next) => setField("rulesSource", next)}
								>
									<SelectTrigger className="bg-white dark:bg-stone-900">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="environment">
											{messages.SCANNER_FIELD_RULES_SOURCE_ENVIRONMENT}
										</SelectItem>
										<SelectItem value="production">
											{messages.SCANNER_FIELD_RULES_SOURCE_PRODUCTION}
										</SelectItem>
										<SelectItem value="staging">
											{messages.SCANNER_FIELD_RULES_SOURCE_STAGING}
										</SelectItem>
										<SelectItem value="git">{messages.SCANNER_FIELD_RULES_SOURCE_GIT}</SelectItem>
									</SelectContent>
								</Select>
								<p className="text-[11px] leading-5 text-stone-500 dark:text-stone-400">
									{messages.SCANNER_FIELD_RULES_SOURCE_HELP}
								</p>
							</div>
							<div className="space-y-1.5">
								<Label className="text-xs">{messages.SCANNER_FIELD_RULES_REF}</Label>
								<Input
									value={values.rulesRef}
									onChange={(event) => setField("rulesRef", event.target.value)}
									className="bg-white dark:bg-stone-900"
								/>
								<p className="text-[11px] leading-5 text-stone-500 dark:text-stone-400">
									{messages.SCANNER_FIELD_RULES_REF_HELP}
								</p>
							</div>
							<div className="space-y-1.5 sm:col-span-2">
								<Label className="text-xs">{messages.SCANNER_FIELD_RULES_REPO}</Label>
								<Input
									value={values.rulesRepo}
									onChange={(event) => setField("rulesRepo", event.target.value)}
									className="bg-white dark:bg-stone-900"
								/>
								<p className="text-[11px] leading-5 text-stone-500 dark:text-stone-400">
									{messages.SCANNER_FIELD_RULES_REPO_HELP}
								</p>
							</div>
							<FlagSwitch
								label={messages.SCANNER_FIELD_REQUIRE_SIGNED}
								description={messages.SCANNER_FIELD_REQUIRE_SIGNED_HELP}
								checked={values.requireSigned}
								onCheckedChange={(checked) => setField("requireSigned", checked)}
							/>
							<FlagSwitch
								label={messages.SCANNER_FIELD_NO_RULES_UPDATE}
								description={messages.SCANNER_FIELD_NO_RULES_UPDATE_HELP}
								checked={values.noRulesUpdate}
								onCheckedChange={(checked) => setField("noRulesUpdate", checked)}
							/>
						</div>
					</section>
					<p className="text-[11px] leading-4 text-muted-foreground">
						{messages.SCANNER_RUN_PARAMS_TOKEN_NOTE}
					</p>
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={onClose}>
						{messages.CANCEL}
					</Button>
					<Button
						onClick={() =>
							onRun({
								target: values.target.trim(),
								ref: values.ref.trim() || undefined,
								detectors: values.detectors.trim() || undefined,
								strict: values.strict,
								secretScan: values.secretScan,
								vulnScan: values.vulnScan,
								licenseScan: values.licenseScan,
								requireSigned: values.requireSigned,
								rulesRepo: values.rulesRepo.trim() || undefined,
								rulesRef: values.rulesRef.trim() || undefined,
								rulesSource: values.rulesSource,
								noRulesUpdate: values.noRulesUpdate,
								verbose: values.verbose,
							})
						}
						disabled={!values.target.trim()}
					>
						{messages.SCANNER_RUN}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function FlagSwitch({
	label,
	description,
	checked,
	onCheckedChange,
}: {
	label: string;
	description: string;
	checked: boolean;
	onCheckedChange: (checked: boolean) => void;
}) {
	return (
		<div className="flex flex-col gap-1 rounded-md border border-stone-200 px-3 py-2 dark:border-stone-800">
			<div className="flex items-center justify-between gap-3">
				<Label className="text-xs">{label}</Label>
				<Switch checked={checked} onCheckedChange={onCheckedChange} />
			</div>
			<p className="text-[11px] leading-5 text-stone-500 dark:text-stone-400">{description}</p>
		</div>
	);
}
