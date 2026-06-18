import type { ReactNode } from "react";

type FeaturePageHeaderProps = {
	eyebrow: string;
	title: string;
	description?: string;
	icon: ReactNode;
	tone?: string;
	actions?: ReactNode;
};

export default function FeaturePageHeader({
	eyebrow,
	title,
	description,
	icon,
	tone = "border-stone-200 bg-stone-50 text-stone-700 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-200",
	actions,
}: FeaturePageHeaderProps) {
	return (
		<section className="rounded-md border border-stone-200 bg-white px-3 py-2 dark:border-stone-800 dark:bg-stone-950">
			<div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
				<div className="min-w-0">
					<div className="flex items-center gap-2">
						<span className={`rounded-md border p-1.5 ${tone}`}>
							{icon}
						</span>
						<div>
							<p className="text-[11px] uppercase tracking-wide text-stone-500 dark:text-stone-400">
								{eyebrow}
							</p>
							<h1 className="text-base font-semibold text-stone-950 dark:text-stone-50">
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
