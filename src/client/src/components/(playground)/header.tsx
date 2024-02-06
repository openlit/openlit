"use client";
import { usePathname } from "next/navigation";

export default function Header() {
	const pathname = usePathname();
	return (
		<div className="relative flex shrink-0 p-2 mb-2">
			<div className="flex flex-1 overflow-y-auto uppercase text-xl">
				{pathname.substring(1).replaceAll("-", " ")}
			</div>
		</div>
	);
}
