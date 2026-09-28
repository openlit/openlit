import Image from "next/image";
import getMessage from "@/constants/messages";
import {
	Activity,
	Bot,
	CircleDollarSign,
	KeyRound,
	MessageSquareText,
	MonitorCog,
} from "lucide-react";

const featureIcons = [
	Activity,
	MonitorCog,
	MessageSquareText,
	Bot,
	KeyRound,
	CircleDollarSign,
];

const featureKeys = [
	{ title: "AUTH_FEATURE_TRACING", desc: "AUTH_FEATURE_TRACING_DESC" },
	{ title: "AUTH_FEATURE_EVALS", desc: "AUTH_FEATURE_EVALS_DESC" },
	{ title: "AUTH_FEATURE_PROMPT_HUB", desc: "AUTH_FEATURE_PROMPT_HUB_DESC" },
	{ title: "AUTH_FEATURE_AGENTS", desc: "AUTH_FEATURE_AGENTS_DESC" },
	{ title: "AUTH_FEATURE_VAULT", desc: "AUTH_FEATURE_VAULT_DESC" },
	{ title: "AUTH_FEATURE_ANALYTICS", desc: "AUTH_FEATURE_ANALYTICS_DESC" },
] as const;

export default function AuthDetailsCarousel() {
	const messages = getMessage();
	return (
		<div className="relative hidden min-h-screen flex-col justify-between overflow-hidden bg-stone-950 p-10 text-stone-100 lg:flex xl:p-14">
			<div
				aria-hidden
				className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(243,108,6,0.22),transparent_58%)]"
			/>
			<div className="relative flex items-center gap-3">
				<Image
					src="/images/logo.png"
					alt=""
					width="32"
					height="32"
					className="object-cover"
				/>
				<span className="text-base font-semibold tracking-tight">OpenLIT</span>
			</div>

			<div className="relative max-w-full">
				<p className="text-xs font-medium uppercase tracking-[0.18em] text-primary">
					{messages.AUTH_PANEL_EYEBROW}
				</p>
				<h2 className="mt-4 text-3xl font-semibold tracking-tight text-white xl:text-4xl">
					{messages.AUTH_PANEL_TITLE}
				</h2>
				<p className="mt-4 text-sm leading-6 text-stone-400">
					{messages.AUTH_PANEL_BODY}
				</p>
				<ul className="mt-10 space-y-5">
					{featureKeys.map((feature, index) => {
						const Icon = featureIcons[index];
						return (
							<li key={feature.title} className="flex items-start gap-3">
								<Icon className="mt-0.5 size-4 shrink-0 text-primary" />
								<div className="min-w-0">
									<p className="text-sm font-medium text-stone-100">
										{messages[feature.title]}
									</p>
									<p className="mt-0.5 text-sm leading-5 text-stone-400">
										{messages[feature.desc]}
									</p>
								</div>
							</li>
						);
					})}
				</ul>
			</div>

			<p className="relative text-xs text-stone-500">{messages.AUTH_FOOTER}</p>
		</div>
	);
}
