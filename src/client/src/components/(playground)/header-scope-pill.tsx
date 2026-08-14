import { cn } from "@/lib/utils";

export const headerScopeTriggerClassName = cn(
	"inline-flex h-auto min-w-0 max-w-52 shrink-0 items-center gap-1 border-0 bg-transparent p-0",
	"text-xs font-medium text-stone-700 shadow-none",
	"hover:text-stone-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-1 rounded-sm",
	"disabled:pointer-events-none disabled:opacity-50",
	"dark:text-stone-300 dark:hover:text-stone-100"
);

export function HeaderScopeSeparator() {
	return (
		<span className="shrink-0 px-0.5 text-xs text-stone-400 dark:text-stone-600">
			/
		</span>
	);
}
