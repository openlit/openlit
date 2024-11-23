/** @type {import('next').NextConfig} */
const nextConfig = {
	env: {
		NEXT_PUBLIC_TELEMETRY_ENABLED: process.env.TELEMETRY_ENABLED,
		NEXT_PUBLIC_POSTHOG_API_KEY: process.env.POSTHOG_API_KEY,
		NEXT_PUBLIC_POSTHOG_API_HOST: process.env.POSTHOG_API_HOST,
	},
	images: {
		remotePatterns: [
			{
				protocol: "https",
				hostname: "*",
			},
			{
				protocol: "https",
				hostname: "raw.githubusercontent.com",
			},
		],
	},
	reactStrictMode: false,
};

module.exports = nextConfig;
