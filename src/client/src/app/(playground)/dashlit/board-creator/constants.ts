import { WidgetsRecord, WidgetType, type ColorTheme } from "./types"
import { Activity, BarChart3, LineChart, PieChart, Database, AreaChart } from "lucide-react"

// Widget type icons mapping
export const WIDGET_TYPE_ICONS = {
  [WidgetType.STAT_CARD]: Activity,
  [WidgetType.BAR_CHART]: BarChart3,
  [WidgetType.LINE_CHART]: LineChart,
  [WidgetType.PIE_CHART]: PieChart,
  [WidgetType.TABLE]: Database,
  [WidgetType.AREA_CHART]: AreaChart,
}

// Color palette for charts
export const CHART_COLORS: Record<ColorTheme, string[]> = {
  blue: ["#0ea5e9", "#38bdf8", "#7dd3fc", "#bae6fd"],
  green: ["#10b981", "#34d399", "#6ee7b7", "#a7f3d0"],
  red: ["#ef4444", "#f87171", "#fca5a5", "#fecaca"],
  purple: ["#8b5cf6", "#a78bfa", "#c4b5fd", "#ddd6fe"],
  orange: ["#f97316", "#fb923c", "#fdba74", "#fed7aa"],
}

// Default initial layouts
// export const DEFAULT_LAYOUTS = {
//   lg: [
//     { i: "widget-1", x: 0, y: 0, w: 2, h: 2 },
//     { i: "widget-2", x: 2, y: 0, w: 2, h: 2 },
//     { i: "widget-3", x: 0, y: 2, w: 4, h: 2 },
//     { i: "widget-4", x: 0, y: 4, w: 2, h: 2 },
//     { i: "widget-5", x: 2, y: 4, w: 2, h: 2 },
//   ],
// }

// Default initial widgets
// export const DEFAULT_WIDGETS: WidgetsRecord = {
//   "widget-1": {
//     id: "widget-1",
//     title: "Total Users",
//     type: WidgetType.STAT_CARD,
//     config: { query: "SELECT count() FROM users" },
//     description: "Shows the total number of users in the system",
//     value: "1,234",
//     properties: {
//       prefix: "",
//       suffix: "",
//       color: "blue",
//       trend: "+12%",
//       trendDirection: "up",
//     },
//   },
//   "widget-2": {
//     id: "widget-2",
//     title: "Revenue by Month",
//     type: WidgetType.BAR_CHART,
//     config: { query: "SELECT toMonth(date) as month, sum(amount) as revenue\nFROM orders\nGROUP BY month\nORDER BY month" },
//     description: "Monthly revenue breakdown",
//     data: [
//       { month: "Jan", revenue: 12000 },
//       { month: "Feb", revenue: 15000 },
//       { month: "Mar", revenue: 18000 },
//       { month: "Apr", revenue: 16000 },
//       { month: "May", revenue: 21000 },
//       { month: "Jun", revenue: 19000 },
//     ],
//     properties: {
//       xAxis: "month",
//       yAxis: "revenue",
//       color: "green",
//     },
//   },
//   "widget-3": {
//     id: "widget-3",
//     title: "Active Users",
//     type: WidgetType.LINE_CHART,
//     config: { query: "SELECT date, count() as active_users\nFROM user_sessions\nGROUP BY date\nORDER BY date" },
//     description: "Daily active users over time",
//     data: [
//       { date: "2023-01-01", active_users: 500 },
//       { date: "2023-01-02", active_users: 520 },
//       { date: "2023-01-03", active_users: 580 },
//       { date: "2023-01-04", active_users: 620 },
//       { date: "2023-01-05", active_users: 670 },
//       { date: "2023-01-06", active_users: 650 },
//       { date: "2023-01-07", active_users: 700 },
//     ],
//     properties: {
//       xAxis: "date",
//       yAxis: "active_users",
//       color: "purple",
//     },
//   },
//   "widget-4": {
//     id: "widget-4",
//     title: "User Distribution",
//     type: WidgetType.PIE_CHART,
//     config: { query: "SELECT user_type, count() as count\nFROM users\nGROUP BY user_type" },
//     description: "Distribution of users by type",
//     data: [
//       { name: "Free", value: 800 },
//       { name: "Basic", value: 300 },
//       { name: "Premium", value: 100 },
//       { name: "Enterprise", value: 50 },
//     ],
//     properties: {
//       color: "blue",
//     },
//   },
//   "widget-5": {
//     id: "widget-5",
//     title: "Recent Orders",
//     type: WidgetType.TABLE,
//     config: { query: "SELECT id, customer_name, amount, status, order_date\nFROM orders\nORDER BY order_date DESC\nLIMIT 5" },
//     description: "Most recent customer orders",
//     data: [
//       { id: "ORD-001", customer_name: "John Doe", amount: 125.99, status: "Completed", order_date: "2023-01-07" },
//       { id: "ORD-002", customer_name: "Jane Smith", amount: 89.5, status: "Processing", order_date: "2023-01-06" },
//       { id: "ORD-003", customer_name: "Bob Johnson", amount: 245.0, status: "Completed", order_date: "2023-01-05" },
//       { id: "ORD-004", customer_name: "Alice Brown", amount: 32.75, status: "Shipped", order_date: "2023-01-04" },
//       {
//         id: "ORD-005",
//         customer_name: "Charlie Wilson",
//         amount: 178.25,
//         status: "Processing",
//         order_date: "2023-01-03",
//       },
//     ],
//     properties: {
//       color: "orange",
//     },
//   },
// }

