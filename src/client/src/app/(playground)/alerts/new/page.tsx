import { NewAlertEntry } from "@/components/(playground)/alerts/alert-entry";
import FeatureAccess from "@/components/rbac/feature-access";

export default function NewAlertPage() {
	return (
		<FeatureAccess access="alerts.create" requireProject>
			<NewAlertEntry />
		</FeatureAccess>
	);
}
