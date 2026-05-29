import TraceDetailPage from "@/components/(playground)/observability/trace-detail-page";

export default function Page({ params }: { params: { id: string } }) {
	return <TraceDetailPage spanId={params.id} type="traces" />;
}
