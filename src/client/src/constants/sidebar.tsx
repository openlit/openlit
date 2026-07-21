import OpenTelemetrySvg from "@/components/svg/opentelemetry";
import { getEnterpriseSidebarItems } from "@/features/sidebar";
import getMessage from "@/constants/messages";
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
	FolderKanban,
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

const m = getMessage();

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
				title: m.SIDEBAR_MONITOR,
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
					{
						icon: <MonitorCog className={ICON_CLASSES} />,
						text: m.FEATURE_EVALS,
						link: "/evaluations",
						type: "action",
					},
					{
						icon: <CircleDollarSign className={ICON_CLASSES} />,
						text: m.COSTS_TITLE,
						link: "/costs",
						type: "action",
					},
					...getEnterpriseSidebarItems("configuration", ICON_CLASSES),
				],
			},
			{
				title: m.SIDEBAR_DEVELOP,
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
		],
	},
	{
		title: "Settings",
		type: "section",
		collapsible: true,
		icon: <SettingsIcon className={ICON_CLASSES} />,
		children: [
			{
				icon: <Building2 className={ICON_CLASSES} />,
				text: m.ORGANISATION,
				link: "/organisation",
				type: "action",
			},
			{
				icon: <FolderKanban className={ICON_CLASSES} />,
				text: m.SIDEBAR_PROJECTS,
				link: "/organisation?tab=projects",
				type: "action",
			},
			{
				icon: <User className={ICON_CLASSES} />,
				text: m.USER_PROFILE,
				link: "/settings/profile",
				type: "action",
			},
			{
				icon: <Key className={ICON_CLASSES} />,
				text: m.API_KEYS,
				link: "/settings/api-keys",
				type: "action",
			},
			{
				icon: <BookOpen className={ICON_CLASSES} />,
				text: "OpenAPI Spec",
				link: "/openapi-spec",
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
