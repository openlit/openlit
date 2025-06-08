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
	const yMaxValue = data?.length 
		? Math.max(...data.map(item => Number(item[widget.properties.yAxis])))
		: 0;

	// Check if x-axis values are numbers and calculate domain if they are
	const isXAxisNumeric = data?.length && !isNaN(Number(data[0]?.[widget.properties.xAxis]));
	const xMaxValue = isXAxisNumeric && data?.length
		? Math.max(...data.map(item => Number(item[widget.properties.xAxis])))
		: undefined;
	const xMinValue = isXAxisNumeric && data?.length
		? Math.min(...data.map(item => Number(item[widget.properties.xAxis])))
		: undefined;

	return (
		<div className="flex flex-col h-full">
			<ResponsiveContainer width="100%" height="100%">
				<LineChart
					data={data || []}
					margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
				>
					<CartesianGrid strokeDasharray="3 3" />
					<XAxis 
						dataKey={widget.properties.xAxis}
						domain={isXAxisNumeric ? [xMinValue || 0, xMaxValue || 0] : undefined}
						tick={{ fill: 'currentColor' }}
					/>
					<YAxis 
						dataKey={widget.properties.yAxis}
						domain={[0, yMaxValue]}
						allowDataOverflow={false}
						tick={{ fill: 'currentColor' }}
					/>
					<Tooltip
						formatter={(value) => [`${value}`, widget.properties.yAxis]}
						contentStyle={{
							backgroundColor: 'var(--background)',
							border: '1px solid var(--border)',
							color: 'var(--foreground)'
						}}
						labelStyle={{
							color: 'var(--foreground)'
						}}
					/>
					<Line
						type="monotone"
						dataKey={widget.properties.yAxis}
						stroke={widget.properties.color}
						activeDot={{ r: 8 }}
						name={widget.properties.yAxis}
					/>
				</LineChart>
			</ResponsiveContainer>
		</div>
	);
};

export default LineChartWidgetComponent;
