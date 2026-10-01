"use client";
import { useEffect } from "react";
import { DashboardErrorFrame, ServerErrorCard } from "@/components/common/error-page";

export default function PlaygroundError({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	useEffect(() => {
		console.error(error);
	}, [error]);

	return (
		<DashboardErrorFrame>
			<ServerErrorCard loggedIn reference={error.digest} onRetry={reset} />
		</DashboardErrorFrame>
	);
}
