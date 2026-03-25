import Image from "next/image";
import getMessage from "@/constants/messages";
import {
	BarChart3,
	BrainCircuit,
	FlaskConical,
	GitCompare,
	Lock,
	MessageSquareText,
	Search,
	Shield,
	Sparkles,
	Zap,
} from "lucide-react";

const featureIcons = [Search, BarChart3, Shield, BrainCircuit, GitCompare, MessageSquareText, FlaskConical, Lock, Zap, Sparkles];

const featureKeys: Array<{ title: keyof ReturnType<typeof getMessage>; desc: keyof ReturnType<typeof getMessage> }> = [
	{ title: "AUTH_FEATURE_TRACING", desc: "AUTH_FEATURE_TRACING_DESC" },
	{ title: "AUTH_FEATURE_ANALYTICS", desc: "AUTH_FEATURE_ANALYTICS_DESC" },
	{ title: "AUTH_FEATURE_EVALS", desc: "AUTH_FEATURE_EVALS_DESC" },
	{ title: "AUTH_FEATURE_JUDGE", desc: "AUTH_FEATURE_JUDGE_DESC" },
	{ title: "AUTH_FEATURE_OPENGROUND", desc: "AUTH_FEATURE_OPENGROUND_DESC" },
	{ title: "AUTH_FEATURE_PROMPT_HUB", desc: "AUTH_FEATURE_PROMPT_HUB_DESC" },
	{ title: "AUTH_FEATURE_RULE_ENGINE", desc: "AUTH_FEATURE_RULE_ENGINE_DESC" },
	{ title: "AUTH_FEATURE_VAULT", desc: "AUTH_FEATURE_VAULT_DESC" },
	{ title: "AUTH_FEATURE_INSTRUMENTATION", desc: "AUTH_FEATURE_INSTRUMENTATION_DESC" },
	{ title: "AUTH_FEATURE_OTEL", desc: "AUTH_FEATURE_OTEL_DESC" },
];

export default function AuthDetailsCarousel() {
	const messages = getMessage();
	return (
		<div className="relative hidden lg:flex flex-col justify-between bg-primary/[0.05] dark:bg-stone-950 p-10">
			{/* Logo */}
			<div className="flex items-center gap-3">
				<Image
					src="/images/logo.png"
					alt="OpenLIT"
					width="40"
					height="40"
					className="object-cover"
				/>
				<span className="text-lg font-bold text-stone-900 dark:text-stone-100">
					OpenLIT
				</span>
			</div>

			{/* Feature Grid */}
			<div className="flex-1 flex items-center justify-center">
				<div className="grid grid-cols-2 gap-4 max-w-lg w-full">
					{featureKeys.map((feature, i) => {
						const Icon = featureIcons[i];
						return (
							<div
								key={feature.title}
								className="flex items-start gap-3 p-3 rounded-lg bg-white/60 dark:bg-stone-900/50 border border-stone-200/50 dark:border-stone-800/50"
							>
								<div className="shrink-0 mt-0.5 p-1.5 rounded-md bg-primary/10 dark:bg-primary/20">
									<Icon className="h-4 w-4 text-primary" />
								</div>
								<div className="min-w-0">
									<p className="text-sm font-medium text-stone-900 dark:text-stone-100 leading-tight">
										{messages[feature.title] as string}
									</p>
									<p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5 leading-snug">
										{messages[feature.desc] as string}
									</p>
								</div>
							</div>
						);
					})}
				</div>
			</div>

			{/* Footer */}
			<p className="text-xs text-stone-400 dark:text-stone-500 text-center">
				{messages.AUTH_FOOTER}
			</p>
		</div>
	);
}
