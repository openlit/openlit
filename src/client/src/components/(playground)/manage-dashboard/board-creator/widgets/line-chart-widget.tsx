import type React from "react";
import {
	LineChart,
	Line,
	XAxis,
	YAxis,
	CartesianGrid,
	Tooltip,
	ResponsiveContainer,
} from "recharts";
import type { LineChartWidget } from "../types";

interface LineChartProps {
	widget: LineChartWidget;
	data?: any[];
}

const LineChartWidgetComponent: React.FC<LineChartProps> = ({
	widget,
	data,
}) => {

	return (
		<div className="flex flex-col h-full">
			<ResponsiveContainer width="100%" height="100%">
				<LineChart
					data={data || []}
					margin={{
						top: 5,
						right: 30,
						left: 20,
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
						className="text-xs stroke-stone-300"
						stroke="currentColor"
						domain={[0, "dataMax + 15"]}
					/>
					<Tooltip labelClassName="dark:text-stone-700" />
					<Line
						type="monotone"
						dataKey={widget.properties.yAxis}
						stroke={widget.properties.color}
						activeDot={{ r: 4 }}
					/>
				</LineChart>
			</ResponsiveContainer>
		</div>
	);
};

export default LineChartWidgetComponent;
