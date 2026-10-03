"use client";
import { useEffect } from "react";
import { ServerErrorCard } from "@/components/common/error-page";

export default function AuthError({
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
		<ServerErrorCard loggedIn={false} reference={error.digest} onRetry={reset} />
	);
}
