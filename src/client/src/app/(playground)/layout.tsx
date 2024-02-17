import Sidebar from "@/components/(playground)/sidebar";
import { FilterProvider } from "./filter-context";
import Header from "@/components/(playground)/header";

export default function PlaygroundLayout({
	children, // will be a page or nested layout
}: {
	children: React.ReactNode;
}) {
	return (
		<div className="h-screen w-screen overflow-hidden flex bg-secondary/[.6]">
			<Sidebar />
			<FilterProvider>
				<main className="w-full h-full py-2 pr-2 overflow-hidden">
					<div className="flex flex-col w-full h-full overflow-hidden rounded-lg bg-white/[0.9]">
						<Header />
						<div className="flex flex-col grow w-full h-full px-4 overflow-hidden">
							{children}
						</div>
					</div>
				</main>
			</FilterProvider>
		</div>
	);
}
