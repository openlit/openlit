"use client";

export default function DetailShell({
	title,
	leadingActions,
	actions,
	headerMeta,
	children,
}: {
	title: string;
	leadingActions?: React.ReactNode;
	actions?: React.ReactNode;
	headerMeta?: React.ReactNode;
	children: React.ReactNode;
}) {
	return (
		<div className="flex flex-col w-full h-full overflow-auto rounded-md border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950">
			<div className="sticky top-0 z-10 flex flex-col gap-3 border-b border-stone-200 bg-white/95 px-4 py-3 shadow-sm shadow-stone-200/40 backdrop-blur dark:border-stone-800 dark:bg-stone-950/95 dark:shadow-black/20">
				<div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
					<div className="flex min-w-0 grow items-start gap-2">
						{leadingActions && <div className="shrink-0">{leadingActions}</div>}
						<div className="min-w-0 grow">
							<h1 className="truncate text-lg font-semibold text-stone-950 dark:text-stone-50 md:text-xl">
								{title}
							</h1>
						</div>
					</div>
					{actions && <div className="shrink-0">{actions}</div>}
				</div>
				{headerMeta && <div>{headerMeta}</div>}
			</div>
			<div className="flex flex-col gap-4 p-4">{children}</div>
		</div>
	);
}
