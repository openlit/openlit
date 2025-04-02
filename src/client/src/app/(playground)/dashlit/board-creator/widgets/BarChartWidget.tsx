import type React from "react"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts"
import type { BarChartWidget } from "../types"
import { CHART_COLORS } from "../constants"

interface BarChartProps {
  widget: BarChartWidget
}

const BarChartWidgetComponent: React.FC<BarChartProps> = ({ widget }) => {
  return (
    <div className="flex flex-col h-full">
      <div className="text-sm text-muted-foreground mb-2">{widget.description}</div>
      <div className="flex-grow">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={widget.data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey={widget.properties.xAxis} />
            <YAxis />
            <Tooltip formatter={(value) => [`${value}`, widget.properties.yAxis]} />
            <Bar
              dataKey={widget.properties.yAxis}
              fill={CHART_COLORS[widget.properties.color as keyof typeof CHART_COLORS][0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export default BarChartWidgetComponent

