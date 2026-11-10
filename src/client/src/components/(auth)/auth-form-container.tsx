import getMessage from "@/constants/messages";

export default function AuthFormContainer({
	children,
}: {
	children: JSX.Element;
}) {
	const m = getMessage();

	return (
		<>
			<div className="rounded-xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-stone-950 sm:p-8">
				<h1 className="text-2xl font-semibold tracking-tight text-stone-950 dark:text-stone-50">
					{m.AUTH_WELCOME}
				</h1>
				<p className="mt-1.5 text-sm leading-6 text-stone-500 dark:text-stone-400">
					{m.AUTH_SUBTITLE}
				</p>
				<div className="mt-6">{children}</div>
			</div>
			<p className="mt-4 text-center font-mono text-[10px] uppercase tracking-wider font-semibold text-stone-500 dark:text-stone-500">
				{m.AUTH_FOOTER}
			</p>
		</>
	);
}
