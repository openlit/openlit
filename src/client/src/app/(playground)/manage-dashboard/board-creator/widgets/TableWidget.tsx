import type React from "react";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import type { TableWidget } from "../types";

interface TableWidgetProps {
	widget: TableWidget;
	data?: any[];
}

const TableWidgetComponent: React.FC<TableWidgetProps> = ({ widget, data }) => {
	if (!data || data.length === 0) {
		return (
			<div className="flex justify-center items-center h-full text-muted-foreground">
				No data available
			</div>
		);
	}

	const columns = Object.keys(data[0]).map((key) => ({
		header: key.charAt(0).toUpperCase() + key.slice(1),
		cell: (row: any) => row[key],
		className: "border-r last:border-r-0",
	}));

	return (
		<div className="flex flex-col h-full overflow-auto border rounded-lg">
			<Table>
				<TableHeader className="sticky top-0 z-10 bg-background">
					<TableRow className="border-b hover:bg-transparent">
						{columns.map((column, index) => (
							<TableHead
								key={index}
								className="bg-slate-100 dark:bg-slate-800 py-4 font-semibold text-slate-900 dark:text-slate-100 border-r last:border-r-0"
							>
								{column.header}
							</TableHead>
						))}
					</TableRow>
				</TableHeader>
				<TableBody>
					{data.length === 0 ? (
						<TableRow>
							<TableCell colSpan={columns.length} className="h-24 text-center">
								No results.
							</TableCell>
						</TableRow>
					) : (
						data.map((row, rowIndex) => (
							<TableRow 
								key={rowIndex} 
								className="border-b last:border-b-0 hover:bg-slate-50/50 dark:hover:bg-slate-800/50"
							>
								{columns.map((column, colIndex) => {
									return (
										<TableCell
											key={`${rowIndex}-${colIndex}`}
											className="border-r last:border-r-0"
										>
											{column.cell(row)}
										</TableCell>
									);
								})}
							</TableRow>
						))
					)}
				</TableBody>
			</Table>
		</div>
	);
};

export default TableWidgetComponent;
