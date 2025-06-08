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
	// Calculate max Y value across all Y axes
	const yMaxValue = data?.length
		? Math.max(...data.flatMap(item => 
			widget.properties.yAxes?.map(axis => Number(item[axis.key])) || []
		))
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
				<AreaChart
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
						domain={[0, yMaxValue]}
						allowDataOverflow={false}
						tick={{ fill: 'currentColor' }}
					/>
					<Tooltip 
						formatter={(value, name) => [`${value}`, name]}
						contentStyle={{
							backgroundColor: 'var(--background)',
							border: '1px solid var(--border)',
							color: 'var(--foreground)'
						}}
						labelStyle={{
							color: 'var(--foreground)'
						}}
					/>
					{widget.properties.showLegend && 
						<Legend 
							wrapperStyle={{
								color: 'var(--foreground)'
							}}
						/>
					}
					{widget.properties.yAxes?.map((yAxis, index) => (
						<Area
							key={yAxis.key}
							type="monotone"
							dataKey={yAxis.key}
							name={yAxis.key}
							stackId={widget.properties.stackId}
							stroke={yAxis.color}
							fill={yAxis.color}
							fillOpacity={0.6}
						/>
					))}
				</AreaChart>
			</ResponsiveContainer>
		</div>
	);
};

export default AreaChartWidgetComponent;
