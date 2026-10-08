#!/usr/bin/env python3
"""Send synthetic GenAI spans to a local OTLP/HTTP receiver.

Pairs with scripts/dev-realtime.sh to exercise the realtime path:
receiver -> NATS -> openlit-engine -> /realtime findings.

Usage:
  OPENLIT_API_KEY=... scripts/dev-realtime-send-spans.py --count 20 --error-rate 1
"""
import argparse
import json
import os
import random
import secrets
import sys
import time
import urllib.error
import urllib.request


def attr(key, value):
    if isinstance(value, bool):
        return {"key": key, "value": {"boolValue": value}}
    if isinstance(value, int):
        return {"key": key, "value": {"intValue": str(value)}}
    if isinstance(value, float):
        return {"key": key, "value": {"doubleValue": value}}
    return {"key": key, "value": {"stringValue": str(value)}}


def build(args):
    now = time.time_ns()
    spans = []
    for i in range(args.count):
        failed = random.random() < args.error_rate
        duration_ns = int(args.latency_ms * 1_000_000)
        start = now - duration_ns - i * 1_000_000
        spans.append(
            {
                "traceId": secrets.token_hex(16),
                "spanId": secrets.token_hex(8),
                "name": f"chat {args.model}",
                "kind": 3,
                "startTimeUnixNano": str(start),
                "endTimeUnixNano": str(start + duration_ns),
                "status": {"code": 2, "message": "provider error"} if failed else {"code": 1},
                "attributes": [
                    attr("gen_ai.operation.name", "chat"),
                    attr("gen_ai.provider.name", args.provider),
                    attr("gen_ai.request.model", args.model),
                    attr("gen_ai.usage.input_tokens", args.input_tokens),
                    attr("gen_ai.usage.output_tokens", args.output_tokens),
                    attr("gen_ai.usage.cost", args.cost),
                ]
                + ([attr("http.response.status_code", args.http_status)] if args.http_status else []),
            }
        )
    return {
        "resourceSpans": [
            {
                "resource": {
                    "attributes": [
                        attr("service.name", args.service),
                        attr("deployment.environment", args.environment),
                    ]
                },
                "scopeSpans": [{"scope": {"name": "openlit.dev"}, "spans": spans}],
            }
        ]
    }


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--endpoint", default=os.environ.get("OTLP_ENDPOINT", "http://127.0.0.1:14318"))
    p.add_argument("--api-key", default=os.environ.get("OPENLIT_API_KEY", ""))
    p.add_argument("--count", type=int, default=20)
    p.add_argument("--error-rate", type=float, default=0.0)
    p.add_argument("--latency-ms", type=float, default=800)
    p.add_argument("--service", default="realtime-demo")
    p.add_argument("--environment", default="production")
    p.add_argument("--provider", default="openai")
    p.add_argument("--model", default="gpt-4o-mini")
    p.add_argument("--input-tokens", type=int, default=400)
    p.add_argument("--output-tokens", type=int, default=200)
    p.add_argument("--cost", type=float, default=0.002)
    p.add_argument("--http-status", type=int, default=0, help="Set http.response.status_code, e.g. 401")
    args = p.parse_args()

    body = json.dumps(build(args)).encode()
    headers = {"Content-Type": "application/json"}
    if args.api_key:
        headers["Authorization"] = f"Bearer {args.api_key}"
    req = urllib.request.Request(f"{args.endpoint.rstrip('/')}/v1/traces", data=body, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            print(f"sent {args.count} spans: HTTP {resp.status}")
    except urllib.error.HTTPError as e:
        print(f"receiver rejected spans: HTTP {e.code} {e.read().decode(errors='replace')}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