// ClickHouse SQL language configuration for Monaco Editor
export const CLICKHOUSE_LANGUAGE_CONFIG = {
  id: "clickhouse-sql",
  extensions: [".sql"],
  aliases: ["ClickHouse SQL", "clickhouse-sql"],
  mimetypes: ["application/sql"],
  loader: () => ({
    language: {
      defaultToken: "",
      tokenPostfix: ".sql",
      ignoreCase: true,
      brackets: [
        { open: "[", close: "]", token: "delimiter.square" },
        { open: "(", close: ")", token: "delimiter.parenthesis" },
      ],
      keywords: [
        "SELECT",
        "FROM",
        "WHERE",
        "AND",
        "OR",
        "GROUP",
        "BY",
        "ORDER",
        "HAVING",
        "LIMIT",
        "OFFSET",
        "INSERT",
        "INTO",
        "VALUES",
        "UPDATE",
        "DELETE",
        "SET",
        // ... (truncated for brevity)
      ],
      operators: [
        "+",
        "-",
        "*",
        "/",
        "%",
        "=",
        ">",
        "<",
        ">=",
        "<=",
        "<>",
        "!=",
        "<=>",
        "AND",
        "OR",
        "NOT",
        "LIKE",
        "IN",
        "IS",
        "BETWEEN",
        "REGEXP",
      ],
      builtinFunctions: [
        "count",
        "sum",
        "min",
        "max",
        "avg",
        "any",
        "anyHeavy",
        "anyLast",
        // ... (truncated for brevity)
      ],
      builtinVariables: ["database", "table", "default_kind"],
      pseudoColumns: [],
      tokenizer: {
        root: [
          { include: "@comments" },
          { include: "@whitespace" },
          { include: "@numbers" },
          { include: "@strings" },
          { include: "@complexIdentifiers" },
          { include: "@scopes" },
          [/[;,.]/, "delimiter"],
          [/[()]/, "@brackets"],
          [
            /[\w@#$]+/,
            {
              cases: {
                "@keywords": "keyword",
                "@operators": "operator",
                "@builtinFunctions": "predefined",
                "@builtinVariables": "predefined",
                "@default": "identifier",
              },
            },
          ],
          [/[<>=!%&+\-*/|~^]/, "operator"],
        ],
        whitespace: [[/\s+/, "white"]],
        comments: [
          [/--+.*/, "comment"],
          [/\/\*/, { token: "comment.quote", next: "@comment" }],
        ],
        comment: [
          [/[^*/]+/, "comment"],
          [/\*\//, { token: "comment.quote", next: "@pop" }],
          [/./, "comment"],
        ],
        numbers: [
          [/0[xX][0-9a-fA-F]*/, "number"],
          [/[$][+-]*\d*(\.\d*)?/, "number"],
          [/((\d+(\.\d*)?)|(\.\d+))([eE][-+]?\d+)?/, "number"],
        ],
        strings: [
          [/'/, { token: "string", next: "@string" }],
          [/"/, { token: "string.double", next: "@stringDouble" }],
        ],
        string: [
          [/[^']+/, "string"],
          [/''/, "string"],
          [/'/, { token: "string", next: "@pop" }],
        ],
        stringDouble: [
          [/[^"]+/, "string.double"],
          [/""/, "string.double"],
          [/"/, { token: "string.double", next: "@pop" }],
        ],
        complexIdentifiers: [[/`/, { token: "identifier.quote", next: "@quotedIdentifier" }]],
        quotedIdentifier: [
          [/[^`]+/, "identifier"],
          [/``/, "identifier"],
          [/`/, { token: "identifier.quote", next: "@pop" }],
        ],
        scopes: [],
      },
    },
  }),
}

