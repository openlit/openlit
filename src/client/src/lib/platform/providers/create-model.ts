import dns from "dns";
import http from "http";
import https from "https";
import type { LookupFunction } from "net";
import { Readable } from "stream";
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
	isCloudMetadataAddress,
	isPrivateAddress,
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

const NULL_BODY_STATUSES = new Set([204, 205, 304]);

const modelEndpointNetwork = () =>
	selfHostedNetworkOptions({
		allowPrivateNetwork: process.env.OPENLIT_ALLOW_PRIVATE_MODEL_ENDPOINTS,
	});

/**
 * SSRF check for a user-supplied model endpoint. Cloud metadata addresses are
 * always rejected; private and loopback addresses need the server-side
 * OPENLIT_ALLOW_PRIVATE_MODEL_ENDPOINTS setting. Returns the URL to request,
 * which inside Docker has loopback rewritten to the host gateway.
 */
export async function assertModelEndpointAllowed(rawUrl: string): Promise<URL> {
	const network = modelEndpointNetwork();
	const target = network.allowPrivateNetwork
		? rewriteLoopbackEndpointForDocker(rawUrl)
		: rawUrl;
	return assertPublicUrl(target, network).catch(() => {
		throw new SsrfError(getMessage().MODEL_ENDPOINT_NOT_ALLOWED);
	});
}

/**
 * Checks the addresses the socket is about to use, so a hostname that passed
 * `assertPublicUrl` and then rebinds is still refused.
 */
const guardedLookup: LookupFunction = (hostname, options, callback) => {
	const { allowPrivateNetwork } = modelEndpointNetwork();
	dns.lookup(hostname, options, (err, address, family) => {
		if (err) return callback(err, address, family);
		const addresses = Array.isArray(address) ? address : [{ address }];
		const blocked = addresses.some(
			(a) =>
				isCloudMetadataAddress(a.address) ||
				(!allowPrivateNetwork && isPrivateAddress(a.address))
		);
		if (blocked) {
			return callback(new SsrfError(getMessage().MODEL_ENDPOINT_NOT_ALLOWED), "", 0);
		}
		callback(null, address, family);
	});
};

/**
 * Global fetch cannot take a custom lookup without an undici dispatcher, so
 * this uses node:http directly. `agent: false` gives every call its own socket,
 * so the lookup always runs. Redirects are not followed.
 */
function requestModelEndpoint(url: URL, init: RequestInit = {}): Promise<Response> {
	const { request } = url.protocol === "https:" ? https : http;
	return new Promise((resolve, reject) => {
		const req = request(
			url,
			{
				agent: false,
				lookup: guardedLookup,
				method: init.method,
				headers: Object.fromEntries(new Headers(init.headers)),
				signal: init.signal ?? undefined,
			},
			(res) => {
				try {
					const status = res.statusCode!;
					const body = NULL_BODY_STATUSES.has(status)
						? null
						: (Readable.toWeb(res) as ReadableStream);
					const headers = new Headers();
					for (let i = 0; i < res.rawHeaders.length; i += 2) {
						headers.append(res.rawHeaders[i], res.rawHeaders[i + 1]);
					}
					resolve(new Response(body, { status, headers }));
				} catch (error) {
					// `Response` rejects statuses outside 200-599; thrown here it
					// would be an uncaught exception, not a failed request.
					res.destroy();
					reject(error);
				}
			}
		);
		req.on("error", reject);
		req.end(init.body as string | undefined);
	});
}

/** Re-validates every request, so a saved endpoint is checked on each call. */
const guardedFetch: typeof fetch = async (input, init) => {
	const rawUrl = input instanceof Request ? input.url : String(input);
	return requestModelEndpoint(await assertModelEndpointAllowed(rawUrl), init);
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
