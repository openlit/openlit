import { useState, useEffect, useCallback } from "react";
import { LayoutDashboardIcon, Clock, ComponentIcon } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { toast } from "sonner";
import { Board } from "@/types/manage-dashboard";

function formatDate(dateString: string) {
	const date = new Date(dateString);
	return date.toLocaleDateString(undefined, {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}

export default function BoardList() {
	const [boards, setBoards] = useState<Board[]>([]);
	const { fireRequest, isLoading } = useFetchWrapper();

	const fetchBoards = useCallback(() => {
		fireRequest({
			url: "/api/manage-dashboard/board",
			requestType: "GET",
			successCb: (response) => {
				if (response?.data) {
					setBoards(response.data);
				}
			},
			failureCb: (error) => {
				toast.error("Failed to load boards");
				console.error("Error loading boards:", error);
			},
		});
	}, [fireRequest]);

	useEffect(() => {
		fetchBoards();
	}, [fetchBoards]);

	const navigateToBoard = useCallback((boardId: string) => {
		window.location.href = `/manage-dashboard/board/${boardId}`;
	}, []);

	return (
		<div className="flex flex-col gap-3 grow overflow-y-hidden">
			<div className="flex justify-between items-center text-stone-700 dark:text-stone-300">
				<h3 className="font-medium">Boards</h3>
			</div>

			<div className="grow rounded-sm overflow-y-auto">
				{isLoading ? (
					<div className="flex justify-center items-center py-8">
						<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
					</div>
				) : boards.length === 0 ? (
					<div className="text-center py-8 text-muted-foreground">
						<p>No boards available</p>
						<p className="text-sm mt-2">
							Create a board in the Explorer to get started
						</p>
					</div>
				) : (
					<div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
						{boards.map((board) => (
							<Card
								key={board.id}
								className="group hover:shadow-lg transition-all duration-200 cursor-pointer border border-stone-200 dark:border-stone-800 hover:border-stone-300 dark:hover:border-stone-700"
								onClick={() => navigateToBoard(board.id)}
							>
								<CardHeader className="pb-3">
									<div className="flex items-start justify-between">
										<LayoutDashboardIcon className="h-5 w-5 text-stone-500 dark:text-stone-400 group-hover:text-stone-600 dark:group-hover:text-stone-300 transition-colors" />
										{board.isMainDashboard && (
											<Badge className="text-xs" variant="secondary">
												Main Dashboard
											</Badge>
										)}
									</div>
									<CardTitle className="text-lg font-semibold text-stone-900 dark:text-stone-300 group-hover:text-stone-600 dark:group-hover:text-stone-200 transition-colors">
										{board.title}
									</CardTitle>
								</CardHeader>
								<CardContent className="space-y-4">
									<p className="text-sm text-gray-600 line-clamp-2 shrink-0 h-[40px]">
										{board.description}
									</p>
									<div className="flex items-center justify-between text-sm text-gray-500">
										<div className="flex items-center gap-1 text-xs text-gray-400">
											<Clock className="h-3 w-3" />
											<span>Updated {formatDate(board.updatedAt)}</span>
										</div>
										<div className="flex items-center gap-1">
											<ComponentIcon className="h-3 w-3" />
											<span>{board.totalWidgets ?? 0} widgets</span>
										</div>
									</div>
								</CardContent>
							</Card>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
