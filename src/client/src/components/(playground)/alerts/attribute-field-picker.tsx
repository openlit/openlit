"use client";

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import getMessage from "@/constants/messages";
import { isPersonalAttributeKey, isRealtimeMapKey } from "@/lib/platform/realtime/attributes";

const LIMIT = 100;

/**
 * Pick a span field or any span/resource attribute key: built-in fields,
 * then suggested and recently seen attributes, or type a key. Sensitive keys
 * (prompt, message, secrets) are never offered; personal keys are shown as
 * needing OPENLIT_SIGNAL_ATTRIBUTES; the server rejects them otherwise.
 */
export default function AttributeFieldPicker({
	value,
	fields,
	attributes,
	exclude = [],
	placeholder,
	onSelect,
	className = "w-52",
}: {
	value?: string;
	fields: readonly string[];
	attributes: readonly string[];
	exclude?: readonly string[];
	placeholder?: string;
	onSelect: (field: string) => void;
	className?: string;
}) {
	const m = getMessage();
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const query = search.trim();
	const skip = useMemo(() => new Set(exclude), [exclude]);
	const matches = (key: string) => !skip.has(key) && key.toLowerCase().includes(query.toLowerCase());
	const builtIn = fields.filter(matches);
	const attrs = useMemo(
		() => Array.from(new Set(attributes)).filter((key) => isRealtimeMapKey(key) && !isPersonalAttributeKey(key) && !fields.includes(key)),
		[attributes, fields]
	);
	const shownAttrs = attrs.filter(matches).slice(0, LIMIT);
	const known = fields.includes(query) || attrs.includes(query);
	const custom = query && !known && !skip.has(query) ? query : "";
	const customValid = custom ? isRealtimeMapKey(custom) : false;
	const customPersonal = customValid && isPersonalAttributeKey(custom);

	const choose = (field: string) => {
		onSelect(field);
		setOpen(false);
		setSearch("");
	};

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					type="button"
					variant="outline"
					role="combobox"
					aria-expanded={open}
					className={`h-8 justify-between gap-1 bg-white px-2 text-xs font-normal text-stone-900 dark:bg-stone-950 dark:text-stone-100 ${className}`}
				>
					<span className={`truncate ${value ? "font-mono" : "text-stone-500 dark:text-stone-400"}`}>{value || placeholder}</span>
					<ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-[320px] p-0" align="start">
				<Command shouldFilter={false}>
					<CommandInput
						value={search}
						onValueChange={setSearch}
						placeholder={m.ALERTING_FIELD_SEARCH}
						className="text-xs"
						onKeyDown={(event) => {
							if (event.key === "Enter" && customValid) {
								event.preventDefault();
								choose(custom);
							}
						}}
					/>
					<CommandList className="max-h-72">
						{custom ? (
							<CommandGroup>
								<CommandItem value={`custom:${custom}`} disabled={!customValid} onSelect={() => choose(custom)} className="text-xs">
									<Plus className="mr-2 h-3.5 w-3.5" />
									<span className="min-w-0 flex-1 truncate">
										{m.ALERTING_FIELD_USE_CUSTOM} <span className="font-mono">{custom}</span>
									</span>
								</CommandItem>
								{!customValid || customPersonal ? (
									<p className="px-2 pb-2 text-[11px] text-stone-500 dark:text-stone-400">
										{customValid ? m.ALERTING_FIELD_PERSONAL_HINT : m.ALERTING_FIELD_INVALID_HINT}
									</p>
								) : null}
							</CommandGroup>
						) : null}
						{builtIn.length ? (
							<CommandGroup heading={m.ALERTING_FIELD_GROUP_SPAN}>
								{builtIn.map((field) => (
									<CommandItem key={field} value={field} onSelect={() => choose(field)} className="text-xs">
										<Check className={`mr-2 h-3.5 w-3.5 ${value === field ? "opacity-100" : "opacity-0"}`} />
										{field}
									</CommandItem>
								))}
							</CommandGroup>
						) : null}
						{shownAttrs.length ? (
							<CommandGroup heading={m.ALERTING_FIELD_GROUP_ATTRIBUTES}>
								{shownAttrs.map((field) => (
									<CommandItem key={field} value={field} onSelect={() => choose(field)} className="font-mono text-[11px]">
										<Check className={`mr-2 h-3.5 w-3.5 ${value === field ? "opacity-100" : "opacity-0"}`} />
										<span className="truncate">{field}</span>
									</CommandItem>
								))}
							</CommandGroup>
						) : null}
						{!custom && !builtIn.length && !shownAttrs.length ? <CommandEmpty className="py-4 text-center text-xs">{m.ALERTING_FIELD_NONE}</CommandEmpty> : null}
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
