import AlertsOverview from "@/components/(playground)/alerts/alerts-overview";
import FeatureAccess from "@/components/rbac/feature-access";

export default function AlertsPage() {
	return (
		<FeatureAccess access="alerts.read" requireProject>
			<AlertsOverview />
		</FeatureAccess>
	);
}
