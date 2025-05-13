import React from "react"
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts"
import type { AreaChartWidget } from "../types"
import { CHART_COLORS } from "../constants"

interface AreaChartProps {
  widget: AreaChartWidget;
  data?: any[];
}

const AreaChartWidgetComponent: React.FC<AreaChartProps> = ({ widget, data }) => {
  return (
    <div className="flex flex-col h-full">
      <div className="text-sm text-muted-foreground mb-2">
        {widget.description}
      </div>
      <div className="flex-grow">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data || []}
            margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey={widget.properties.xAxis} />
            <YAxis />
            <Tooltip
              formatter={(value) => [`${value}`, widget.properties.yAxis]}
            />
            <Area
              type="monotone"
              dataKey={widget.properties.yAxis}
              stroke={
                CHART_COLORS[
                  widget.properties.color as keyof typeof CHART_COLORS
                ]?.[0]
              }
              fill={
                CHART_COLORS[
                  widget.properties.color as keyof typeof CHART_COLORS
                ]?.[0]
              }
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export default AreaChartWidgetComponent;
