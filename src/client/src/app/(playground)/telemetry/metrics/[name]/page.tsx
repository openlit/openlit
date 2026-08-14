import MetricDetailPage from "@/components/(playground)/observability/metric-detail-page";

export default function Page({ params }: { params: { name: string } }) {
	return <MetricDetailPage name={decodeURIComponent(params.name)} />;
}
