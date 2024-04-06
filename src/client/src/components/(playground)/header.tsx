import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import Dropdown from "../common/drop-down";

function UserDropdownTrigger() {
	return (
		<span className="w-6 h-6 rounded-full bg-tertiary/[0.3] shadow overflow-hidden">
			<svg
				className="w-full h-full text-secondary"
				fill="currentColor"
				viewBox="0 0 24 24"
			>
				<path d="M24 20.993V24H0v-2.996A14.977 14.977 0 0112.004 15c4.904 0 9.26 2.354 11.996 5.993zM16.002 8.999a4 4 0 11-8 0 4 4 0 018 0z"></path>
			</svg>
		</span>
	);
}

export default function Header() {
	const pathname = usePathname();
	return (
		<div className="relative flex shrink-0 px-4 p-3 mb-3 border-b border-secondary text-tertiary items-center">
			<div className="flex flex-1 overflow-y-auto capitalize text-xl font-semibold">
				{pathname.substring(1).replaceAll("-", " ")}
			</div>
			<Dropdown
				triggerComponent={<UserDropdownTrigger />}
				itemList={[
					{
						label: "Signout",
						onClick: signOut,
					},
				]}
			/>
		</div>
	);
}
