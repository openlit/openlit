import type React from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import type { PieChartWidget } from "../types";
import { CHART_COLORS } from "../constants";

interface PieChartProps {
	widget: PieChartWidget;
	data?: any[];
}

const PieChartWidgetComponent: React.FC<PieChartProps> = ({ widget, data }) => {
	const { labelPath, valuePath } = widget.properties;
	return (
		<div className="flex flex-col h-full">
			<ResponsiveContainer width="100%" height="100%">
				<PieChart>
					<Pie
						data={data || []}
						cx="50%"
						cy="50%"
						outerRadius={80}
						fill="#8884d8"
						nameKey={labelPath}
						dataKey={valuePath}
					>
						{(data || []).map((entry: any, index: number) => (
							<Cell
								key={`cell-${index}`}
								fill={
									CHART_COLORS[widget.properties.color]?.[
										index % CHART_COLORS[widget.properties.color]?.length
									] ?? "blue"
								}
							/>
						))}
					</Pie>
					<Tooltip formatter={(value, name) => [`${value}`, name]} />
				</PieChart>
			</ResponsiveContainer>
		</div>
	);
};

export default PieChartWidgetComponent;
