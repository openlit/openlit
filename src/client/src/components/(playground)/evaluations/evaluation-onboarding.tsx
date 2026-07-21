"use client";

import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import getMessage from "@/constants/messages";

export default function EvaluationOnboarding({
	onConfigure,
}: {
	onConfigure: () => void;
}) {
	const m = getMessage();

	return (
		<div className="flex flex-col items-center justify-center w-full py-16 px-4">
			<div className="max-w-xl w-full flex flex-col items-center">
				<div className="w-16 h-16 bg-orange-50 dark:bg-orange-950/40 rounded-full flex items-center justify-center mb-4 border border-orange-200 dark:border-orange-900/70">
					<Settings2 className="w-8 h-8 text-orange-600 dark:text-orange-300" />
				</div>
				<h2 className="text-2xl font-semibold text-stone-700 dark:text-stone-200 mb-2 text-center">
					{m.EVALUATION_ONBOARDING_TITLE}
				</h2>
				<p className="text-stone-500 dark:text-stone-400 text-center max-w-md mb-6">
					{m.EVALUATION_ONBOARDING_DESCRIPTION}
				</p>
				<ol className="w-full space-y-3 mb-8 text-sm text-stone-600 dark:text-stone-400">
					<li className="rounded-md border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-900 px-4 py-3">
						<span className="font-medium text-stone-800 dark:text-stone-200">
							1.{" "}
						</span>
						{m.EVALUATION_ONBOARDING_STEP_1}
					</li>
					<li className="rounded-md border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-900 px-4 py-3">
						<span className="font-medium text-stone-800 dark:text-stone-200">
							2.{" "}
						</span>
						{m.EVALUATION_ONBOARDING_STEP_2}
					</li>
					<li className="rounded-md border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-900 px-4 py-3">
						<span className="font-medium text-stone-800 dark:text-stone-200">
							3.{" "}
						</span>
						{m.EVALUATION_ONBOARDING_STEP_3}
					</li>
				</ol>
				<Button onClick={onConfigure} className="h-9">
					{m.EVALUATION_ONBOARDING_CTA}
				</Button>
			</div>
		</div>
	);
}
