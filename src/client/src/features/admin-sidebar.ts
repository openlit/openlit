import { SidebarActionItem } from "@/types/sidebar";

// Navigation for the instance admin area. Open source has no instance
// settings pages yet; enterprise replaces this module with its own items.
export function getAdminSidebarItems(_iconClasses: string): SidebarActionItem[] {
	return [];
}
