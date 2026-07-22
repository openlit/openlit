import TraceDetailPage from "@/components/(playground)/observability/trace-detail-page";

export default async function Page(props: { params: Promise<{ id: string }> }) {
    const params = await props.params;
    return <TraceDetailPage spanId={params.id} type="traces" />;
}
