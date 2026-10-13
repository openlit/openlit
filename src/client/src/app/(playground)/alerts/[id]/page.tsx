import AlertDetail from "@/components/(playground)/alerts/alert-detail";
import FeatureAccess from "@/components/rbac/feature-access";

export default async function AlertDetailPage({ params }: { params: Promise<{ id: string }> | { id: string } }) {
	const { id } = await params;
	return (
		<FeatureAccess access="alerts.read" requireProject>
			<AlertDetail alertId={id} />
		</FeatureAccess>
	);
}
