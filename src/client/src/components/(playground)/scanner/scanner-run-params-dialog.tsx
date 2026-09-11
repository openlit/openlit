"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
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
import type { FieldDef } from "@/lib/platform/connectors/datasource/types";
import { trustablRunParamFields } from "@/lib/platform/connectors/scanner/config-fields";
import type { ScannerCliSchema } from "@/lib/platform/connectors/scanner/cli-schema";
import type { ScannerScanInput } from "@/lib/platform/connectors/scanner/types";

export type ScannerRunDefaults = Record<string, string | boolean>;

const TARGET_ORDER = ["target", "ref", "detectors"];
const SCAN_ORDER = ["secretScan", "vulnScan", "licenseScan", "strict", "verbose"];
const RULES_ORDER = ["rulesSource", "rulesRef", "rulesRepo", "requireSigned", "noRulesUpdate"];
const KNOWN_KEYS = new Set([...TARGET_ORDER, ...SCAN_ORDER, ...RULES_ORDER]);

export function emptyScannerRunDefaults(fields: FieldDef[] = trustablRunParamFields()): ScannerRunDefaults {
	const next: ScannerRunDefaults = {};
	for (const field of fields) {
		next[field.key] = field.kind === "switch" ? Boolean(field.defaultValue) : String(field.defaultValue ?? "");
	}
	return next;
}

export const EMPTY_SCANNER_RUN_DEFAULTS = emptyScannerRunDefaults();

function pickFields(fields: FieldDef[], order: string[]): FieldDef[] {
	const byKey = new Map(fields.map((field) => [field.key, field]));
	return order.map((key) => byKey.get(key)).filter((field): field is FieldDef => !!field);
}

function leftoverFields(fields: FieldDef[], used: Set<string>): FieldDef[] {
	return fields.filter((field) => !used.has(field.key));
}

function toScanInput(values: ScannerRunDefaults, fields: FieldDef[]): ScannerScanInput {
	const extras: Record<string, string | boolean> = {};
	const input: ScannerScanInput = {};
	for (const field of fields) {
		const value = values[field.key];
		if (!KNOWN_KEYS.has(field.key)) {
			if (field.kind === "switch") extras[field.key] = value === true;
			else if (typeof value === "string" && value.trim()) extras[field.key] = value.trim();
			continue;
		}
		if (field.kind === "switch") {
			(input as Record<string, unknown>)[field.key] = value === true;
		} else if (typeof value === "string") {
			const trimmed = value.trim();
			(input as Record<string, unknown>)[field.key] = field.key === "target" ? trimmed : trimmed || undefined;
		}
	}
	if (Object.keys(extras).length) input.extras = extras;
	return input;
}

function sameValues(left: ScannerRunDefaults, right: ScannerRunDefaults): boolean {
	const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
	for (const key of keys) {
		if (left[key] !== right[key]) return false;
	}
	return true;
}

