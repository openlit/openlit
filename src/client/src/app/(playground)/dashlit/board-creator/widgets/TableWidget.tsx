import type React from "react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { TableWidget } from "../types"
import { formatCurrency } from "../utils/formatters"

interface TableWidgetProps {
  widget: TableWidget
}

const TableWidgetComponent: React.FC<TableWidgetProps> = ({ widget }) => {
  return (
    <div className="flex flex-col h-full">
      <div className="text-sm text-muted-foreground mb-2">{widget.description}</div>
      <div className="flex-grow overflow-auto">
        <Table>
          <TableHeader>
            {widget.data && widget.data.length > 0 && (
              <TableRow>
                {Object.keys(widget.data[0]).map((key) => (
                  <TableHead key={key} className="text-xs">
                    {key.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}
                  </TableHead>
                ))}
              </TableRow>
            )}
          </TableHeader>
          <TableBody>
            {widget.data &&
              widget.data.map((row, rowIndex) => (
                <TableRow key={rowIndex}>
                  {Object.entries(row).map(([key, value], cellIndex) => (
                    <TableCell key={`${rowIndex}-${cellIndex}`} className="text-xs py-2">
                      {key === "amount" ? formatCurrency(value as number) : (value as React.ReactNode)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

export default TableWidgetComponent

