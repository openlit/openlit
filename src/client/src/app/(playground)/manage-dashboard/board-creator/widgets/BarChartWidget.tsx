import type React from "react";
import {
	BarChart,
	Bar,
	XAxis,
	YAxis,
	CartesianGrid,
	Tooltip,
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
					margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
				>
					<CartesianGrid strokeDasharray="3 3" />
					<YAxis dataKey={widget.properties.yAxis} />
					<XAxis dataKey={widget.properties.xAxis} />

					<Tooltip
						formatter={(value) => [`${value}`, widget.properties.yAxis]}
					/>
					<Bar dataKey={widget.properties.yAxis} fill={widget.properties.color} />
				</BarChart>
			</ResponsiveContainer>
		</div>
	);
};

export default BarChartWidgetComponent;
