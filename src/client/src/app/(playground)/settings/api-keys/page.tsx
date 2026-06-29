"use client";
import { useEffect } from "react";
import { usePostHog } from "posthog-js/react";
import { CLIENT_EVENTS } from "@/constants/events";
import ManageKeys from "@/components/(playground)/api-keys/manage";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Key, Shield, RotateCcw, Trash2 } from "lucide-react";
import FeaturePageHeader from "@/components/(playground)/feature-page-header";

export default function APIKeys() {
	const posthog = usePostHog();

	useEffect(() => {
		posthog?.capture(CLIENT_EVENTS.SETTINGS_API_KEYS_PAGE_VISITED);
	}, []);

	return (
		<div className="flex w-full flex-1 overflow-hidden">
			<div className="flex flex-col grow w-full rounded overflow-auto text-sm text-stone-900 dark:text-stone-300 gap-4">
				<FeaturePageHeader
					eyebrow="Settings"
					title="API Keys"
					description="Create scoped credentials for integrations while keeping secrets rotated, revocable, and under your control."
					icon={<Key className="h-4 w-4" />}
					tone="border-primary/20 bg-primary/10 text-primary dark:border-primary/30 dark:bg-primary/15"
				/>
				<Alert className="border-amber-200 bg-amber-50/70 py-3 text-stone-700 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-stone-300">
					<Shield className="h-4 w-4 stroke-amber-700 dark:stroke-amber-300" />
					<AlertTitle className="text-sm font-semibold text-stone-900 dark:text-stone-100">
						Important notice
					</AlertTitle>
					<AlertDescription className="mt-1">
						<div className="grid gap-2 text-xs leading-relaxed text-stone-600 dark:text-stone-400 md:grid-cols-3">
							<div className="flex items-start gap-2">
								<Key className="mt-0.5 h-3.5 w-3.5 shrink-0" />
								<span>Secret keys are shown only once after generation.</span>
							</div>
							<div className="flex items-start gap-2">
								<RotateCcw className="mt-0.5 h-3.5 w-3.5 shrink-0" />
								<span>Rotate keys periodically and after team changes.</span>
							</div>
							<div className="flex items-start gap-2">
								<Trash2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
								<span>Revoke unused or exposed keys immediately.</span>
							</div>
						</div>
					</AlertDescription>
				</Alert>
				<ManageKeys />
			</div>
		</div>
	);
}
