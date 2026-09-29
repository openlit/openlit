import React from "react";
import type { StatCardWidget } from "../types";
import { TrendingDown } from "lucide-react";
import { TrendingUp } from "lucide-react";
import { isNil } from "lodash";
import { formatCompactNumber } from "../utils/formatters";

interface StatCardProps {
	widget: StatCardWidget;
	data?: any;
}

const StatCardWidget: React.FC<StatCardProps> = ({ widget, data }) => {
	let value: unknown = "";
	let trend: number = 0;

	try {
		value = (widget.properties.value || "")
			.split(".")
			.reduce((acc: any, curr: string) => acc?.[curr], data);
		value = value || 0;
		trend = (widget.properties.trend || "")
			.split(".")
			.reduce((acc: any, curr: string) => acc?.[curr], data);
		trend = isNil(trend) ? trend : parseFloat(trend?.toString() || "0");
	} catch (error) {
		console.error(error);
	}
	const displayValue = formatCompactNumber(value);
	const fullValue = `${widget.properties.prefix}${String(value)}${widget.properties.suffix}`;

	return (
		<div className="flex min-w-0 flex-col justify-center items-center h-full overflow-hidden px-2">
			<div
				className="max-w-full truncate text-center text-3xl font-bold leading-tight"
				style={{ color: widget.properties.color }}
				title={fullValue}
			>
				{widget.properties.prefix}
				{displayValue}
				{widget.properties.suffix}
			</div>
			{!isNil(trend) && (
				<div
					className={`flex items-center gap-1 text-sm mt-2 ${trend > 0
						? "text-green-500"
						: "text-red-500"
						}`}
				>
					{widget.properties.trendPrefix}
					{formatCompactNumber(Math.abs(trend))}
					{widget.properties.trendSuffix}
					{trend > 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
				</div>
			)}
		</div>
	);
};

export default StatCardWidget;
