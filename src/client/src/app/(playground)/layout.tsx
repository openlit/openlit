"use client";
import Sidebar from "@/components/(playground)/sidebar";
import Header from "@/components/(playground)/header";
import { useEffect } from "react";
import { useRootStore } from "@/store";
import { getIsUserFetched, setUser } from "@/selectors/user";
import { fetchAndPopulateCurrentUserStore } from "@/helpers/user";

export default function PlaygroundLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const isFetched = useRootStore(getIsUserFetched);
	const updateUser = useRootStore(setUser);

	useEffect(() => {
		if (!isFetched) fetchAndPopulateCurrentUserStore(updateUser);
	}, [isFetched]);

	return (
		<div className="h-screen w-screen overflow-hidden flex bg-secondary/[.6]">
			<Sidebar />
			<main className="w-full h-full py-2 pr-2 overflow-hidden">
				<div className="flex flex-col w-full h-full overflow-hidden rounded-lg bg-white/[0.9]">
					<Header />
					<div className="flex flex-col grow w-full h-full px-4 overflow-hidden">
						{children}
					</div>
				</div>
			</main>
		</div>
	);
}
