/** @type {import('next').NextConfig} */
const nextConfig = {
	env: {
		TELEMETRY_ENABLED: process.env.TELEMETRY_ENABLED,
		POSTHOG_API_KEY: process.env.POSTHOG_API_KEY,
		POSTHOG_API_HOST: process.env.POSTHOG_API_HOST,
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
