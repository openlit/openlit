import RealtimeFindings from "@/components/(playground)/realtime/realtime-findings";
import FeatureAccess from "@/components/rbac/feature-access";

export default function RealtimePage() {
	return (
		<FeatureAccess access="realtime.read" requireProject>
			<RealtimeFindings />
		</FeatureAccess>
	);
}
