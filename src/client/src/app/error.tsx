"use client";
import { useEffect } from "react";
import { useSession } from "next-auth/react";
import AuthShell from "@/components/(auth)/auth-shell";
import { ServerErrorCard } from "@/components/common/error-page";
import getMessage from "@/constants/messages";

// Also catches failures in the (playground) layout itself, so this page cannot
// re-render the dashboard shell and always uses the standalone auth shell.
export default function RootError({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	const { status } = useSession();

	useEffect(() => {
		console.error(error);
	}, [error]);

	return (
		<AuthShell pageLabel={getMessage().ERROR_PAGE_SERVER_ERROR_LABEL}>
			<ServerErrorCard
				loggedIn={status === "authenticated"}
				reference={error.digest}
				onRetry={reset}
			/>
		</AuthShell>
	);
}
