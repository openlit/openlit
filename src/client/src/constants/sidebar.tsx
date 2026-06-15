import OpenTelemetrySvg from "@/components/svg/opentelemetry";
import Otter from "@/components/svg/otter";
import { getEnterpriseSidebarItems } from "@/features/sidebar";
import { SidebarItemProps } from "@/types/sidebar";
import {
	Activity,
	BookKey,
	BookOpen,
	BookText,
	Bot,
	Building2,
	CircleDollarSign,
	Component,
	Database,
	Home,
	Key,
	LayoutDashboard,
	MonitorCog,
	MonitorPlay,
	SettingsIcon,
	SlidersHorizontal,
} from "lucide-react";

export const ICON_CLASSES = "flex-shrink-0 size-5";

export const SIDEBAR_ITEMS: SidebarItemProps[] = [
	{
		icon: <Home className={ICON_CLASSES} />,
		text: "Home",
		link: "/home",
		type: "action",
	},
	{
		icon: <Otter className={ICON_CLASSES} />,
		text: "Otter",
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
		children: [
			{
				icon: <Activity className={ICON_CLASSES} />,
				text: "Telemetry",
				link: "/telemetry",
				type: "action",
			},
			...getEnterpriseSidebarItems("monitoring", ICON_CLASSES),
			{
				icon: <Bot className={ICON_CLASSES} />,
				text: "Agents",
				link: "/agents",
				type: "action",
			},
			{
				icon: <OpenTelemetrySvg className={ICON_CLASSES} />,
				text: "Fleet Hub",
				link: "/fleet-hub",
				type: "action",
			},
		],
	},
	{
		title: "Resources",
		type: "section",
		children: [
			{
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
		],
	},
	{
		title: "Configuration",
		type: "section",
		children: [
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
			...getEnterpriseSidebarItems("configuration", ICON_CLASSES),
		],
	},
	{
		title: "Settings",
		type: "section",
		collapsible: true,
		children: [
			{
				icon: <Building2 className={ICON_CLASSES} />,
				text: "Organisation",
				link: "/settings/organisation",
				type: "action",
			},
			{
				icon: <Database className={ICON_CLASSES} />,
				text: "Database Config",
				link: "/settings/database-config",
				type: "action",
			},
			{
				icon: <Key className={ICON_CLASSES} />,
				text: "Api Keys",
				link: "/settings/api-keys",
				type: "action",
			},
		],
	},
	{
		text: "Documentation",
		link: "https://docs.openlit.io/",
		target: "_blank",
		icon: <BookText className={ICON_CLASSES} />,
		type: "action",
	},
];
