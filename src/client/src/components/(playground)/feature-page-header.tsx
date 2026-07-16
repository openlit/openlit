import type { ReactNode } from "react";

type FeaturePageHeaderProps = {
	eyebrow: string;
	title: string;
	description?: string;
	icon: ReactNode;
	tone?: string;
	/** Left-side control (typically an icon-only back button on detail pages). */
	leading?: ReactNode;
	actions?: ReactNode;
};

export default function FeaturePageHeader({
	eyebrow,
	title,
	description,
	icon,
	tone = "border-stone-200 bg-stone-50 text-stone-700 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-200",
	leading,
	actions,
}: FeaturePageHeaderProps) {
	return (
		<section className="border-b border-stone-200 px-4 py-3 dark:border-stone-800">
			<div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
				<div className="min-w-0">
					<div className="flex items-center gap-2">
						{leading ? <div className="shrink-0">{leading}</div> : null}
						<span className={`inline-flex shrink-0 items-center justify-center rounded-md border p-2 ${tone}`}>
							{icon}
						</span>
						<div className="min-w-0">
							<p className="text-[11px] uppercase tracking-wide text-stone-500 dark:text-stone-400">
								{eyebrow}
							</p>
							<h1 className="truncate text-sm font-semibold leading-tight text-stone-950 dark:text-stone-50">
								{title}
							</h1>
							{description ? (
								<p className="mt-0.5 text-xs text-stone-600 dark:text-stone-300">
									{description}
								</p>
							) : null}
						</div>
					</div>
				</div>
				{actions ? <div className="shrink-0">{actions}</div> : null}
			</div>
		</section>
	);
}
