"use client";
import { usePathname } from "next/navigation";

export default function Header() {
	const pathname = usePathname();
	return (
		<div className="relative flex shrink-0 px-4 p-3 mb-3 border-b border-secondary text-tertiary">
			<div className="flex flex-1 overflow-y-auto capitalize text-xl font-semibold">
				{pathname.substring(1).replaceAll("-", " ")}
			</div>
		</div>
	);
}
