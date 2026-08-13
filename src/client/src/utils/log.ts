export function consoleLog(...rest: unknown[]) {
	// JSON.stringify escapes control characters so user-controlled values cannot
	// forge log lines (CodeQL js/log-injection).
	console.log(JSON.stringify(rest));
}
