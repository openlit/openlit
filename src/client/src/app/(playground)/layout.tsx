"use client";
import Sidebar from "@/components/(playground)/sidebar";
import Header from "@/components/(playground)/header";
import { useEffect } from "react";
import { useRootStore } from "@/store";
import { getIsUserFetched } from "@/selectors/user";
import { fetchAndPopulateCurrentUserStore } from "@/helpers/user";
import ClickhouseConnectivityWrapper from "@/components/(playground)/clickhouse-connectivity-wrapper";
import { TooltipProvider } from "@/components/ui/tooltip";

export default function PlaygroundLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const isFetched = useRootStore(getIsUserFetched);

	useEffect(() => {
		if (!isFetched) fetchAndPopulateCurrentUserStore();
	}, [isFetched]);

	return (
		<TooltipProvider>
			<div className="flex h-screen w-full pl-[56px] overflow-hidden">
				<Sidebar />
				<div className="flex flex-col grow w-full">
					<Header />
					<main className="flex flex-col grow flex-1 items-start p-4 sm:px-6 overflow-hidden">
						<ClickhouseConnectivityWrapper />
						{children}
					</main>
				</div>
			</div>
		</TooltipProvider>
	);
}
