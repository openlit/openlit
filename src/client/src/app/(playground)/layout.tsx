import Sidebar from "@/components/(playground)/sidebar";
import { FilterProvider } from "./filter-context";
import Header from "@/components/(playground)/header";

export default function PlaygroundLayout({
	children, // will be a page or nested layout
}: {
	children: React.ReactNode;
}) {
	return (
		<div className="h-screen w-screen overflow-hidden flex">
			<Sidebar />
			<FilterProvider>
				<main className="flex flex-col p-3 w-full h-full overflow-hidden">
					<Header />
					{children}
				</main>
			</FilterProvider>
		</div>
	);
}
