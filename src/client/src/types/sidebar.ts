import { ReactElement } from "react";

export type SidebarGroup = {
	title: string;
	children: SidebarActionItem[];
}

export type SidebarSection = {
	title: string;
	type: "section";
	collapsible?: boolean;
	className?: string;
	icon?: ReactElement;
	children?: SidebarActionItem[];
	/**
	 * When set, the section renders inline with grouped sub-headers
	 * (e.g. the "Apps" section) instead of as a flyout panel.
	 */
	groups?: SidebarGroup[];
}

export type SidebarActionItem = {
	// className?: string;
	component?: ReactElement;
	icon?: ReactElement;
	text: string;
	link?: string;
	onClick?: any;
	target?: string;
	type: "action";
}

export type SidebarItemProps = SidebarActionItem | SidebarSection;