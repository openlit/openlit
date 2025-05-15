import React from "react";
import type { StatCardWidget } from "../types";

interface StatCardProps {
	widget: StatCardWidget;
	data?: any;
}

const StatCardWidget: React.FC<StatCardProps> = ({ widget, data }) => {
	const value = (widget.properties.value || "")
		.split(".")
		.reduce((acc: any, curr: string) => acc?.[curr], data);
	return (
		<div className="flex flex-col justify-center items-center h-full">
			<div className="text-3xl font-bold">
				{widget.properties.prefix}
				{value}
				{widget.properties.suffix}
			</div>
			{widget.properties.trend && (
				<div
					className={`text-sm mt-2 ${
						widget.properties.trendDirection === "up"
							? "text-green-500"
							: "text-red-500"
					}`}
				>
					{widget.properties.trendDirection === "up" ? "↑" : "↓"}{" "}
					{widget.properties.trend}
				</div>
			)}
			<div className="text-sm text-muted-foreground mt-2">
				{widget.description}
			</div>
		</div>
	);
};

export default StatCardWidget;
