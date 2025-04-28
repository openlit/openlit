import type React from "react"
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts"
import type { PieChartWidget } from "../types"
import { CHART_COLORS } from "../constants"

interface PieChartProps {
  widget: PieChartWidget
  data?: any[]
}

const PieChartWidgetComponent: React.FC<PieChartProps> = ({ widget, data }) => {
  return (
    <div className="flex flex-col h-full">
      <div className="text-sm text-muted-foreground mb-2">{widget.description}</div>
      <div className="flex-grow">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data || []}
              cx="50%"
              cy="50%"
              labelLine={false}
              label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
              outerRadius={80}
              fill="#8884d8"
              dataKey="percent"
            >
              {(data || []).map((entry: any, index: number) => (
                <Cell
                  key={`cell-${index}`}
                  fill={
                   "blue"
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

