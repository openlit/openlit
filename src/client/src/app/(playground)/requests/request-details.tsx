import { Fragment } from "react";
import { Dialog, Transition } from "@headlessui/react";
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
	CircleX,
	ClipboardType,
	Clock,
	Container,
	ExternalLink,
	Image as ImageIcon,
	LucideIcon,
	PyramidIcon,
	TicketPlus,
} from "lucide-react";
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerOverlay, DrawerTitle } from "@/components/ui/drawer";

const TagItem = ({
	icon: IconComponent,
	title,
	value,
}: {
	icon?: LucideIcon;
	title: string;
	value: any;
}) => (
	<div className="flex items-center justify-center space-x-1 px-3 py-1 rounded-full text-xs bg-primary/[0.1] text-primary font-medium">
		{IconComponent && <IconComponent className="h-3" />}
		<span>{title}</span>
		<span>{value}</span>
	</div>
);

export default function RequestDetails() {
	const [request, updateRequest] = useRequest();

	const onClose = () => {
		updateRequest(null);
	};

	if (!request) return null;

	const normalizedItem: TransformedTraceRow = normalizeTrace(request);

	return (
		<Drawer open direction="right">
			<DrawerOverlay className="red"/>
			<DrawerContent className="bg-white flex flex-col rounded-t-[10px] h-full w-[400px] mt-24 fixed bottom-0 right-0">
				<DrawerHeader>
					<DrawerTitle>Are you absolutely sure?</DrawerTitle>
					<DrawerDescription>This action cannot be undone.</DrawerDescription>
				</DrawerHeader>
				<DrawerFooter>
					{/* <Button>Submit</Button> */}
					{/* <DrawerClose>
						<Button variant="outline">Cancel</Button>
					</DrawerClose> */}
				</DrawerFooter>
			</DrawerContent>
		</Drawer>
	);

	return (
		<Transition.Root show as={Fragment}>
			<Dialog as="div" className="relative z-10" onClose={onClose}>
				<Transition.Child
					as={Fragment}
					enter="ease-in-out duration-500"
					enterFrom="opacity-0"
					enterTo="opacity-100"
					leave="ease-in-out duration-500"
					leaveFrom="opacity-100"
					leaveTo="opacity-0"
				>
					<div className="fixed inset-0 bg-stone-950 bg-opacity-50 transition-opacity" />
				</Transition.Child>

				<div className="fixed inset-0 overflow-hidden">
					<div className="absolute inset-0 overflow-hidden">
						<div className="pointer-events-none fixed inset-y-0 right-0 flex max-w-full pl-10">
							<Transition.Child
								as={Fragment}
								enter="transform transition ease-in-out duration-500 sm:duration-700"
								enterFrom="translate-x-full"
								enterTo="translate-x-0"
								leave="transform transition ease-in-out duration-500 sm:duration-700"
								leaveFrom="translate-x-0"
								leaveTo="translate-x-full"
							>
								<Dialog.Panel className="pointer-events-auto relative w-screen max-w-2xl">
									<div className="flex h-full flex-col overflow-y-scroll bg-stone-200 shadow-xl">
										<div className="p-4 bg-stone-700 relative">
											<div className="flex flex-col">
												<Dialog.Title className="flex items-center text-2xl font-bold leading-7 text-stone-200">
													<p className="capitalize">
														{normalizedItem.applicationName}
													</p>
												</Dialog.Title>
												<div className="flex items-center mt-3 text-stone-200">
													<PyramidIcon size="12" />
													<p className="ml-3 text-sm leading-none">
														{normalizedItem.provider}
													</p>
												</div>
											</div>
											<Transition.Child
												as={Fragment}
												enter="ease-in-out duration-500"
												enterFrom="opacity-0"
												enterTo="opacity-100"
												leave="ease-in-out duration-500"
												leaveFrom="opacity-100"
												leaveTo="opacity-0"
											>
												<div className="absolute right-0 top-0 flex pr-2 pt-4 sm:pr-4">
													<button
														type="button"
														className="relative rounded-full focus:outline-none"
														onClick={onClose}
													>
														<span className="sr-only">Close panel</span>
														<CircleX
															className="h-6 w-6 text-stone-100"
															aria-hidden="true"
														/>
													</button>
												</div>
											</Transition.Child>
										</div>
										<div className="relative p-6 flex-1">
											<div className="flex items-start flex-wrap gap-3">
												<TagItem
													icon={CalendarDays}
													title="Request Time : "
													value={format(
														normalizedItem.time,
														"MMM do, y  HH:mm:ss a"
													)}
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
													className="flex items-center justify-center aspect-h-1 aspect-w-1 w-full overflow-hidden rounded-md bg-secondary/[0.3] lg:aspect-none lg:h-80 mt-4 group relative p-4 text-center text-tertiary/[0.5]"
												>
													<Image
														src={normalizedItem.image}
														alt={normalizedItem.applicationName}
														className="h-full w-full object-cover object-center lg:h-full lg:w-full"
														width={parseInt(
															normalizedItem.imageSize.split("x")[0],
															10
														)}
														height={parseInt(
															normalizedItem.imageSize.split("x")[1],
															10
														)}
													/>
													<span className="flex items-center justify-center opacity-0 group-hover:opacity-100 absolute top-0 left-0 w-full h-full text-primary bg-primary/[0.1]">
														<ExternalLink className="w-6 h-6 ml-2 shrink-0" />
													</span>
												</a>
											)}
										</div>
									</div>
								</Dialog.Panel>
							</Transition.Child>
						</div>
					</div>
				</div>
			</Dialog>
		</Transition.Root>
	);
}
