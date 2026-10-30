import net from "net";

const BLOCKED_HOSTS = new Set([
	"localhost",
	"localhost.localdomain",
	"metadata.google.internal",
	"metadata.goog",
	"metadata.azure.com",
	"instance-data",
	"169.254.169.254",
]);

function isPrivateIp(ip: string) {
	const version = net.isIP(ip);
	if (version === 4) {
		const parts = ip.split(".").map(Number);
		if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return true;
		if (parts[0] === 10 || parts[0] === 127 || parts[0] === 0) return true;
		if (parts[0] === 169 && parts[1] === 254) return true;
		if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
		if (parts[0] === 192 && parts[1] === 168) return true;
		if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
		return false;
	}
	if (version === 6) {
		const lower = ip.toLowerCase();
		if (lower === "::1" || lower === "::") return true;
		if (lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd")) return true;
		return false;
	}
	return false;
}

export function normalizeClientId(raw: string): string | null {
	const value = raw.trim();
	if (!value || value.length > 512) return null;
	if (!/^[A-Za-z0-9._~@+:/=-]+$/.test(value)) return null;
	return value;
}

export function normalizeSecret(raw: string): string | null {
	const value = raw.trim();
	if (!value || value.length > 2048) return null;
	if (/[\u0000-\u001F\u007F]/.test(value)) return null;
	return value;
}

export function normalizeAzureTenant(raw: string): string | null {
	const value = raw.trim();
	if (!value || value.length > 253) return null;
	if (/^(common|organizations|consumers)$/i.test(value)) return value.toLowerCase();
	if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
		return value.toLowerCase();
	}
	const host = value.toLowerCase().replace(/\.$/, "");
	if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(host)) return null;
	if (!host.includes(".") || host.includes("..")) return null;
	if (BLOCKED_HOSTS.has(host) || host.endsWith(".local") || host.endsWith(".internal")) return null;
	return host;
}

export function normalizeOktaIssuer(raw: string): string | null {
	const trimmed = raw.trim();
	if (!trimmed || trimmed.length > 256) return null;
	let url: URL;
	try {
		url = new URL(trimmed);
	} catch {
		return null;
	}
	if (url.protocol !== "https:") return null;
	if (url.username || url.password || url.search || url.hash) return null;
	const host = url.hostname.toLowerCase().replace(/\.$/, "");
	if (!host || net.isIP(host)) return null;
	if (BLOCKED_HOSTS.has(host) || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost")) {
		return null;
	}
	if (isPrivateIp(host)) return null;
	let path = url.pathname.replace(/\/+$/, "");
	const wellKnown = "/.well-known/openid-configuration";
	if (path.endsWith(wellKnown)) path = path.slice(0, -wellKnown.length);
	if (path.includes("..")) return null;
	return `${url.origin}${path}`;
}
