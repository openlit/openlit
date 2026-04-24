import { SidebarItemProps } from "@/types/sidebar";
import {
	BookKey,
	BookOpen,
	BookText,
	CircleDollarSign,
	Component,
	Home,
	Key,
	LayoutDashboard,
	MessageSquare,
	MonitorCog,
	MonitorPlay,
	Radar,
	SettingsIcon,
	ShieldAlert,
	SlidersHorizontal,
	TextQuote
} from "lucide-react";
import DatabaseConfigSwitch from "@/components/(playground)/sidebar/database-config-switch";
import OpenTelemetrySvg from "@/components/svg/opentelemetry";
import OrganisationSwitch from "@/components/(playground)/sidebar/organisation-switch";
import Otter from "@/components/svg/otter";

export const ICON_CLASSES = "flex-shrink-0 size-5";

export const SIDEBAR_ITEMS: SidebarItemProps[] = [
	{
		title: "Organisation",
		type: "section",
		children: [
			{
				text: "Organisation Switch",
				component: <OrganisationSwitch />,
				type: "action",
			},
		]
	},
	{
		icon: <Home className={ICON_CLASSES} />,
		text: "Home",
		link: "/home",
		type: "action",
	},
	{
		icon: <Otter className={ICON_CLASSES} />,
		text: "Otter Chat",
		link: "/chat",
		type: "action",
	},
	{
		icon: <LayoutDashboard className={ICON_CLASSES} />,
		text: "Dashboards",
		link: "/dashboards",
		type: "action",
	},
	{
		title: "Monitoring",
		type: "section",
		children: [{
			icon: <TextQuote className={ICON_CLASSES} />,
			text: "Requests",
			link: "/requests",
			type: "action",
		},
		{
			icon: <ShieldAlert className={ICON_CLASSES} />,
			text: "Exceptions",
			link: "/exceptions",
			type: "action",
		},
		// {
		// 	icon: <Radar className={ICON_CLASSES} />,
		// 	text: "Instrumentation Hub",
		// 	link: "/instrumentation-hub",
		// 	type: "action",
		// },
		{
			icon: <OpenTelemetrySvg className={ICON_CLASSES} />,
			text: "Fleet Hub",
			link: "/fleet-hub",
			type: "action",
		},
		]
	},
	{
		title: "Resources",
		type: "section",
		children: [{
			icon: <Component className={ICON_CLASSES} />,
			text: "Prompt Hub",
			link: "/prompt-hub",
			type: "action",
		},
		{
			icon: <BookKey className={ICON_CLASSES} />,
			text: "Vault",
			link: "/vault",
			type: "action",
		},
		{
			icon: <BookOpen className={ICON_CLASSES} />,
			text: "Contexts",
			link: "/context",
			type: "action",
		},
		{
			icon: <SlidersHorizontal className={ICON_CLASSES} />,
			text: "Rule Engine",
			link: "/rule-engine",
			type: "action",
		},
		{
			icon: <MonitorPlay className={ICON_CLASSES} />,
			text: "Openground",
			link: "/openground",
			type: "action",
		},
		]
	},
	{
		title: "Configuration",
		type: "section",
		children: [{
			text: "Database Switch",
			component: <DatabaseConfigSwitch />,
			type: "action",
		},
		{
			icon: <MonitorCog className={ICON_CLASSES} />,
			text: "Evaluations",
			link: "/evaluations",
			type: "action",
		},
		{
			icon: <SettingsIcon className={ICON_CLASSES} />,
			text: "Manage Models",
			link: "/manage-models",
			type: "action",
		},
		{
			icon: <CircleDollarSign className={ICON_CLASSES} />,
			text: "Pricing",
			link: "/pricing",
			type: "action",
		},
		]
	},
	{
		title: "Settings",
		type: "section",
		collapsible: true,
		children: [
			{
				icon: <Key className={ICON_CLASSES} />,
				text: "Api Keys",
				link: "/settings/api-keys",
				type: "action",
			},
		]
	},
	{
		text: "Documentation",
		link: "https://docs.openlit.io/",
		target: "_blank",
		icon: <BookText className={ICON_CLASSES} />,
		type: "action",
	}
];