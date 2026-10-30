"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import getMessage from "@/constants/messages";
import { Sparkles } from "lucide-react";

export default function OrganisationOverviewLicenseCard() {
	const messages = getMessage();

	return (
		<Card className="border-stone-200 dark:border-stone-800">
			<CardHeader className="pb-2">
				<CardTitle className="flex items-center gap-2 text-base text-stone-950 dark:text-stone-50">
					<Sparkles className="h-4 w-4 text-primary" />
					{messages.ORGANISATION_OVERVIEW_LICENSE_TITLE}
				</CardTitle>
			</CardHeader>
			<CardContent>
				<p className="text-sm leading-6 text-stone-600 dark:text-stone-300">
					{messages.ORGANISATION_OVERVIEW_LICENSE_DESCRIPTION}
				</p>
			</CardContent>
		</Card>
	);
}
