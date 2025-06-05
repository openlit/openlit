"use client";
import Link from "next/link";
import { FileJson2, LayoutDashboard } from "lucide-react";
import { ReactElement } from "react";
import { usePathname } from "next/navigation";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { buttonVariants } from "@/components/ui/button";

type NavMenuItemProps = {
    className?: string;
    icon: ReactElement;
    text: string;
    link: string;
};

const ICON_CLASSES = "flex-shrink-0 size-5";

const NAV_MENU_ITEMS: NavMenuItemProps[] = [
    {
        icon: <LayoutDashboard className={ICON_CLASSES} />,
        text: "Dashboard",
        link: "/dashboard",
    },
    {
        icon: <FileJson2 className={ICON_CLASSES} />,
        text: "Requests",
        link: "/requests",
    },
];

const NavMenus = () => {
    const pathname = usePathname();

    return (
        <nav className="flex gap-2 pb-4">
            {NAV_MENU_ITEMS.map((item, index) => {
                const isActive = pathname.startsWith(item.link ?? "");

                return (
                    <Tooltip key={`nav-menu-${index}`}>
                        <TooltipTrigger asChild>
                            <Link
                                href={item.link ?? ""}
                                className={`${buttonVariants({
                                    variant: "ghost",
                                    size: "icon",
                                })} ${isActive
                                    ? "text-white bg-primary dark:bg-primary dark:text-white"
                                    : "text-stone-600 dark:text-white"
                                    } ${item.className || ""}`}
                                aria-label={item.text}
                            >
                                {item.icon}
                            </Link>

                        </TooltipTrigger>
                        <TooltipContent side="bottom" sideOffset={5}>
                            {item.text}
                        </TooltipContent>
                    </Tooltip>
                );
            })}
        </nav>
    );
};

export default NavMenus;
