import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = [
	{
		ignores: [
			".next/**",
			"node_modules/**",
			"public/**",
			"next-env.d.ts",
		],
	},
	...nextCoreWebVitals,
	{
		rules: {
			// eslint-config-next 16 bundles eslint-plugin-react-hooks v6, which adds
			// the React Compiler rule set. The existing codebase predates these rules,
			// so keep them off to preserve the project's prior lint behavior (the
			// classic react-hooks/rules-of-hooks stays enabled). Adopt these
			// incrementally in a dedicated follow-up rather than in this upgrade.
			"react-hooks/exhaustive-deps": "off",
			"react-hooks/set-state-in-effect": "off",
			"react-hooks/immutability": "off",
			"react-hooks/refs": "off",
			"react-hooks/static-components": "off",
			"react-hooks/use-memo": "off",
			"react-hooks/purity": "off",
			"react-hooks/preserve-manual-memoization": "off",
		},
	},
];

export default eslintConfig;
