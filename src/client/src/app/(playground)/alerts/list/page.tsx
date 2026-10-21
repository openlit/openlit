import AlertsList from "@/components/(playground)/alerts/alerts-list";
import FeatureAccess from "@/components/rbac/feature-access";

export default function AlertsListPage() {
	return (
		<FeatureAccess access="alerts.read" requireProject>
			<AlertsList />
		</FeatureAccess>
	);
}
