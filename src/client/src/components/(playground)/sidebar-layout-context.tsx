"use client";

import {
	createContext,
	useCallback,
	useContext,
	useMemo,
	useState,
	type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

type SidebarLayoutContextValue = {
	isExpanded: boolean;
	toggleSidebar: () => void;
	expandSidebar: () => void;
	sidebarWidthClass: string;
};

const SidebarLayoutContext = createContext<SidebarLayoutContextValue | null>(
	null
);

export function SidebarLayoutProvider({ children }: { children: ReactNode }) {
	const [isExpanded, setIsExpanded] = useState(true);

	const toggleSidebar = useCallback(() => {
		setIsExpanded((value) => !value);
	}, []);

	const expandSidebar = useCallback(() => {
		setIsExpanded(true);
	}, []);

	const value = useMemo(
		() => ({
			isExpanded,
			toggleSidebar,
			expandSidebar,
			sidebarWidthClass: isExpanded ? "w-64" : "w-16",
		}),
		[isExpanded, toggleSidebar, expandSidebar]
	);

	return (
		<SidebarLayoutContext.Provider value={value}>
			{children}
		</SidebarLayoutContext.Provider>
	);
}

export function useSidebarLayout() {
	const context = useContext(SidebarLayoutContext);
	if (!context) {
		throw new Error("useSidebarLayout must be used within SidebarLayoutProvider");
	}
	return context;
}

export const PLAYGROUND_TOP_BAR_CLASS = "flex h-11 shrink-0 items-center";

export function playgroundTopBarClassName(className?: string) {
	return cn(PLAYGROUND_TOP_BAR_CLASS, className);
}
