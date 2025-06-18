import type React from "react";
import {
	BarChart,
	Bar,
	XAxis,
	YAxis,
	CartesianGrid,
	ResponsiveContainer,
} from "recharts";
import type { BarChartWidget } from "../types";

interface BarChartProps {
	widget: BarChartWidget;
	data?: any[];
}

const BarChartWidgetComponent: React.FC<BarChartProps> = ({ widget, data }) => {
	return (
		<div className="flex flex-col h-full">
			<ResponsiveContainer width="100%" height="100%">
				<BarChart
					data={data || []}
					margin={{
						top: 20,
						right: 10,
						left: 0,
						bottom: 5,
					}}
				>
					<CartesianGrid strokeDasharray="3 3" />
					<XAxis
						dataKey={widget.properties.xAxis}
						className="text-xs stroke-stone-300"
						stroke="currentColor"
					/>
					<YAxis
						dataKey={widget.properties.yAxis}
						domain={[0, "dataMax + 15"]}
						className="text-xs stroke-stone-300"
						stroke="currentColor"
					/>
					<Bar
						dataKey={widget.properties.yAxis}
						fill={widget.properties.color}
						name={widget.properties.yAxis}
						label={{ position: "top" }}
					/>
				</BarChart>
			</ResponsiveContainer>
		</div>
	);
};

export default BarChartWidgetComponent;
