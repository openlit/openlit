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
					margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
				>
					<CartesianGrid strokeDasharray="3 3" />
					<XAxis dataKey={widget.properties.xAxis} />
					<YAxis />
					<Tooltip
						formatter={(value) => [`${value}`, widget.properties.yAxis]}
					/>
					<Line
						type="monotone"
						dataKey={widget.properties.yAxis}
						stroke={widget.properties.color}
						activeDot={{ r: 8 }}
					/>
				</LineChart>
			</ResponsiveContainer>
		</div>
	);
};

export default LineChartWidgetComponent;
