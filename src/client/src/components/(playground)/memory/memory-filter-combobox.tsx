"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import getMessage from "@/constants/messages";
import {
	type MemoryFilterChoice,
	type MemoryFilterField,
	type MemoryFilterOptions,
} from "@/lib/platform/connectors/memory/types";
import { cn } from "@/lib/utils";

export function memoryFilterChoices(
	field: MemoryFilterField,
	filters: MemoryFilterOptions,
	userId?: string
): MemoryFilterChoice[] {
	if (field.key === "userId") return filters.users;
	if (field.key === "agentId") return filters.agents;
	return filters.sessions.filter(
		(session) => !userId || !session.userId || session.userId === userId
	);
}

export default function MemoryFilterCombobox({
	label,
	value,
	options,
	onChange,
	allowCustom,
	disabled,
	required,
	widthClass = "w-[180px]",
	inDialog,
}: {
	label: string;
	value: string;
	options: MemoryFilterChoice[];
	onChange: (value: string) => void;
	allowCustom?: boolean;
	disabled?: boolean;
	required?: boolean;
	widthClass?: string;
	inDialog?: boolean;
}) {
	const messages = getMessage();
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	useEffect(() => {
		if (!open) setSearch("");
	}, [open]);

	const selectedLabel =
		options.find((option) => option.id === value)?.label || value || "";
	const listed = useMemo(() => {
		if (!value || options.some((option) => option.id === value)) return options;
		return [...options, { id: value, label: value }];
	}, [options, value]);
	const trimmedSearch = search.trim();
	const filtered = useMemo(() => {
		if (!trimmedSearch) return listed;
		const query = trimmedSearch.toLowerCase();
		return listed.filter((option) =>
			`${option.label} ${option.id}`.toLowerCase().includes(query)
		);
	}, [listed, trimmedSearch]);
	const showCustom =
		!!allowCustom &&
		!!trimmedSearch &&
		!listed.some(
			(option) =>
				option.id === trimmedSearch || option.label === trimmedSearch
		);

	function commit(next: string) {
		onChange(next);
		setSearch("");
		setOpen(false);
	}

	return (
		<Popover open={open} onOpenChange={setOpen} modal={inDialog}>
			<PopoverTrigger asChild>
				<button
					type="button"
					aria-label={label}
					disabled={disabled}
					className={cn(
						"flex h-8 min-w-0 items-center justify-between rounded-md border border-stone-200 bg-white px-3 py-2 text-sm placeholder:text-stone-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-200",
						widthClass
					)}
				>
					<span
						title={selectedLabel || undefined}
						className={cn(
							"min-w-0 flex-1 truncate text-left",
							selectedLabel
								? "text-stone-900 dark:text-stone-100"
								: "text-stone-500 dark:text-stone-400"
						)}
					>
						{selectedLabel ||
							(inDialog ? messages.MEMORY_FILTER_PLACEHOLDER : label)}
					</span>
					<ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
				</button>
			</PopoverTrigger>
			<PopoverContent
				className={cn(
					"p-0",
					inDialog
						? "w-[var(--radix-popover-trigger-width)]"
						: "w-[min(100vw-2rem,360px)] min-w-[var(--radix-popover-trigger-width)]"
				)}
				align="start"
				collisionPadding={8}
				onOpenAutoFocus={(event) => {
					if (inDialog) event.preventDefault();
				}}
			>
				<Command className="h-auto" shouldFilter={false}>
					<CommandInput
						placeholder={allowCustom ? messages.MEMORY_FILTER_CUSTOM_HINT : label}
						value={search}
						onValueChange={setSearch}
						onKeyDown={(event) => {
							if (event.key === "Enter" && allowCustom && trimmedSearch) {
								event.preventDefault();
								commit(trimmedSearch);
							}
						}}
					/>
					<CommandList>
						<CommandEmpty>
							{allowCustom
								? messages.MEMORY_FILTER_CUSTOM_HINT
								: messages.MEMORY_NO_MATCHES}
						</CommandEmpty>
						<CommandGroup>
							{!required && value ? (
								<CommandItem value="__all__" onSelect={() => commit("")}>
									{messages.MEMORY_FILTER_ALL}
								</CommandItem>
							) : null}
							{filtered.map((option) => (
								<CommandItem
									key={option.id}
									value={`${option.label} ${option.id}`}
									onSelect={() => commit(option.id)}
									className="gap-2"
								>
									<Check
										className={cn(
											"h-3.5 w-3.5 shrink-0",
											option.id === value ? "opacity-100" : "opacity-0"
										)}
									/>
									<span
										className="min-w-0 flex-1 break-all"
										title={option.label}
									>
										{option.label}
									</span>
								</CommandItem>
							))}
							{showCustom ? (
								<CommandItem
									value={trimmedSearch}
									onSelect={() => commit(trimmedSearch)}
								>
									<span className="min-w-0 flex-1 break-all">
										{messages.MEMORY_FILTER_USE_VALUE(trimmedSearch)}
									</span>
								</CommandItem>
							) : null}
						</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	);
}
