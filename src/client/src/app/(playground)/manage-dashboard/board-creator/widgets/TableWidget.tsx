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
		className: "border-r last:border-r-0 bg-muted/50 font-medium",
	}));

	return (
		<div className="flex flex-col h-full">
			<Table>
				<TableHeader className="sticky top-0 z-10 bg-background">
					<TableRow className="border-b">
						{columns.map((column, index) => (
							<TableHead
								key={index}
								className={`border-r last:border-r-0 bg-muted/50 font-medium ${
									column.className || ""
								}`}
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
							<TableRow key={rowIndex} className="border-b last:border-b-0">
								{columns.map((column, colIndex) => {
									return (
										<TableCell
											key={`${rowIndex}-${colIndex}`}
											className={`border-r last:border-r-0 ${
												column.className || ""
											}`}
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
