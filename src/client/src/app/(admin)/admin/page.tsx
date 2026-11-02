import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import getMessage from "@/constants/messages";
import { ICON_CLASSES } from "@/constants/sidebar";
import { getAdminSidebarItems } from "@/features/admin-sidebar";

export const dynamic = "force-dynamic";

export default function AdminIndexPage() {
	const first = getAdminSidebarItems(ICON_CLASSES).find((item) => item.link);
	if (first?.link) redirect(first.link);

	const messages = getMessage();
	return (
		<div className="flex h-full w-full flex-1 items-center justify-center p-6">
			<div className="flex max-w-sm flex-col items-center gap-2 text-center">
				<ShieldCheck className="size-6 text-stone-400 dark:text-stone-500" />
				<h1 className="text-sm font-semibold text-stone-950 dark:text-stone-50">
					{messages.INSTANCE_ADMIN_EMPTY_TITLE}
				</h1>
				<p className="text-xs text-stone-500 dark:text-stone-400">
					{messages.INSTANCE_ADMIN_EMPTY_DESCRIPTION}
				</p>
			</div>
		</div>
	);
}
