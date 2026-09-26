"use client";

import { useEffect, useState } from "react";
import { useRootStore } from "@/store";
import { getCurrentProjectEnvironment } from "@/selectors/project";
import { OPENLIT_CONTEXT_HEADERS } from "@/constants/openlit-context";
import Link from "next/link";
import CodeBlock from "@/components/common/code-block";
import { Button } from "@/components/ui/button";
import getMessage from "@/constants/messages";
import { getRequestHeaders } from "@/utils/api";

const messages = getMessage();

export function sampleTraceCommand(traceId: string, environment: string): string {
	const safeEnvironment = JSON.stringify(environment);
	return `# Set OPENLIT_API_KEY in your shell if your receiver requires authentication.
# Change the endpoint if your OTLP receiver is not on this host.
import base64, json, os, time, urllib.request, urllib.error
trace_id = "${traceId}"
now = str(time.time_ns())
body = {"resourceSpans": [{"resource": {"attributes": [
    {"key": "service.name", "value": {"stringValue": "openlit-onboarding-check"}},
    {"key": "deployment.environment", "value": {"stringValue": ${safeEnvironment}}}
]}, "scopeSpans": [{"spans": [{"traceId": base64.b64encode(bytes.fromhex(trace_id)).decode(),
    "spanId": base64.b64encode(bytes.fromhex("0102030405060708")).decode(), "name": "openlit.onboarding.check",
    "startTimeUnixNano": now, "endTimeUnixNano": str(int(now) + 1000000)}]}]}]}
endpoint = os.environ.get("OPENLIT_OTLP_HTTP_ENDPOINT", "http://127.0.0.1:4318")
headers = {"Content-Type": "application/json"}
if os.environ.get("OPENLIT_API_KEY"):
    headers["Authorization"] = "Bearer " + os.environ["OPENLIT_API_KEY"]
request = urllib.request.Request(endpoint.rstrip("/") + "/v1/traces",
    data=json.dumps(body).encode(), headers=headers, method="POST")
try:
    with urllib.request.urlopen(request, timeout=10) as response:
        print("Receiver HTTP", response.status, "trace ID", trace_id)
except urllib.error.HTTPError as error:
    print("Receiver HTTP", error.code, error.read().decode(errors="replace"))
    raise
`;
}

export default function VerifyIngestion() {
	const [traceId, setTraceId] = useState("");
	useEffect(() => {
		setTraceId(Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join(""));
	}, []);
	const [result, setResult] = useState<{ state: "idle" | "checking" | "missing" | "found" | "error"; spanId?: string; timestamp?: string }>({ state: "idle" });
	const selectedEnvironment = useRootStore(getCurrentProjectEnvironment);
	const [environment, setEnvironment] = useState(selectedEnvironment || "default");
	useEffect(() => {
		if (selectedEnvironment) setEnvironment(selectedEnvironment);
	}, [selectedEnvironment]);

	async function verify() {
		setResult({ state: "checking" });
		try {
			const response = await fetch(`/api/metrics/request/trace/${traceId}?environment=${encodeURIComponent(environment)}`, {
				headers: getRequestHeaders({ [OPENLIT_CONTEXT_HEADERS.environment]: environment }),
			});
			if (!response.ok) throw new Error("trace lookup failed");
			const data = await response.json();
			if (data.err) throw new Error("trace lookup failed");
			const record = data.record;
			setResult(record?.TraceId?.toLowerCase() === traceId && record?.SpanId
				? { state: "found", spanId: record.SpanId, timestamp: record.Timestamp }
				: { state: "missing" });
		} catch {
			setResult({ state: "error" });
		}
	}

	return (
		<section aria-labelledby="verify-ingestion-title" className="mt-8 rounded-lg border border-stone-200 bg-white p-4 text-sm text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100">
			<h2 id="verify-ingestion-title" className="text-lg font-semibold">{messages.INGESTION_VERIFY_TITLE}</h2>
			<p className="mt-2">{messages.INGESTION_VERIFY_DESCRIPTION}</p>
			<p className="mt-2">{messages.INGESTION_VERIFY_ENDPOINTS}</p>
			<code className="block">HTTP: {typeof window !== "undefined" ? `${window.location.protocol}//${window.location.hostname}:4318/v1/traces` : "http://localhost:4318/v1/traces"}</code>
			<code className="block">gRPC: {typeof window !== "undefined" ? `${window.location.hostname}:4317` : "localhost:4317"}</code>
			<label className="mt-3 block" htmlFor="verification-environment">{messages.INGESTION_VERIFY_ENVIRONMENT}</label>
			<input id="verification-environment" value={environment} maxLength={80} onChange={(event) => setEnvironment(event.target.value)} className="mt-1 rounded border p-2 text-stone-900 dark:bg-stone-950 dark:text-stone-100" />
			<p className="mt-3">{messages.INGESTION_VERIFY_COMMAND}</p>
			{traceId && <CodeBlock language="python" code={sampleTraceCommand(traceId, environment)} className="text-xs" />}
			<p className="mt-2">{messages.INGESTION_VERIFY_RECEIVER_NOTE}</p>
			<Button className="mt-3" type="button" onClick={verify} disabled={!traceId || result.state === "checking"}>{messages.INGESTION_VERIFY_BUTTON}</Button>
			<div role="status" className="mt-2">
				{result.state === "checking" && messages.INGESTION_VERIFY_CHECKING}
				{result.state === "missing" && messages.INGESTION_VERIFY_MISSING}
				{result.state === "error" && messages.INGESTION_VERIFY_ERROR}
				{result.state === "found" && <>{messages.INGESTION_VERIFY_FOUND} {result.timestamp && `${messages.INGESTION_VERIFY_LAST_SEEN} ${result.timestamp}. `}<Link className="underline" href={`/telemetry/traces/${result.spanId}?traceId=${traceId}`}>{messages.INGESTION_VERIFY_OPEN_TRACE}</Link></>}
			</div>
		</section>
	);
}
