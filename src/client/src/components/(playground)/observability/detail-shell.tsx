import { cn } from "@/lib/utils";

export default function DetailShell({
	title,
	leadingActions,
	actions,
	headerMeta,
	children,
	compact = false,
	fill = false,
}: {
	title: string;
	leadingActions?: React.ReactNode;
	actions?: React.ReactNode;
	headerMeta?: React.ReactNode;
	children: React.ReactNode;
	compact?: boolean;
	/** Lock the shell height and let inner panes scroll instead of the page. */
	fill?: boolean;
}) {
	return (
		<div
			className={cn(
				"flex h-full w-full flex-col rounded-md border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-950",
				fill ? "overflow-hidden" : "overflow-auto"
			)}
		>
			<div
				className={cn(
					"z-10 flex shrink-0 flex-col border-b border-stone-200 bg-white/95 shadow-sm shadow-stone-200/40 backdrop-blur dark:border-stone-800 dark:bg-stone-950/95 dark:shadow-black/20",
					compact ? "gap-2 px-3 py-2" : "gap-3 px-4 py-3",
					!fill && "sticky top-0"
				)}
			>
				<div
					className={`flex flex-col md:flex-row md:items-start md:justify-between ${compact ? "gap-2" : "gap-3"}`}
				>
					<div className="flex min-w-0 grow items-start gap-2">
						{leadingActions && <div className="shrink-0">{leadingActions}</div>}
						<div className="min-w-0 grow">
							<h1
								className={`truncate font-semibold text-stone-950 dark:text-stone-50 ${compact ? "text-base md:text-lg" : "text-lg md:text-xl"}`}
							>
								{title}
							</h1>
						</div>
					</div>
					{actions && <div className="shrink-0">{actions}</div>}
				</div>
				{headerMeta && <div>{headerMeta}</div>}
			</div>
			<div
				className={cn(
					"flex flex-col",
					compact ? "gap-2 p-2" : "gap-4 p-4",
					fill && "min-h-0 flex-1 overflow-hidden"
				)}
			>
				{children}
			</div>
		</div>
	);
}
