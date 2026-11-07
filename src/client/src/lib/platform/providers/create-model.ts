import type { LanguageModel } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createMistral } from "@ai-sdk/mistral";
import { createCohere } from "@ai-sdk/cohere";
import getMessage from "@/constants/messages";
import {
	isChatProvider,
	OPENAI_COMPATIBLE_PROVIDER_ID,
} from "@/constants/chat-providers";
import { rewriteLoopbackEndpointForDocker } from "@/lib/platform/connectors/datasource/http/endpoint-url";
import {
	assertPublicUrl,
	selfHostedNetworkOptions,
	SsrfError,
} from "@/lib/platform/connectors/datasource/http/safe-fetch";

type ProviderFactory = (apiKey: string) => (model: string) => LanguageModel;

const providerFactories: Record<string, ProviderFactory> = {
	openai: (apiKey) => createOpenAI({ apiKey }),
	anthropic: (apiKey) => createAnthropic({ apiKey }),
	google: (apiKey) => createGoogleGenerativeAI({ apiKey }),
	mistral: (apiKey) => createMistral({ apiKey }),
	cohere: (apiKey) => createCohere({ apiKey }),
	groq: (apiKey) => createOpenAI({ baseURL: "https://api.groq.com/openai/v1", apiKey }),
	perplexity: (apiKey) => createOpenAI({
		baseURL: "https://api.perplexity.ai",
		apiKey,
		headers: { "X-Pplx-Integration": "openlit" },
	}),
	azure: (apiKey) => createOpenAI({
		baseURL: process.env.AZURE_OPENAI_ENDPOINT || "https://your-resource.openai.azure.com",
		apiKey,
		headers: { "api-key": apiKey },
	}),
	together: (apiKey) => createOpenAI({ baseURL: "https://api.together.xyz/v1", apiKey }),
	fireworks: (apiKey) => createOpenAI({ baseURL: "https://api.fireworks.ai/inference/v1", apiKey }),
	deepseek: (apiKey) => createOpenAI({ baseURL: "https://api.deepseek.com", apiKey }),
	xai: (apiKey) => createOpenAI({ baseURL: "https://api.x.ai/v1", apiKey }),
	huggingface: (apiKey) => createOpenAI({ baseURL: "https://api-inference.huggingface.co/v1", apiKey }),
	replicate: (apiKey) => createOpenAI({ baseURL: "https://openai-proxy.replicate.com/v1", apiKey }),
	minimax: (apiKey) => createOpenAI({ baseURL: "https://api.minimax.io/v1", apiKey }),
	orcarouter: (apiKey) => createOpenAI({ baseURL: "https://api.orcarouter.ai/v1", apiKey }),
};

/**
 * SSRF check for a user-supplied model endpoint. Cloud metadata addresses are
 * always rejected; private and loopback addresses need the server-side
 * OPENLIT_ALLOW_PRIVATE_MODEL_ENDPOINTS setting. Returns the URL to request,
 * which inside Docker has loopback rewritten to the host gateway.
 */
export async function assertModelEndpointAllowed(rawUrl: string): Promise<URL> {
	const network = selfHostedNetworkOptions({
		allowPrivateNetwork: process.env.OPENLIT_ALLOW_PRIVATE_MODEL_ENDPOINTS,
	});
	const target = network.allowPrivateNetwork
		? rewriteLoopbackEndpointForDocker(rawUrl)
		: rawUrl;
	return assertPublicUrl(target, network).catch(() => {
		throw new SsrfError(getMessage().MODEL_ENDPOINT_NOT_ALLOWED);
	});
}

/**
 * Re-validates every request and refuses redirects, so an allowed endpoint
 * cannot bounce a call to an internal address. Node's fetch resolves DNS again
 * at connect time, so a hostname that rebinds after this check is not covered
 * (same limit as `assertPublicUrl`).
 */
const guardedFetch: typeof fetch = async (input, init) => {
	const rawUrl = input instanceof Request ? input.url : String(input);
	const url = await assertModelEndpointAllowed(rawUrl);
	return fetch(url, { ...init, redirect: "error" });
};

export function createModel(
	providerId: string,
	apiKey: string,
	model: string,
	baseUrl?: string
): LanguageModel {
	if (!isChatProvider(providerId)) {
		throw new Error(`Provider ${providerId} not supported`);
	}
	if (providerId === OPENAI_COMPATIBLE_PROVIDER_ID) {
		if (!baseUrl) throw new Error(getMessage().OPENAI_COMPATIBLE_BASE_URL_REQUIRED);
		// Always pass a string: without one the SDK falls back to OPENAI_API_KEY
		// and would send that key to this endpoint. `.chat` targets
		// /chat/completions, which self-hosted servers implement; the default
		// model targets /responses.
		return createOpenAI({
			baseURL: baseUrl,
			apiKey: apiKey || "",
			fetch: guardedFetch,
		}).chat(model);
	}
	return providerFactories[providerId](apiKey)(model);
}
