"use client";

import { cn } from "@/lib/utils";
import { Check } from "lucide-react";
import { ColorTheme } from "../types";

interface ColorSelectorProps {
  value?: ColorTheme;
  onChange?: (color: ColorTheme) => void;
  className?: string;
}

const SELECTOR_COLORS = [
  { name: "Primary", value: "#F36C06" as ColorTheme },
  { name: "Blue", value: "#0ea5e9" as ColorTheme },
  { name: "Green", value: "#10b981" as ColorTheme },
  { name: "Purple", value: "#8b5cf6" as ColorTheme },
  { name: "Red", value: "#ef4444" as ColorTheme },
  { name: "Yellow", value: "#f59e0b" as ColorTheme },
  { name: "Pink", value: "#ec4899" as ColorTheme },
  { name: "Gray", value: "#6b7280" as ColorTheme },
] as const;

export const ColorSelector: React.FC<ColorSelectorProps> = ({
  value,
  onChange,
  className,
}) => {
  return (
    <div className={cn("grid grid-cols-4 gap-2 p-2", className)}>
      {SELECTOR_COLORS.map((color) => (
        <button
          key={color.value}
          className={cn(
            "h-8 w-8 rounded-full transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-stone-950 focus:ring-offset-2 dark:focus:ring-stone-300",
            "flex items-center justify-center",
            {
              "ring-2 ring-offset-2 ring-stone-950 dark:ring-stone-300": value === color.value,
            }
          )}
          style={{ backgroundColor: color.value }}
          onClick={() => onChange?.(color.value)}
          type="button"
          title={color.name}
        >
          {value === color.value && (
            <Check className="h-4 w-4 text-white" />
          )}
        </button>
      ))}
    </div>
  );
};
