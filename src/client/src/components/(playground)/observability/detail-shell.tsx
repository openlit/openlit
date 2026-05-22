"use client";

export default function DetailShell({
	title,
	leadingActions,
	actions,
	headerMeta,
	children,
	compact = false,
}: {
	title: string;
	leadingActions?: React.ReactNode;
	actions?: React.ReactNode;
	headerMeta?: React.ReactNode;
	children: React.ReactNode;
	compact?: boolean;
}) {
	return (
		<div className="flex flex-col w-full h-full overflow-auto rounded-md border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950">
			<div className={`sticky top-0 z-10 flex flex-col border-b border-stone-200 bg-white/95 shadow-sm shadow-stone-200/40 backdrop-blur dark:border-stone-800 dark:bg-stone-950/95 dark:shadow-black/20 ${compact ? "gap-2 px-3 py-2" : "gap-3 px-4 py-3"}`}>
				<div className={`flex flex-col md:flex-row md:items-start md:justify-between ${compact ? "gap-2" : "gap-3"}`}>
					<div className="flex min-w-0 grow items-start gap-2">
						{leadingActions && <div className="shrink-0">{leadingActions}</div>}
						<div className="min-w-0 grow">
							<h1 className={`truncate font-semibold text-stone-950 dark:text-stone-50 ${compact ? "text-base md:text-lg" : "text-lg md:text-xl"}`}>
								{title}
							</h1>
						</div>
					</div>
					{actions && <div className="shrink-0">{actions}</div>}
				</div>
				{headerMeta && <div>{headerMeta}</div>}
			</div>
			<div className={`flex flex-col ${compact ? "gap-2 p-2" : "gap-4 p-4"}`}>{children}</div>
		</div>
	);
}
