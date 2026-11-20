"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	Section,
	SwitchGrid,
	TextField,
} from "@/components/(playground)/scanner/scanner-run-params-dialog";
import getMessage from "@/constants/messages";
import { formatBrowserDateTime } from "@/utils/date";
import type { FieldDef } from "@/lib/platform/connectors/datasource/types";
import type { ScannerForgeSchema } from "@/lib/platform/connectors/scanner/cli-schema";
import { trustablForgeParamFields } from "@/lib/platform/connectors/scanner/config-fields";
import { FORGE_DEFAULT_FILE_NAME } from "@/lib/platform/connectors/scanner/forge-params";
import { FALLBACK_FORGE_POLICIES } from "@/lib/platform/connectors/scanner/forge-policies";
import type { ScannerForgeRunInput, ScannerJob } from "@/lib/platform/connectors/scanner/types";

export type ScannerForgeDefaults = {
	target: string;
	fileName: string;
	rulesRef: string;
	policies: string[];
	extras: Record<string, string | boolean>;
};

type FormValues = Record<string, string | boolean>;

function fieldValues(defaults: ScannerForgeDefaults, fields: FieldDef[]): FormValues {
	const values: FormValues = {
		target: defaults.target,
		fileName: defaults.fileName || FORGE_DEFAULT_FILE_NAME,
	};
	for (const field of fields) {
		const fallback = field.kind === "switch" ? Boolean(field.defaultValue) : "";
		values[field.key] =
			field.key === "rulesRef" ? defaults.rulesRef : defaults.extras[field.key] ?? fallback;
	}
	return values;
}

function samePolicies(left: string[], right: string[]): boolean {
	return left.length === right.length && left.every((item) => right.includes(item));
}

