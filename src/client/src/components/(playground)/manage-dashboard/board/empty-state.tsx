import { LayoutDashboard } from "lucide-react";
import getMessage from "@/constants/messages";

export default function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-[70vh] text-center px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="p-6 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-700">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <LayoutDashboard className="h-6 w-6 text-primary" />
          </div>
          <h3 className="text-lg font-semibold mb-2 text-stone-900 dark:text-stone-300">
            {getMessage().NO_DASHBOARDS_YET}
          </h3>
          <p className="text-sm text-stone-500 dark:text-stone-400 mb-4">
            {getMessage().NO_DASHBOARDS_YET_DESCRIPTION}
          </p>
        </div>
      </div>
    </div>
  );
} 