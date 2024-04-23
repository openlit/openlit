import { useRequest } from "@/app/(playground)/requests/request-context";
import Image from "next/image";
import { round } from "lodash";
import { format } from "date-fns";
import { normalizeTrace } from "@/helpers/trace";
import { TransformedTraceRow } from "@/constants/traces";
import {
	AudioLines,
	Boxes,
	Braces,
	CalendarDays,
	CircleDollarSign,
	ClipboardType,
	Clock,
	Container,
	ExternalLink,
	Image as ImageIcon,
	LucideIcon,
	PyramidIcon,
	TicketPlus,
} from "lucide-react";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";

const TagItem = ({
	icon: IconComponent,
	title,
	value,
}: {
	icon?: LucideIcon;
	title: string;
	value: any;
}) => (
	<div className="flex items-center justify-center space-x-1 px-3 py-1 rounded-full text-xs bg-primary text-white font-medium">
		{IconComponent && <IconComponent className="h-3" />}
		<span>{title}</span>
		<span>{value}</span>
	</div>
);

export default function RequestDetails() {
	const [request, updateRequest] = useRequest();

	const onClose = (open: boolean) => {
		if (!open) updateRequest(null);
	};

	if (!request) return null;

	const normalizedItem: TransformedTraceRow = normalizeTrace(request);

	return (
		<Sheet open onOpenChange={onClose}>
			<SheetContent className="max-w-none sm:max-w-none w-1/2 bg-stone-200 dark:bg-stone-200">
				<SheetHeader>
					<SheetTitle>
						<div className="flex flex-col text-stone-800">
							<div className="flex items-center text-2xl font-bold leading-7">
								<p className="capitalize">{normalizedItem.applicationName}</p>
							</div>
							<div className="flex items-center mt-3">
								<PyramidIcon size="12" />
								<p className="ml-3 text-sm leading-none">
									{normalizedItem.provider}
								</p>
							</div>
						</div>
					</SheetTitle>
				</SheetHeader>
				<SheetDescription>
					<div className="flex h-full w-full flex-col overflow-y-scroll">
						<div className="relative py-6 flex-1 flex flex-col gap-3">
							<div className="flex items-start flex-wrap gap-3">
								<TagItem
									icon={CalendarDays}
									title="Request Time : "
									value={format(normalizedItem.time, "MMM do, y  HH:mm:ss a")}
								/>
								<TagItem
									icon={Clock}
									title="Request duration : "
									value={`${round(normalizedItem.requestDuration, 4)}s`}
								/>
								<TagItem
									icon={Boxes}
									title="Model : "
									value={normalizedItem.model}
								/>
								<TagItem
									icon={CircleDollarSign}
									title="Usage cost : "
									value={round(normalizedItem.cost, 6)}
								/>
								{normalizedItem.promptTokens > 0 && (
									<TagItem
										icon={Braces}
										title="Prompt tokens : "
										value={normalizedItem.promptTokens}
									/>
								)}
								{normalizedItem.totalTokens > 0 && (
									<TagItem
										icon={TicketPlus}
										title="Total tokens : "
										value={normalizedItem.totalTokens}
									/>
								)}
								<TagItem
									icon={Container}
									title="Environment : "
									value={normalizedItem.environment}
								/>
								{normalizedItem.audioVoice && (
									<TagItem
										icon={AudioLines}
										title="Audio voice : "
										value={normalizedItem.audioVoice}
									/>
								)}
								{normalizedItem.imageSize && (
									<TagItem
										icon={ImageIcon}
										title="Image size : "
										value={normalizedItem.imageSize}
									/>
								)}
								{normalizedItem.type && (
									<TagItem
										icon={ClipboardType}
										title="Type : "
										value={normalizedItem.type}
									/>
								)}
							</div>
							{normalizedItem.prompt && (
								<div className="flex flex-col space-y-3 mt-4">
									<span className="text-sm text-stone-500 font-medium">
										Prompt :{" "}
									</span>
									<code className="text-sm inline-flex text-left items-center bg-stone-950 text-stone-200 rounded-md p-4">
										{normalizedItem.prompt}
									</code>
								</div>
							)}
							{normalizedItem.revisedPrompt && (
								<div className="flex flex-col space-y-3 mt-4">
									<span className="text-sm text-stone-500 font-medium">
										Revised Prompt :{" "}
									</span>
									<code className="text-sm inline-flex text-left items-center bg-stone-950 text-stone-200 rounded-md p-4">
										{normalizedItem.revisedPrompt}
									</code>
								</div>
							)}
							{normalizedItem.response && (
								<div className="flex flex-col space-y-3 mt-4">
									<span className="text-sm text-stone-500 font-medium">
										Response :{" "}
									</span>
									<code className="text-sm inline-flex text-left items-center bg-stone-950 text-stone-200 rounded-md p-4">
										{normalizedItem.response}
									</code>
								</div>
							)}
							{normalizedItem.image && normalizedItem.imageSize && (
								<a
									href={normalizedItem.image}
									target="_blank"
									rel="noopener noreferrer"
									className="flex items-center justify-center aspect-h-1 aspect-w-1 w-full overflow-hidden rounded-md bg-stone-100 lg:aspect-none lg:h-80 mt-4 group relative p-4 text-center text-stone-500"
								>
									<Image
										src={normalizedItem.image}
										alt={normalizedItem.applicationName}
										className="h-full w-full object-cover object-center lg:h-full lg:w-full"
										width={parseInt(normalizedItem.imageSize.split("x")[0], 10)}
										height={parseInt(
											normalizedItem.imageSize.split("x")[1],
											10
										)}
									/>
									<span className="flex items-center justify-center opacity-0 group-hover:opacity-100 absolute top-0 left-0 w-full h-full text-primary bg-stone-100">
										<ExternalLink className="w-6 h-6 ml-2 shrink-0" />
									</span>
								</a>
							)}
						</div>
					</div>
				</SheetDescription>
			</SheetContent>
		</Sheet>
	);
}
