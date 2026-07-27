"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ArrowLeft, FolderKanban, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import FeaturePageHeader from "@/components/(playground)/feature-page-header";
import getMessage from "@/constants/messages";
import ProjectEnvironmentSwitcher from "./project-environment-switcher";

export default function ProjectPageHeader({
	project,
}: {
	project?: { id?: string; name?: string; isCurrent?: boolean; isDefault?: boolean };
}) {
	const messages = getMessage();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const environment = searchParams?.get("environment") || "production";
	const environmentQuery = `?environment=${encodeURIComponent(environment)}`;
	const backLabel = messages.BACK_TO_ORGANISATION;

	return (
		<FeaturePageHeader
			eyebrow={messages.ORGANISATION}
			title={project?.name || project?.id || messages.LOADING_PROJECT}
			icon={<FolderKanban className="h-4 w-4" />}
			tone="border-primary/20 bg-primary/10 text-primary dark:border-primary/30"
			leading={
				<Button
					asChild
					variant="outline"
					size="sm"
					className="h-8 w-8 shrink-0 p-0"
				>
					<Link href="/organisation" title={backLabel} aria-label={backLabel}>
						<ArrowLeft className="h-3.5 w-3.5" />
					</Link>
				</Button>
			}
			actions={
				<div className="flex flex-wrap items-center justify-end gap-2">
					<ProjectEnvironmentSwitcher key={project?.id} value={environment} onChange={(nextEnvironment) => {
						const params = new URLSearchParams(searchParams?.toString() || "");
						params.set("environment", nextEnvironment);
						window.history.replaceState({}, "", `${pathname}?${params.toString()}`);
						window.dispatchEvent(new PopStateEvent("popstate"));
					}} />
					<Button asChild size="sm" variant={pathname?.endsWith(`/project/${project?.id}`) ? "default" : "outline"} className="h-8 gap-1.5 text-xs">
						<Link href={`/organisation/project/${project?.id || ""}${environmentQuery}`}><FolderKanban className="h-3.5 w-3.5" />{messages.PROJECT_OVERVIEW}</Link>
					</Button>
					<Button asChild size="sm" variant={pathname?.endsWith("/connectors") ? "default" : "outline"} className="h-8 gap-1.5 text-xs">
						<Link href={`/organisation/project/${project?.id || ""}/environments${environmentQuery}`}><Settings2 className="h-3.5 w-3.5" />{messages.PROJECT_ENVIRONMENTS}</Link>
					</Button>
				</div>
			}
		/>
	);
}
