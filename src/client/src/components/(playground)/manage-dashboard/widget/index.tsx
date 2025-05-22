import React, { useCallback, useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	CircularProgress,
	Dialog,
	DialogTitle,
	DialogContent,
	DialogContentText,
	DialogActions,
} from "@mui/material";

// Icon mapping for widget types
import {
	BarChart,
	LineChart,
	PieChart,
	Table,
	AreaChart,
	Gauge,
} from "lucide-react";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { toast } from "sonner";
const widgetTypeToIcon = {
	STAT_CARD: Gauge,
	BAR_CHART: BarChart,
	LINE_CHART: LineChart,
	PIE_CHART: PieChart,
	TABLE: Table,
	AREA_CHART: AreaChart,
};

const WidgetListPage = () => {
	const [widgets, setWidgets] = useState<any[]>([]);
	const [deleteDialog, setDeleteDialog] = useState<null | {
		id: string;
		title: string;
	}>(null);
	const [deleting, setDeleting] = useState(false);
	const { fireRequest, isLoading } = useFetchWrapper();

	const fetchWidgets = useCallback(() => {
		fireRequest({
			url: "/api/manage-dashboard/widget",
			requestType: "GET",
			successCb: (response) => {
				if (response?.data) {
					setWidgets(response.data);
				}
			},
			failureCb: (error) => {
				toast.error("Failed to load widgets");
				console.error("Error loading widgets:", error);
			},
		});
	}, [fireRequest]);

	useEffect(() => {
		fetchWidgets();
	}, [fetchWidgets]);

	const handleDelete = async (id: string) => {
		setDeleting(true);
		// await deleteWidget(id);
		setWidgets((prev) => prev.filter((w) => w.id !== id));
		setDeleting(false);
		setDeleteDialog(null);
	};

	return (
		<div className="flex flex-col gap-3 grow overflow-y-hidden">
			<div className="flex justify-between items-center text-stone-700 dark:text-stone-300">
				<h3 className="font-medium">Wigets</h3>
			</div>

			{isLoading ? (
				<div className="flex justify-center items-center grow">
					<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
				</div>
			) : (
				<div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 h-full overflow-y-auto">
					{widgets.map((widget) => {
						const IconComponent =
							widgetTypeToIcon[
								String(widget.type) as keyof typeof widgetTypeToIcon
							] || Gauge;
						return (
							<Card
								key={widget.id}
								className="group hover:shadow-lg transition-all duration-200 cursor-pointer border border-stone-200 hover:border-stone-300 relative"
							>
								{widget.isPopular && (
									<div className="absolute -top-2 -right-2 z-10">
										<Badge className="bg-orange-500 text-white text-xs">
											Popular
										</Badge>
									</div>
								)}
								<CardHeader className="pb-3">
									<div className="flex items-center justify-between">
										<div className="p-2 bg-stone-50 rounded-lg group-hover:bg-stone-100 transition-colors">
											<IconComponent className="h-5 w-5 text-stone-600" />
										</div>
										<Badge className={`text-xs`}>{widget.type}</Badge>
									</div>
									<CardTitle className="text-base font-semibold text-stone-900 group-hover:text-stone-600 dark:text-stone-300 group-hover:dark:text-stone-200 transition-colors">
										{widget.title}
									</CardTitle>
								</CardHeader>
								<CardContent className="space-y-4">
									<p className="text-sm text-gray-600 line-clamp-3">
										{widget.description}
									</p>
								</CardContent>
							</Card>
						);
					})}
				</div>
			)}
			<Dialog
				open={!!deleteDialog}
				onClose={() => setDeleteDialog(null)}
				aria-labelledby="delete-widget-dialog-title"
			>
				<DialogTitle id="delete-widget-dialog-title">Delete Widget</DialogTitle>
				<DialogContent>
					<DialogContentText>
						Are you sure you want to delete widget "{deleteDialog?.title}"? This
						action cannot be undone.
					</DialogContentText>
				</DialogContent>
				<DialogActions>
					<Button onClick={() => setDeleteDialog(null)} disabled={deleting}>
						Cancel
					</Button>
					<Button
						onClick={() => handleDelete(deleteDialog!.id)}
						color="error"
						disabled={deleting}
					>
						{deleting ? <CircularProgress size={20} /> : "Delete"}
					</Button>
				</DialogActions>
			</Dialog>
		</div>
	);
};

export default WidgetListPage;