export default function ScannerRunParamsDialog({
	open,
	defaults,
	schema,
	onClose,
	onRun,
}: {
	open: boolean;
	defaults: ScannerRunDefaults;
	schema?: ScannerCliSchema;
	onClose: () => void;
	onRun: (input: ScannerScanInput) => void;
}) {
	const messages = getMessage();
	const fields = useMemo(() => trustablRunParamFields(schema), [schema]);
	const seeded = useMemo(
		() => ({ ...emptyScannerRunDefaults(fields), ...defaults }),
		[defaults, fields]
	);
	const [values, setValues] = useState<ScannerRunDefaults>(seeded);

	useEffect(() => {
		if (!open) return;
		setValues(seeded);
	}, [open, seeded]);

	const setField = (key: string, value: string | boolean) => {
		setValues((current) => ({ ...current, [key]: value }));
	};

	const targetFields = pickFields(fields, TARGET_ORDER);
	const scanSwitches = [
		...pickFields(fields, SCAN_ORDER),
		...leftoverFields(fields, new Set([...TARGET_ORDER, ...SCAN_ORDER, ...RULES_ORDER])).filter(
			(field) => field.kind === "switch"
		),
	];
	const scanRest = leftoverFields(fields, new Set([...TARGET_ORDER, ...SCAN_ORDER, ...RULES_ORDER])).filter(
		(field) => field.kind !== "switch"
	);
	const rulesText = pickFields(fields, ["rulesSource", "rulesRef", "rulesRepo"]);
	const rulesSwitches = pickFields(fields, ["requireSigned", "noRulesUpdate"]);
	const canRun = Boolean(String(values.target || "").trim());
	const dirty = !sameValues(values, seeded);

	const run = () => {
		if (!canRun) return;
		onRun(toScanInput(values, fields));
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
						<DialogTitle>{messages.SCANNER_RUN_PARAMS_TITLE}</DialogTitle>
						<DialogDescription>{messages.SCANNER_RUN_PARAMS_DESCRIPTION}</DialogDescription>
					</DialogHeader>

					<div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
						<Section title={messages.SCANNER_RUN_PARAMS_TARGET_SECTION}>
							<div className="space-y-3">
								{targetFields
									.filter((field) => field.key === "target")
									.map((field) => (
										<TextField
											key={field.key}
											field={field}
											value={values[field.key]}
											required
											onChange={(value) => setField(field.key, value)}
										/>
									))}
								<div className="grid gap-3 sm:grid-cols-2">
									{targetFields
										.filter((field) => field.key !== "target")
										.map((field) => (
											<TextField
												key={field.key}
												field={field}
												value={values[field.key]}
												onChange={(value) => setField(field.key, value)}
											/>
										))}
								</div>
							</div>
						</Section>

						{scanSwitches.length || scanRest.length ? (
							<Section title={messages.SCANNER_RUN_PARAMS_SCAN_SECTION}>
								{scanRest.length ? (
									<div className="mb-3 grid gap-3 sm:grid-cols-2">
										{scanRest.map((field) => (
											<TextField
												key={field.key}
												field={field}
												value={values[field.key]}
												onChange={(value) => setField(field.key, value)}
											/>
										))}
									</div>
								) : null}
								<SwitchGrid fields={scanSwitches} values={values} onChange={setField} />
							</Section>
						) : null}

						{rulesText.length || rulesSwitches.length ? (
							<Section title={messages.SCANNER_RUN_PARAMS_RULES_SECTION}>
								<div className="space-y-3">
									<div className="grid gap-3 sm:grid-cols-2">
										{rulesText
											.filter((field) => field.key !== "rulesRepo")
											.map((field) => (
												<TextField
													key={field.key}
													field={field}
													value={values[field.key]}
													onChange={(value) => setField(field.key, value)}
												/>
											))}
									</div>
									{rulesText
										.filter((field) => field.key === "rulesRepo")
										.map((field) => (
											<TextField
												key={field.key}
												field={field}
												value={values[field.key]}
												onChange={(value) => setField(field.key, value)}
											/>
										))}
									{rulesSwitches.length ? (
										<SwitchGrid fields={rulesSwitches} values={values} onChange={setField} />
									) : null}
								</div>
							</Section>
						) : null}

						<p className="text-[11px] leading-4 text-muted-foreground">
							{messages.SCANNER_RUN_PARAMS_TOKEN_NOTE}
						</p>
					</div>

					<DialogFooter className="shrink-0 gap-2 border-t border-stone-200 px-6 py-3 sm:justify-end dark:border-stone-800">
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="h-8"
							disabled={!dirty}
							onClick={() => setValues(seeded)}
						>
							{messages.RESET}
						</Button>
						<Button type="button" variant="outline" size="sm" className="h-8" onClick={onClose}>
							{messages.CANCEL}
						</Button>
						<Button type="submit" size="sm" className="h-8" disabled={!canRun}>
							{messages.SCANNER_RUN}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="space-y-2.5">
			<p className="text-[10px] font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
				{title}
			</p>
			{children}
		</section>
	);
}

function FieldDescription({ text }: { text?: string }) {
	if (!text) return null;
	return <p className="text-[11px] leading-4 text-stone-500 dark:text-stone-400">{text}</p>;
}

function TextField({
	field,
	value,
	required,
	onChange,
}: {
	field: FieldDef;
	value: string | boolean | undefined;
	required?: boolean;
	onChange: (value: string | boolean) => void;
}) {
	const controlId = `scanner-run-${field.key}`;
	return (
		<div className="space-y-1.5">
			<Label htmlFor={controlId} className="text-xs">
				{field.label}
			</Label>
			{field.kind === "select" && field.options ? (
				<Select value={String(value || field.defaultValue || "")} onValueChange={onChange}>
					<SelectTrigger id={controlId} className="h-8 bg-white dark:bg-stone-900">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{field.options.map((option) => (
							<SelectItem key={option.value} value={option.value}>
								{option.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			) : (
				<Input
					id={controlId}
					value={String(value ?? "")}
					placeholder={field.placeholder}
					required={required}
					autoComplete="off"
					onChange={(event) => onChange(event.target.value)}
					className="h-8 bg-white dark:bg-stone-900"
				/>
			)}
			<FieldDescription text={field.description} />
		</div>
	);
}

function SwitchGrid({
	fields,
	values,
	onChange,
}: {
	fields: FieldDef[];
	values: ScannerRunDefaults;
	onChange: (key: string, value: boolean) => void;
}) {
	return (
		<div className="grid gap-2 sm:grid-cols-2">
			{fields.map((field) => {
				const controlId = `scanner-run-${field.key}`;
				return (
					<div
						key={field.key}
						className="flex flex-col gap-1.5 rounded-md border border-stone-200 px-3 py-2.5 dark:border-stone-800"
					>
						<div className="flex items-center justify-between gap-3">
							<Label htmlFor={controlId} className="text-xs font-medium">
								{field.label}
							</Label>
							<Switch
								id={controlId}
								checked={values[field.key] === true}
								onCheckedChange={(checked) => onChange(field.key, checked)}
							/>
						</div>
						<FieldDescription text={field.description} />
					</div>
				);
			})}
		</div>
	);
}
