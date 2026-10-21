import { EditAlertEntry } from "@/components/(playground)/alerts/alert-entry";
import FeatureAccess from "@/components/rbac/feature-access";

export default async function EditAlertPage({ params }: { params: Promise<{ id: string }> | { id: string } }) {
	const { id } = await params;
	return (
		<FeatureAccess access="alerts.update" requireProject>
			<EditAlertEntry alertId={id} />
		</FeatureAccess>
	);
}
