import OpenTelemetrySvg from "@/components/svg/opentelemetry";
import { getEnterpriseSidebarItems } from "@/features/sidebar";
import { SidebarItemProps } from "@/types/sidebar";
import {
	Activity,
	BookKey,
	BookOpen,
	BookText,
	Bot,
	Boxes,
	Building2,
	CircleDollarSign,
	Component,
	Cpu,
	Home,
	Key,
	LayoutDashboard,
	MonitorCog,
	MonitorPlay,
	SettingsIcon,
	SlidersHorizontal,
	User,
} from "lucide-react";

export const ICON_CLASSES = "flex-shrink-0 size-4";

export const SIDEBAR_ITEMS: SidebarItemProps[] = [
	{
		icon: <Home className={ICON_CLASSES} />,
		text: "Home",
		link: "/home",
		type: "action",
	},
	{
		icon: <LayoutDashboard className={ICON_CLASSES} />,
		text: "Dashboards",
		link: "/dashboards",
		type: "action",
	},
	{
		title: "Apps",
		type: "section",
		icon: <Boxes className={ICON_CLASSES} />,
		groups: [
			{
				title: "Monitoring",
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
				children: [
					{
						icon: <MonitorCog className={ICON_CLASSES} />,
						text: "Evaluations",
						link: "/evaluations",
						type: "action",
					},
			{
				icon: <Cpu className={ICON_CLASSES} />,
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
					{
						icon: <Building2 className={ICON_CLASSES} />,
						text: "Organisation",
						link: "/organisation",
						type: "action",
					},
					...getEnterpriseSidebarItems("configuration", ICON_CLASSES),
				],
			},
		],
	},
	{
		title: "Settings",
		type: "section",
		collapsible: true,
		icon: <SettingsIcon className={ICON_CLASSES} />,
		children: [
			{
				icon: <User className={ICON_CLASSES} />,
				text: "User Profile",
				link: "/settings/profile",
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
