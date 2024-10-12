"use client";
import PromptHubHeader from "@/components/(playground)/prompt-hub/header";
import { useParams } from "next/navigation";

export default function PromptLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const params = useParams();
	return (
		<div className="flex flex-col w-full h-full gap-4">
			<PromptHubHeader createNew={!params.id} />
			{children}
		</div>
	);
}
