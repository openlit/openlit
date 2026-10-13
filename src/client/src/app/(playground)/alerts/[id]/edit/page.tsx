import ThresholdAlertForm from "@/components/(playground)/alerts/threshold-alert-form";
import FeatureAccess from "@/components/rbac/feature-access";

export default async function EditAlertPage({ params }: { params: Promise<{ id: string }> | { id: string } }) {
	const { id } = await params;
	return (
		<FeatureAccess access="alerts.update" requireProject>
			<ThresholdAlertForm alertId={id} />
		</FeatureAccess>
	);
}