export default function ScannerForgeParamsDialog({
	open,
	defaults,
	prefill,
	schema,
	onClose,
	onRun,
}: {
	open: boolean;
	defaults: ScannerForgeDefaults;
	prefill?: { job: ScannerJob; policies: string[] };
	schema?: ScannerForgeSchema;
	onClose: () => void;
	onRun: (input: ScannerForgeRunInput) => void;
}) {
	const messages = getMessage();
	const fields = useMemo(() => trustablForgeParamFields(schema), [schema]);
	const textFields = fields.filter((field) => field.kind !== "switch");
	const switchFields = fields.filter((field) => field.kind === "switch");
	const seededValues = useMemo(() => fieldValues(defaults, fields), [defaults, fields]);
	const [values, setValues] = useState<FormValues>(seededValues);
	const [policies, setPolicies] = useState<string[]>(defaults.policies);
	const accepted = schema?.policies.length ? schema.policies : FALLBACK_FORGE_POLICIES;
	const chips = [...accepted, ...policies.filter((policy) => !accepted.includes(policy))];

	useEffect(() => {
		if (!open) return;
		setValues(seededValues);
		setPolicies(defaults.policies);
	}, [defaults.policies, open, seededValues]);

	const setField = (key: string, value: string | boolean) => {
		setValues((current) => ({ ...current, [key]: value }));
	};
	const togglePolicy = (policy: string) => {
		setPolicies((current) =>
			current.includes(policy) ? current.filter((item) => item !== policy) : [...current, policy]
		);
	};

	const target = String(values.target || "").trim();
	const canRun = Boolean(target) && policies.length > 0;
	const dirty =
		!samePolicies(policies, defaults.policies) ||
		Object.keys(seededValues).some((key) => values[key] !== seededValues[key]);

	const run = () => {
		if (!canRun) return;
		const input: ScannerForgeRunInput = {
			target,
			policies: accepted.filter((policy) => policies.includes(policy)).concat(
				policies.filter((policy) => !accepted.includes(policy))
			),
			fileName: String(values.fileName || "").trim() || FORGE_DEFAULT_FILE_NAME,
		};
		const rulesRef = String(values.rulesRef || "").trim();
		if (rulesRef) input.rulesRef = rulesRef;
		const extras: Record<string, string | boolean> = {};
		for (const field of fields) {
			if (field.key === "rulesRef") continue;
			const value = values[field.key];
			if (field.kind === "switch" && value === true) extras[field.key] = true;
			else if (typeof value === "string" && value.trim()) extras[field.key] = value.trim();
		}
		if (Object.keys(extras).length) input.extras = extras;
		if (prefill?.job.id) input.sourceJobId = prefill.job.id;
		onRun(input);
	};

	const targetField: FieldDef = {
		key: "target",
		label: messages.SCANNER_FIELD_TARGET,
		kind: "url",
		group: "settings",
		placeholder: "https://github.com/owner/repo",
		description: messages.SCANNER_FORGE_FIELD_TARGET_HELP,
	};
	const fileNameField: FieldDef = {
		key: "fileName",
		label: messages.SCANNER_FORGE_FIELD_FILE_NAME,
		kind: "text",
		group: "settings",
		placeholder: FORGE_DEFAULT_FILE_NAME,
		description: messages.SCANNER_FORGE_FIELD_FILE_NAME_HELP,
	};

	return (
		<Dialog open={open} onOpenChange={(next) => !next && onClose()}>
			<DialogContent className="flex w-[calc(100vw-2rem)] max-h-[90vh] max-w-3xl flex-col gap-0 overflow-hidden border-stone-200 bg-white p-0 text-stone-950 shadow-2xl dark:border-stone-800 dark:bg-stone-950 dark:text-stone-50 sm:max-w-3xl">
				<form
					className="flex min-h-0 flex-1 flex-col"
					onSubmit={(event) => {
						event.preventDefault();
						run();
					}}
				>
					<DialogHeader className="shrink-0 space-y-1 border-b border-stone-200 px-6 py-4 pr-12 dark:border-stone-800">
						<DialogTitle>{messages.SCANNER_FORGE_PARAMS_TITLE}</DialogTitle>
						<DialogDescription>{messages.SCANNER_FORGE_PARAMS_DESCRIPTION}</DialogDescription>
					</DialogHeader>

					<div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
						<Section title={messages.SCANNER_RUN_PARAMS_TARGET_SECTION}>
							<div className="space-y-3">
								<TextField
									field={targetField}
									value={values.target}
									required
									onChange={(value) => setField("target", value)}
								/>
								<TextField
									field={fileNameField}
									value={values.fileName}
									onChange={(value) => setField("fileName", value)}
								/>
							</div>
						</Section>

						<Section title={messages.SCANNER_FORGE_POLICIES_SECTION}>
							<div
								className={`flex items-start gap-2 rounded-md border px-3 py-2 text-[11px] leading-4 ${
									prefill
										? "border-teal-200 bg-teal-50 text-teal-900 dark:border-teal-900/70 dark:bg-teal-950/40 dark:text-teal-200"
										: "border-stone-200 bg-stone-50 text-stone-600 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-300"
								}`}
							>
								<Sparkles className="mt-0.5 size-3.5 shrink-0" />
								<span>
									{prefill
										? messages.SCANNER_FORGE_PREFILL_NOTE(
												formatBrowserDateTime(prefill.job.startedAt),
												prefill.policies.join(", ")
											)
										: messages.SCANNER_FORGE_NO_PREFILL_NOTE}
								</span>
							</div>
							<div className="flex flex-wrap gap-1.5">
								{chips.map((policy) => {
									const active = policies.includes(policy);
									return (
										<button
											key={policy}
											type="button"
											aria-pressed={active}
											onClick={() => togglePolicy(policy)}
											className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 font-mono text-[11px] ${
												active
													? "border-stone-900 bg-stone-900 text-white dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900"
													: "border-stone-200 text-stone-700 hover:bg-stone-50 dark:border-stone-800 dark:text-stone-300 dark:hover:bg-stone-900"
											}`}
										>
											{active ? <Check className="size-3" /> : null}
											{policy}
										</button>
									);
								})}
							</div>
							<p className="text-[11px] leading-4 text-stone-500 dark:text-stone-400">
								{messages.SCANNER_FORGE_POLICIES_HELP}
							</p>
						</Section>

						<Section title={messages.SCANNER_RUN_PARAMS_RULES_SECTION}>
							<div className="space-y-3">
								<div className="grid gap-3 sm:grid-cols-2">
									{textFields.map((field) => (
										<TextField
											key={field.key}
											field={field}
											value={values[field.key]}
											onChange={(value) => setField(field.key, value)}
										/>
									))}
								</div>
								{switchFields.length ? (
									<SwitchGrid fields={switchFields} values={values} onChange={setField} />
								) : null}
							</div>
						</Section>

						<p className="text-[11px] leading-4 text-muted-foreground">
							{messages.SCANNER_FORGE_NO_CLONE_NOTE}
						</p>
					</div>

					<DialogFooter className="shrink-0 gap-2 border-t border-stone-200 px-6 py-3 sm:justify-end dark:border-stone-800">
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="h-8"
							disabled={!dirty}
							onClick={() => {
								setValues(seededValues);
								setPolicies(defaults.policies);
							}}
						>
							{messages.RESET}
						</Button>
						<Button type="button" variant="outline" size="sm" className="h-8" onClick={onClose}>
							{messages.CANCEL}
						</Button>
						<Button type="submit" size="sm" className="h-8" disabled={!canRun}>
							{messages.SCANNER_FORGE_RUN}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
