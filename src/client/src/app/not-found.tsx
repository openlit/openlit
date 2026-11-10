import PlaygroundLayout from "@/app/(playground)/layout";
import AuthShell from "@/components/(auth)/auth-shell";
import { DashboardErrorFrame, NotFoundCard } from "@/components/common/error-page";
import getMessage from "@/constants/messages";
import { getCurrentUser } from "@/lib/session";

export default async function NotFound() {
	const user = await getCurrentUser();

	if (user) {
		return (
			<PlaygroundLayout>
				<DashboardErrorFrame>
					<NotFoundCard loggedIn />
				</DashboardErrorFrame>
			</PlaygroundLayout>
		);
	}

	return (
		<AuthShell pageLabel={getMessage().ERROR_PAGE_NOT_FOUND_LABEL}>
			<NotFoundCard loggedIn={false} />
		</AuthShell>
	);
}
