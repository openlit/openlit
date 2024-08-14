import { useRequest } from "@/components/(playground)/request/request-context";
import Image from "next/image";
import { round } from "lodash";
import { format } from "date-fns";
import { getRequestDetailsDisplayKeys, normalizeTrace } from "@/helpers/trace";
import { TraceMapping, TransformedTraceRow } from "@/constants/traces";
import {
	CalendarDays,
	Clock,
	ExternalLink,
	LucideIcon,
	PyramidIcon,
	SquareTerminal,
} from "lucide-react";
import {
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { JsonViewer } from "@textea/json-viewer";

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

const CodeItem = ({ label, text }: { label: string; text: string }) => (
	<div className="flex flex-col space-y-3 mt-4">
		<span className="text-sm text-stone-500 font-medium">{label} : </span>
		<code className="text-sm inline-flex text-left items-center bg-stone-950 text-stone-200 rounded-md p-4">
			{text}
		</code>
	</div>
);

export default function RequestDetails() {
	const [request, updateRequest] = useRequest();

	const onClose = (open: boolean) => {
		if (!open) updateRequest(null);
	};

	if (!request) return null;

	const normalizedItem: TransformedTraceRow = normalizeTrace(request);
	const isException = normalizedItem.statusCode === "STATUS_CODE_ERROR";
	const displayKeys = getRequestDetailsDisplayKeys(
		normalizedItem.type,
		isException
	);

	return (
		<Sheet open onOpenChange={onClose}>
			<SheetContent className="max-w-none sm:max-w-none w-1/2 bg-stone-200 dark:bg-stone-200">
				<SheetHeader>
					<SheetTitle>
						{isException ? (
							<div className="flex flex-col text-stone-800">
								<div className="flex items-center text-2xl font-bold leading-7">
									<p className="capitalize">{normalizedItem.serviceName}</p>
								</div>
							</div>
						) : (
							<div className="flex flex-col text-stone-800">
								<div className="flex items-center text-2xl font-bold leading-7">
									<p className="capitalize">{normalizedItem.applicationName}</p>
								</div>
								<div className="flex items-center mt-3">
									<PyramidIcon size="12" />
									<p className="ml-3 text-sm leading-none">
										{normalizedItem.provider || normalizedItem.system}
									</p>
								</div>
							</div>
						)}
					</SheetTitle>
				</SheetHeader>
				<div className="h-full w-full flex grow pb-8">
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
									icon={SquareTerminal}
									title="Status Code : "
									value={normalizedItem.statusCode}
								/>
								{displayKeys.map(
									(keyItem, index) =>
										normalizedItem[keyItem] && (
											<TagItem
												key={`${keyItem}-${index}`}
												icon={TraceMapping[keyItem].icon}
												title={`${TraceMapping[keyItem].label} : `}
												value={normalizedItem[keyItem]}
											/>
										)
								)}
							</div>

							{/* Prompts */}
							{normalizedItem.prompt && (
								<CodeItem
									label={TraceMapping["prompt"].label}
									text={normalizedItem.prompt}
								/>
							)}
							{normalizedItem.revisedPrompt && (
								<CodeItem
									label={TraceMapping["revisedPrompt"].label}
									text={normalizedItem.revisedPrompt}
								/>
							)}
							{normalizedItem.response && (
								<CodeItem
									label={TraceMapping["response"].label}
									text={normalizedItem.response}
								/>
							)}
							{/* Prompts */}

							{/* Image */}
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
							{/* Image */}

							{/* Vector */}
							{normalizedItem.statement && (
								<CodeItem
									label={TraceMapping["statement"].label}
									text={normalizedItem.statement}
								/>
							)}

							{normalizedItem.whereDocument && (
								<CodeItem
									label={TraceMapping["whereDocument"].label}
									text={normalizedItem.whereDocument}
								/>
							)}

							{normalizedItem.filter && (
								<CodeItem
									label={TraceMapping["filter"].label}
									text={normalizedItem.filter}
								/>
							)}
							{/* Vector */}

							{/* Framework */}
							{normalizedItem.retrievalSource && (
								<CodeItem
									label={TraceMapping["retrievalSource"].label}
									text={normalizedItem.retrievalSource}
								/>
							)}
							{/* Framework */}

							{/* Exception */}
							{normalizedItem.statusMessage && (
								<CodeItem
									label={TraceMapping["statusMessage"].label}
									text={normalizedItem.statusMessage}
								/>
							)}
							{/* Exception */}

							{/* Request full trace to explore */}
							<div className="flex flex-col space-y-3 mt-4">
								<span className="text-sm text-stone-500 font-medium">
									Request Trace :{" "}
								</span>
								<code className="text-sm inline-flex text-left items-center bg-stone-950 text-stone-200 rounded-md p-4">
									<JsonViewer
										value={request}
										className="overflow-auto p-3 h-[400px] w-full !rounded-none"
										enableClipboard={false}
										displayDataTypes={false}
										displaySize={false}
										theme="dark"
									/>
								</code>
							</div>
							{/* Request full trace to explore */}
						</div>
					</div>
				</div>
			</SheetContent>
		</Sheet>
	);
}
