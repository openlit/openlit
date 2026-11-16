/**
 * Minimal GitHub REST API for the e2e suite (`OPENLIT_GITHUB_API_URL`).
 * Every repository resolves to one commit whose tarball is the fixture repo,
 * with a top-level directory as GitHub archives have.
 */
const { spawn } = require("child_process");
const { createServer } = require("http");
const { join } = require("path");

const PORT = Number(process.env.E2E_GITHUB_PORT || 3012);
const SHA = "826b268f0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f";
const FIXTURES = __dirname;

createServer((request, response) => {
	const path = new URL(request.url || "/", "http://localhost").pathname;
	if (path === "/health") {
		response.writeHead(200).end("ok");
		return;
	}
	if (/^\/repos\/[^/]+\/[^/]+\/commits\/[^/]+$/.test(path)) {
		response.writeHead(200, { "Content-Type": "application/vnd.github.sha" }).end(SHA);
		return;
	}
	if (/^\/repos\/[^/]+\/[^/]+\/tarball\/[0-9a-f]{40}$/.test(path)) {
		response.writeHead(200, { "Content-Type": "application/x-gzip" });
		const tar = spawn("tar", ["-czf", "-", "-C", FIXTURES, "repo"]);
		tar.stdout.pipe(response);
		return;
	}
	response.writeHead(404, { "Content-Type": "application/json" }).end(JSON.stringify({ message: "Not Found" }));
}).listen(PORT, () => {
	process.stdout.write(`fake GitHub API on ${PORT} serving ${join(FIXTURES, "repo")}\n`);
});
