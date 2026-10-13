import ThresholdAlertForm from "@/components/(playground)/alerts/threshold-alert-form";
import FeatureAccess from "@/components/rbac/feature-access";

export default function NewAlertPage() {
	return (
		<FeatureAccess access="alerts.create" requireProject>
			<ThresholdAlertForm />
		</FeatureAccess>
	);
}
