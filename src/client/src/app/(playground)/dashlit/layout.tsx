"use client";
import RouteBreadcrumbs from "@/components/(playground)/route-breadcrumbs";
import { useParams } from "next/navigation";

export default function PromptLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const params = useParams();
	return (
		<div className="flex flex-col w-full h-full gap-4">
			<div className="flex w-full items-center">
				<RouteBreadcrumbs />
			</div>
			{children}
		</div>
	);
}
