import type React from "react"
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts"
import type { PieChartWidget } from "../types"
import { CHART_COLORS } from "../constants"

interface PieChartProps {
  widget: PieChartWidget
}

const PieChartWidgetComponent: React.FC<PieChartProps> = ({ widget }) => {
  return (
    <div className="flex flex-col h-full">
      <div className="text-sm text-muted-foreground mb-2">{widget.description}</div>
      <div className="flex-grow">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={widget.data}
              cx="50%"
              cy="50%"
              labelLine={false}
              label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
              outerRadius={80}
              fill="#8884d8"
              dataKey="value"
            >
              {widget.data.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={
                    CHART_COLORS[widget.properties.color as keyof typeof CHART_COLORS][
                      index % CHART_COLORS[widget.properties.color as keyof typeof CHART_COLORS].length
                    ]
                  }
                />
              ))}
            </Pie>
            <Tooltip formatter={(value) => [`${value}`, "Count"]} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export default PieChartWidgetComponent

