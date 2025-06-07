import React from "react";
import {
	AreaChart,
	Area,
	XAxis,
	YAxis,
	CartesianGrid,
	Tooltip,
	ResponsiveContainer,
	Legend,
} from "recharts";
import type { AreaChartWidget } from "../types";

interface AreaChartProps {
	widget: AreaChartWidget;
	data?: any[];
}

const AreaChartWidgetComponent: React.FC<AreaChartProps> = ({
	widget,
	data,
}) => {
	return (
		<div className="flex flex-col h-full">
			<ResponsiveContainer width="100%" height="100%">
				<AreaChart
					data={data || []}
					margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
				>
					<CartesianGrid strokeDasharray="3 3" />
					<XAxis dataKey={widget.properties.xAxis} />
					<YAxis />
					<Tooltip 
						formatter={(value, name) => [`${value}`, name]}
					/>
					{widget.properties.showLegend && <Legend />}
					{widget.properties.yAxes?.map((yAxis, index) => (
						<Area
							key={yAxis.key}
							type="monotone"
							dataKey={yAxis.key}
							name={yAxis.key}
							stackId={widget.properties.stackId}
							stroke={yAxis.color}
							fill={
								yAxis.color
							}
							fillOpacity={0.6}
						/>
					))}
				</AreaChart>
			</ResponsiveContainer>
		</div>
	);
};

export default AreaChartWidgetComponent;
