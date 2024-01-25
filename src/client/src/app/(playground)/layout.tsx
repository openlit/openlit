import PlaygroundSidebar from "@/components/common/playground-sidebar";

export default function PlaygroundLayout({
	children, // will be a page or nested layout
}: {
	children: React.ReactNode;
}) {
	return (
		<div className="h-screen w-screen overflow-hidden flex">
			<PlaygroundSidebar />
			<main className="p-2 w-full h-full">
				<div className="p-4 w-full h-full rounded dark:bg-gray-700 overflow-auto">
					{children}
				</div>
			</main>
		</div>
	);
}
