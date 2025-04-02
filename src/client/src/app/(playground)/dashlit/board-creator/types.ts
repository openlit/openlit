import type { ReactNode } from "react"
import type { Layouts } from "react-grid-layout"

// Widget Types
export enum WidgetType {
  STAT_CARD = "stat_card",
  BAR_CHART = "bar_chart",
  LINE_CHART = "line_chart",
  PIE_CHART = "pie_chart",
  TABLE = "table",
}

// Color Themes
export type ColorTheme = "blue" | "green" | "red" | "purple" | "orange"

// Base Widget Interface
export interface BaseWidgetProps {
  id: string
  title: string
  type: WidgetType
  description?: string
  query?: string
  properties: Record<string, any>
}

// Specific Widget Interfaces
export interface StatCardWidget extends BaseWidgetProps {
  type: WidgetType.STAT_CARD
  value: string
  properties: {
    prefix?: string
    suffix?: string
    color: ColorTheme
    trend?: string
    trendDirection?: "up" | "down"
    textSize?: "small" | "medium" | "large"
    autoRefresh?: boolean
  }
}

export interface ChartWidget extends BaseWidgetProps {
  data: any[]
  properties: {
    color: ColorTheme
    showLegend?: boolean
    autoRefresh?: boolean
  }
}

export interface BarChartWidget extends ChartWidget {
  type: WidgetType.BAR_CHART
  properties: ChartWidget["properties"] & {
    xAxis: string
    yAxis: string
  }
}

export interface LineChartWidget extends ChartWidget {
  type: WidgetType.LINE_CHART
  properties: ChartWidget["properties"] & {
    xAxis: string
    yAxis: string
  }
}

export interface PieChartWidget extends ChartWidget {
  type: WidgetType.PIE_CHART
}

export interface TableWidget extends BaseWidgetProps {
  type: WidgetType.TABLE
  data: any[]
  properties: {
    color: ColorTheme
    autoRefresh?: boolean
  }
}

// Combined Widget Type
export type Widget = StatCardWidget | BarChartWidget | LineChartWidget | PieChartWidget | TableWidget

// Widgets Record - maps widget IDs to widget objects
export type WidgetsRecord = Record<string, Widget>

// Dashboard Configuration
export interface DashboardConfig {
  title: string
  layouts: Layouts
  widgets: WidgetsRecord
}

// Dashboard Props
export interface DashboardProps {
  initialConfig?: DashboardConfig
  onSave?: (config: DashboardConfig) => void
  readonly?: boolean
  className?: string
  renderCustomWidget?: (widget: Widget) => ReactNode
  dataProviders?: Record<string, (query: string) => Promise<any>>
  editorLanguage?: string
  customTheme?: any
  breakpoints?: { [key: string]: number }
  cols?: { [key: string]: number }
  rowHeight?: number
}

// Widget Renderer Props
export interface WidgetRendererProps {
  widget: Widget
  isEditing: boolean
  onEdit: (widgetId: string) => void
  onRemove: (widgetId: string) => void
}

// Editor Props
export interface EditorProps {
  value: string
  onChange: (value: string | undefined) => void
  language?: string
  height?: string
  fullScreen?: boolean
}

