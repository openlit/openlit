"use client";

import Link from "next/link";
import { ArrowLeft, FolderKanban } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import FeaturePageHeader from "@/components/(playground)/feature-page-header";
import getMessage from "@/constants/messages";

export default function ProjectPageHeader({ project }: { project?: { name?: string; isCurrent?: boolean; isDefault?: boolean } }) {
	const messages = getMessage();
	return <FeaturePageHeader eyebrow={messages.ORGANISATION} title={project?.name || messages.LOADING_PROJECT} description={messages.PROJECT_DETAILS_DESCRIPTION} icon={<FolderKanban className="h-4 w-4" />} tone="border-primary/20 bg-primary/10 text-primary dark:border-primary/30" actions={<div className="flex flex-wrap items-center gap-2"><Button asChild variant="outline" size="sm" className="h-8"><Link href="/organisation"><ArrowLeft className="mr-1.5 h-3.5 w-3.5" />{messages.BACK_TO_ORGANISATION}</Link></Button>{project?.isCurrent ? <Badge className="h-6">{messages.CURRENT}</Badge> : null}{project?.isDefault ? <Badge variant="outline" className="h-6">{messages.DEFAULT_PROJECT}</Badge> : null}</div>} />;
}
