"use client"

import type React from "react"
import { Edit, Trash } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { WidgetType } from "../types"
import { WIDGET_TYPE_ICONS } from "../constants"
import type { WidgetRendererProps } from "../types"
import StatCardWidget from "./StatCardWidget"
import BarChartWidget from "./BarChartWidget"
import LineChartWidget from "./LineChartWidget"
import PieChartWidget from "./PieChartWidget"
import TableWidget from "./TableWidget"

const WidgetRenderer: React.FC<WidgetRendererProps> = ({ widget, isEditing, onEdit, onRemove }) => {
  // Get widget type icon
  const WidgetTypeIcon = () => {
    const IconComponent = WIDGET_TYPE_ICONS[widget.type as keyof typeof WIDGET_TYPE_ICONS]
    return <IconComponent className="h-4 w-4" />
  }

  // Render widget content based on type
  const renderWidgetContent = () => {
    switch (widget.type) {
      case WidgetType.STAT_CARD:
        return <StatCardWidget widget={widget} />
      case WidgetType.BAR_CHART:
        return <BarChartWidget widget={widget} />
      case WidgetType.LINE_CHART:
        return <LineChartWidget widget={widget} />
      case WidgetType.PIE_CHART:
        return <PieChartWidget widget={widget} />
      case WidgetType.TABLE:
        return <TableWidget widget={widget} />
      default:
        return <div>Unknown widget type</div>
    }
  }

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-2">
          <WidgetTypeIcon />
          <CardTitle className="text-lg">{widget.title}</CardTitle>
        </div>
        {isEditing && (
          <div
            className="flex gap-1 z-10"
            // This makes the div and its children non-draggable
            onMouseDown={(e) => {
              e.stopPropagation()
            }}
            onTouchStart={(e) => {
              e.stopPropagation()
            }}
          >
            <div className="cursor-pointer p-1 rounded-md hover:bg-muted" onClick={() => onEdit(widget.id)}>
              <Edit className="h-4 w-4" />
            </div>
            <div className="cursor-pointer p-1 rounded-md hover:bg-muted" onClick={() => onRemove(widget.id)}>
              <Trash className="h-4 w-4" />
            </div>
          </div>
        )}
      </CardHeader>
      <CardContent className="flex-grow overflow-auto">{renderWidgetContent()}</CardContent>
    </Card>
  )
}

export default WidgetRenderer

