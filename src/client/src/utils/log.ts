export function consoleLog(...rest: unknown[]) {
	// JSON.stringify escapes control characters so user-controlled values cannot
	// forge log lines (CodeQL js/log-injection). Fall back when args contain
	// circular structures (e.g. jsonStringify error path).
	try {
		console.log(JSON.stringify(rest));
	} catch {
		console.log(
			rest.map((value) => {
				try {
					return JSON.stringify(value);
				} catch {
					return Object.prototype.toString.call(value);
				}
			})
		);
	}
}
