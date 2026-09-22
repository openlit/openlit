/** @type {import('next').NextConfig} */
const contentSecurityPolicy = [
	"default-src 'self'",
	"base-uri 'self'",
	"object-src 'none'",
	"frame-ancestors 'none'",
	"form-action 'self'",
	"img-src 'self' data: blob: https:",
	"font-src 'self' data:",
	"style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
	"script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net",
	"worker-src 'self' blob:",
	"connect-src 'self' https: wss:",
].join("; ");

const nextConfig = {
	output: "standalone",
	poweredByHeader: false,
	transpilePackages: [
		"@openplait/adapter-clickhouse",
		"@openplait/adapter-jaeger",
		"@openplait/adapter-loki",
		"@openplait/adapter-prometheus",
		"@openplait/adapter-tempo",
		"@openplait/adapter-sdk",
		"@openplait/core",
		"@openplait/runtime",
	],
	images: {
		remotePatterns: [
			{
				protocol: "https",
				hostname: "raw.githubusercontent.com",
			},
		],
	},
	reactStrictMode: false,
	experimental: {
		instrumentationHook: true,
	},
	async rewrites() {
		const otlp = process.env.OTLP_PROXY_ORIGIN || "http://127.0.0.1:4318";
		return [
			{ source: "/v1/traces", destination: `${otlp}/v1/traces` },
			{ source: "/v1/metrics", destination: `${otlp}/v1/metrics` },
			{ source: "/v1/logs", destination: `${otlp}/v1/logs` },
		];
	},
	async headers() {
		return [
			{
				source: "/(.*)",
				headers: [
					{
						key: "X-Content-Type-Options",
						value: "nosniff",
					},
					{
						key: "X-Frame-Options",
						value: "DENY",
					},
					{
						key: "Referrer-Policy",
						value: "strict-origin-when-cross-origin",
					},
					{
						key: "Permissions-Policy",
						value: "camera=(), microphone=(), geolocation=()",
					},
					{
						key: "X-XSS-Protection",
						value: "1; mode=block",
					},
					{
						key: "Content-Security-Policy",
						value: contentSecurityPolicy,
					},
				],
			},
		];
	},
};

module.exports = nextConfig;
