import getMessage from "@/constants/messages";
import { SIDEBAR_ITEMS } from "@/constants/sidebar";
import { SidebarActionItem, SidebarItemProps } from "@/types/sidebar";

export type ActiveApp = {
	title: string;
	href: string;
};

const HEADER_APP_LABEL_OVERRIDES: Record<string, keyof ReturnType<typeof getMessage>> =
	{
		"/prompt-hub": "NAV_APP_PROMPTS",
	};

function flattenSidebarActions(items: SidebarItemProps[]): SidebarActionItem[] {
	return items.flatMap((item) => {
		if (item.type !== "section") return [item];
		const direct = item.children ?? [];
		const grouped = (item.groups ?? []).flatMap((group) => group.children);
		return [...direct, ...grouped];
	});
}

function matchesAppPath(pathname: string, link: string): boolean {
	if (link === "/dashboards") {
		return pathname.startsWith("/dashboards") || pathname.startsWith("/d/");
	}

	return pathname === link || pathname.startsWith(`${link}/`);
}

function getHeaderAppLabel(link: string, sidebarText: string): string {
	const messageKey = HEADER_APP_LABEL_OVERRIDES[link];
	if (messageKey) {
		return getMessage()[messageKey] as string;
	}

	return sidebarText;
}

function resolveApp(link: string, sidebarText: string): ActiveApp {
	return {
		title: getHeaderAppLabel(link, sidebarText),
		href: link,
	};
}

export function getActiveApp(pathname: string): ActiveApp | null {
	if (pathname.startsWith("/onboarding")) {
		return null;
	}

	if (pathname.startsWith("/coding-agents")) {
		const agents = flattenSidebarActions(SIDEBAR_ITEMS).find(
			(item) => item.link === "/agents"
		);
		return agents?.link
			? resolveApp(agents.link, agents.text)
			: { title: "Agents", href: "/agents" };
	}

	if (pathname.startsWith("/chat")) {
		return { title: getMessage().CHAT_TITLE, href: "/chat" };
	}

	const actions = flattenSidebarActions(SIDEBAR_ITEMS)
		.filter((item) => item.link && !item.target)
		.sort((a, b) => (b.link?.length || 0) - (a.link?.length || 0));

	const match = actions.find(
		(item) => item.link && matchesAppPath(pathname, item.link)
	);

	if (!match?.link) {
		return null;
	}

	return resolveApp(match.link, match.text);
}
