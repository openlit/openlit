import { Info } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipPortal, TooltipContent } from "@/components/ui/tooltip";

export default function DescriptionTooltip({ description, className }: { description: string, className?: string }) {
	return (
		<Tooltip delayDuration={0}>
			<TooltipTrigger asChild>
				<Info className={`h-3 w-3 cursor-pointer ${className}`} />
			</TooltipTrigger>
			<TooltipPortal>
				<TooltipContent>{description}</TooltipContent>
			</TooltipPortal>
		</Tooltip>
	);
};