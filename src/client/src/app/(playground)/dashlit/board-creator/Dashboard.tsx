"use client"

import type React from "react"
import { Responsive, WidthProvider } from "react-grid-layout"
import "react-grid-layout/css/styles.css"
import "react-resizable/css/styles.css"
import { Edit, Save, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { DashboardProps } from "./types"
import { DashboardProvider, useDashboard } from "./context/DashboardContext"
import WidgetRenderer from "./widgets/WidgetRenderer"
import EditWidgetSheet from "./components/EditWidgetSheet"
import { useEditWidget } from "./hooks/useEditWidget"

// Responsive grid layout with automatic width calculation
const ResponsiveGridLayout = WidthProvider(Responsive)

const DashboardContent: React.FC<Omit<DashboardProps, "initialConfig">> = ({
  onSave,
  readonly = false,
  className,
  editorLanguage = "clickhouse-sql",
  breakpoints = { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 },
  cols = { lg: 4, md: 4, sm: 2, xs: 1, xxs: 1 },
  rowHeight = 150,
}) => {
  const { title, layouts, setLayouts, widgets, isEditing, setIsEditing, getDashboardConfig, addWidget } = useDashboard()

  const { openEditSheet } = useEditWidget()

  // Handle layout changes
  const handleLayoutChange = (layout: any, layouts: any) => {
    setLayouts(layouts)
  }

  // Handle save
  const handleSave = () => {
    if (onSave) {
      onSave(getDashboardConfig())
    }
    setIsEditing(false)
  }

  return (
    <div className={`p-4 container mx-auto ${className}`}>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">{title}</h1>

        {!readonly && (
          <div className="flex gap-2">
            <Button
              variant={isEditing ? "default" : "outline"}
              onClick={() => (isEditing ? handleSave() : setIsEditing(true))}
            >
              {isEditing ? (
                <>
                  <Save className="h-4 w-4 mr-2" /> Save Layout
                </>
              ) : (
                <>
                  <Edit className="h-4 w-4 mr-2" /> Edit Layout
                </>
              )}
            </Button>
            {isEditing && (
              <Button onClick={addWidget}>
                <Plus className="h-4 w-4 mr-2" /> Add Widget
              </Button>
            )}
          </div>
        )}
      </div>

      <ResponsiveGridLayout
        className="layout"
        layouts={layouts}
        breakpoints={breakpoints}
        cols={cols}
        rowHeight={rowHeight}
        onLayoutChange={handleLayoutChange}
        isDraggable={isEditing && !readonly}
        isResizable={isEditing && !readonly}
        margin={[16, 16]}
      >
        {layouts.lg.map((item) => {
          const widget = widgets[item.i]
          if (!widget) return null

          return (
            <div key={item.i} className="bg-background">
              <WidgetRenderer
                widget={widget}
                isEditing={isEditing && !readonly}
                onEdit={openEditSheet}
                onRemove={(widgetId) => {
                  // Implementation of removeWidget is in the DashboardContext
                }}
              />
            </div>
          )
        })}
      </ResponsiveGridLayout>

      <EditWidgetSheet editorLanguage={editorLanguage} />
    </div>
  )
}

// Main Dashboard component with provider
const Dashboard: React.FC<DashboardProps> = ({ initialConfig, ...props }) => {
  return (
    <DashboardProvider initialConfig={initialConfig} onSave={props.onSave}>
      <DashboardContent {...props} />
    </DashboardProvider>
  )
}

export default Dashboard

