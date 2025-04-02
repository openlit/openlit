"use client"

import type React from "react"
import { createContext, useContext, useState, type ReactNode } from "react"
import type { WidgetsRecord, DashboardConfig, Widget } from "../types"
import { DEFAULT_LAYOUTS, DEFAULT_WIDGETS } from "../constants"

interface DashboardContextType {
  title: string
  setTitle: (title: string) => void
  layouts: any
  setLayouts: (layouts: any) => void
  widgets: WidgetsRecord
  setWidgets: (widgets: WidgetsRecord) => void
  editingWidget: string | null
  setEditingWidget: (id: string | null) => void
  isEditing: boolean
  setIsEditing: (editing: boolean) => void
  updateWidget: (widgetId: string, updates: Partial<Widget>) => void
  updateWidgetProperties: (widgetId: string, properties: Record<string, any>) => void
  addWidget: () => string
  removeWidget: (widgetId: string) => void
  getDashboardConfig: () => DashboardConfig
}

export const DashboardContext = createContext<DashboardContextType | undefined>(undefined)

interface DashboardProviderProps {
  children: ReactNode
  initialConfig?: DashboardConfig
  onSave?: (config: DashboardConfig) => void
}

export const DashboardProvider: React.FC<DashboardProviderProps> = ({ children, initialConfig, onSave }) => {
  const [title, setTitle] = useState(initialConfig?.title || "Customizable Dashboard")
  const [layouts, setLayouts] = useState(initialConfig?.layouts || DEFAULT_LAYOUTS)
  const [widgets, setWidgets] = useState<WidgetsRecord>(initialConfig?.widgets || DEFAULT_WIDGETS)
  const [editingWidget, setEditingWidget] = useState<string | null>(null)
  const [isEditing, setIsEditing] = useState(false)

  // Update a widget
  const updateWidget = (widgetId: string, updates: Partial<Widget>) => {
    setWidgets((prev) => ({
      ...prev,
      [widgetId]: {
        ...prev[widgetId],
        ...updates,
      } as Widget,
    }))
  }

  // Update widget properties
  const updateWidgetProperties = (widgetId: string, properties: Record<string, any>) => {
    setWidgets((prev) => ({
      ...prev,
      [widgetId]: {
        ...prev[widgetId],
        properties: {
          ...prev[widgetId].properties,
          ...properties,
        },
      } as Widget,
    }))
  }

  // Add a new widget
  const addWidget = () => {
    const newWidgetId = `widget-${Object.keys(widgets).length + 1}-${Date.now()}`

    // Add to layouts
    setLayouts((prev: any) => {
      return {
        ...prev,
        lg: [...prev.lg, { i: newWidgetId, x: 0, y: Number.POSITIVE_INFINITY, w: 2, h: 2 }],
      }
    })

    // Add widget data with defaults
    setWidgets((prev) => ({
      ...prev,
      [newWidgetId]: {
        id: newWidgetId,
        title: "New Widget",
        type: "stat_card",
        query: "",
        description: "",
        value: "0",
        properties: {
          prefix: "",
          suffix: "",
          color: "blue",
        },
      } as Widget,
    }))

    return newWidgetId
  }

  // Remove a widget
  const removeWidget = (widgetId: string) => {
    // Remove from layouts
    setLayouts((prev: any) => {
      return {
        ...prev,
        lg: prev.lg.filter((item: any) => item.i !== widgetId),
      }
    })

    // Remove widget data
    setWidgets((prev) => {
      const newWidgets = { ...prev }
      delete newWidgets[widgetId]
      return newWidgets
    })
  }

  // Get the current dashboard configuration
  const getDashboardConfig = (): DashboardConfig => {
    return {
      title,
      layouts,
      widgets,
    }
  }

  const contextValue: DashboardContextType = {
    title,
    setTitle,
    layouts,
    setLayouts,
    widgets,
    setWidgets,
    editingWidget,
    setEditingWidget,
    isEditing,
    setIsEditing,
    updateWidget,
    updateWidgetProperties,
    addWidget,
    removeWidget,
    getDashboardConfig,
  }

  return <DashboardContext.Provider value={contextValue}>{children}</DashboardContext.Provider>
}

export const useDashboard = () => {
  const context = useContext(DashboardContext)
  if (!context) {
    throw new Error("useDashboard must be used within a DashboardProvider")
  }
  return context
}

