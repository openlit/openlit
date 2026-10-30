import { describeInstanceEnvironment } from "@/lib/instance-env/describe";

describe("instance environment description", () => {
	const previous = {
		GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
		GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
		OKTA_ISSUER: process.env.OKTA_ISSUER,
	};

	afterEach(() => {
		for (const [key, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	});

	it("hides secrets and reports where each value comes from", async () => {
		process.env.GOOGLE_CLIENT_ID = "env-client";
		process.env.GOOGLE_CLIENT_SECRET = "env-secret";
		delete process.env.OKTA_ISSUER;

		const variables = await describeInstanceEnvironment({
			GOOGLE_CLIENT_ID: "saved-client",
			OKTA_CLIENT_SECRET: "saved-secret",
		});
		const byKey = Object.fromEntries(variables.map((variable) => [variable.key, variable]));

		expect(byKey.GOOGLE_CLIENT_ID).toMatchObject({
			source: "instance",
			secret: false,
			configured: true,
			value: "saved-client",
		});
		expect(byKey.GOOGLE_CLIENT_SECRET).toMatchObject({
			source: "environment",
			secret: true,
			configured: true,
			value: null,
		});
		expect(byKey.OKTA_CLIENT_SECRET).toMatchObject({
			source: "instance",
			secret: true,
			configured: true,
			value: null,
		});
		expect(byKey.OKTA_ISSUER).toMatchObject({
			source: "unset",
			configured: false,
			value: null,
		});
		expect(JSON.stringify(variables)).not.toContain("env-secret");
		expect(JSON.stringify(variables)).not.toContain("saved-secret");
	});
});
