/**
 * One-shot TypeSafe Jev app instrumented with the OpenLIT TypeScript SDK.
 *
 * Sends one async System One request, then flushes OTLP traces to OpenLIT
 * (default http://127.0.0.1:4318).
 */
const fs = require("fs");
const path = require("path");

function loadRepoEnv() {
  const envPath = path.resolve(__dirname, "../../.env");
  if (!fs.existsSync(envPath)) return;
  for (const raw of fs.readFileSync(envPath, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const idx = line.indexOf("=");
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

loadRepoEnv();

if (!process.env.TYPESAFE_API_KEY) {
  throw new Error("TYPESAFE_API_KEY is required");
}

const openlitMod = require("openlit");
const Openlit = openlitMod.default || openlitMod.Openlit || openlitMod;

const SERVICE_NAME = process.env.OPENLIT_SERVICE_NAME || "typesafe-jev-typescript";
const ENVIRONMENT = process.env.OPENLIT_ENVIRONMENT || "dev";
const OTLP_ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://127.0.0.1:4318";
const MODEL = process.env.JEV_MODEL || "jev-1.13.0";

Openlit.init({
  applicationName: SERVICE_NAME,
  environment: ENVIRONMENT,
  otlpEndpoint: OTLP_ENDPOINT,
  disableBatch: true,
  captureMessageContent: true,
});

const { TypeSafeClient } = require("@typesafe-ai/sdk");

async function main() {
  console.log(
    `[openlit] service=${SERVICE_NAME} env=${ENVIRONMENT} otlp=${OTLP_ENDPOINT} model=${MODEL}`
  );
  const client = new TypeSafeClient();
  const response = await client.systemOne({
    state: {
      prompt: "What is the largest planet in the solar system?",
      response: "Earth",
      ground_truth_context: "Jupiter is the largest planet in the solar system.",
    },
    questions: {
      hallucination: {
        type: "noul",
        instructions:
          "Flag invented or contradictory claims versus the ground-truth context.",
      },
    },
    model: MODEL,
  });
  const noul = response?.answers?.hallucination?.noul;
  console.log(`[async] model=${response?.model} noul=${noul}`);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  console.log("[openlit] sent decision span");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
