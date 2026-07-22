import MetricDetailPage from "@/components/(playground)/observability/metric-detail-page";

export default async function Page(props: { params: Promise<{ name: string }> }) {
    const params = await props.params;
    return <MetricDetailPage name={decodeURIComponent(params.name)} />;
}
