import { Fragment } from "react";
import { Dialog, Transition } from "@headlessui/react";
import {
	BeakerIcon,
	CalendarDaysIcon,
	ClipboardDocumentCheckIcon,
	ClipboardDocumentListIcon,
	ClockIcon,
	CogIcon,
	CpuChipIcon,
	CurrencyDollarIcon,
	GlobeAltIcon,
	LanguageIcon,
	PhotoIcon,
	SpeakerWaveIcon,
	XMarkIcon,
} from "@heroicons/react/24/outline";
import { useRequest } from "@/app/(playground)/requests/request-context";
import Image from "next/image";
import { round } from "lodash";
import { format } from "date-fns";
import { ArrowTopRightOnSquareIcon } from "@heroicons/react/24/solid";
import { normalizeTrace } from "@/helpers/trace";
import { TransformedTraceRow } from "@/constants/traces";

export default function RequestDetails() {
	const [request, updateRequest] = useRequest();

	const onClose = () => {
		updateRequest(null);
	};

	if (!request) return null;

	const normalizedItem: TransformedTraceRow = normalizeTrace(request);

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
					<div className="fixed inset-0 bg-tertiary/[0.5] bg-opacity-75 transition-opacity" />
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
									<div className="flex h-full flex-col overflow-y-scroll bg-white shadow-xl">
										<div className="p-4 bg-secondary relative">
											<div className="flex flex-col">
												<Dialog.Title className="text-2xl font-bold leading-7 text-tertiary">
													{normalizedItem.applicationName}
												</Dialog.Title>
												<div className="flex items-center mt-3 text-tertiary/[.7]">
													<BeakerIcon className="w-4 mr-3" />
													<p className="text-sm leading-none mb-1">
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
														className="relative rounded-full text-tertiary/[0.7] hover:text-tertiary focus:outline-none"
														onClick={onClose}
													>
														<span className="sr-only">Close panel</span>
														<XMarkIcon className="h-6 w-6" aria-hidden="true" />
													</button>
												</div>
											</Transition.Child>
										</div>
										<div className="relative p-6 flex-1">
											<div className="flex items-start flex-wrap gap-3">
												<div className="flex items-center justify-center space-x-1 px-3 py-1 rounded-full text-xs bg-primary/[0.1] text-primary font-medium">
													<CalendarDaysIcon className="w-3" />
													<span>Request Time : </span>
													<span>
														{format(
															normalizedItem.time,
															"MMM do, y  HH:mm:ss a"
														)}
													</span>
												</div>
												<div className="flex items-center justify-center space-x-1 px-3 py-1 rounded-full text-xs bg-primary/[0.1] text-primary font-medium">
													<ClockIcon className="w-3" />
													<span>Request duration : </span>
													<span>
														{round(normalizedItem.requestDuration, 4)}s
													</span>
												</div>
												<div className="flex items-center justify-center space-x-1 px-3 py-1 rounded-full text-xs bg-primary/[0.1] text-primary font-medium">
													<CogIcon className="w-3" />
													<span>Model : </span>
													<span>{normalizedItem.model}</span>
												</div>
												<div className="flex items-center justify-center space-x-1 px-3 py-1 rounded-full text-xs bg-primary/[0.1] text-primary font-medium">
													<CurrencyDollarIcon className="w-3" />
													<span>Usage cost : </span>
													<span>{round(normalizedItem.cost, 6)}</span>
												</div>
												{normalizedItem.promptTokens > 0 && (
													<div className="flex items-center justify-center space-x-1 px-3 py-1 rounded-full text-xs bg-primary/[0.1] text-primary font-medium">
														<ClipboardDocumentCheckIcon className="w-3" />
														<span>Prompt tokens : </span>
														<span>{normalizedItem.promptTokens}</span>
													</div>
												)}
												{normalizedItem.totalTokens > 0 && (
													<div className="flex items-center justify-center space-x-1 px-3 py-1 rounded-full text-xs bg-primary/[0.1] text-primary font-medium">
														<ClipboardDocumentListIcon className="w-3" />
														<span>Total tokens : </span>
														<span>{normalizedItem.totalTokens}</span>
													</div>
												)}
												{normalizedItem.sourceLanguage && (
													<div className="flex items-center justify-center space-x-1 px-3 py-1 rounded-full text-xs bg-primary/[0.1] text-primary font-medium">
														<LanguageIcon className="w-3" />
														<span>Source Language : </span>
														<span>{normalizedItem.sourceLanguage}</span>
													</div>
												)}
												<div className="flex items-center justify-center space-x-1 px-3 py-1 rounded-full text-xs bg-primary/[0.1] text-primary font-medium">
													<GlobeAltIcon className="w-3" />
													<span>Environment : </span>
													<span>{normalizedItem.environment}</span>
												</div>
												{normalizedItem.audioVoice && (
													<div className="flex items-center justify-center space-x-1 px-3 py-1 rounded-full text-xs bg-primary/[0.1] text-primary font-medium">
														<SpeakerWaveIcon className="w-3" />
														<span>Audio voice : </span>
														<span>{normalizedItem.audioVoice}</span>
													</div>
												)}
												{normalizedItem.imageSize && (
													<div className="flex items-center justify-center space-x-1 px-3 py-1 rounded-full text-xs bg-primary/[0.1] text-primary font-medium">
														<PhotoIcon className="w-3" />
														<span>Image size : </span>
														<span>{normalizedItem.imageSize}</span>
													</div>
												)}
												{normalizedItem.type && (
													<div className="flex items-center justify-center space-x-1 px-3 py-1 rounded-full text-xs bg-primary/[0.1] text-primary font-medium">
														<CpuChipIcon className="w-3" />
														<span>Type : </span>
														<span>{normalizedItem.type}</span>
													</div>
												)}
											</div>
											<div className="flex flex-col space-y-3 mt-4">
												<span className="text-sm text-tertiary/[0.8] font-medium">
													Prompt :{" "}
												</span>
												<code className="text-sm inline-flex text-left items-center bg-tertiary text-secondary rounded-md p-4">
													{normalizedItem.prompt}
												</code>
											</div>
											{normalizedItem.revisedPrompt && (
												<div className="flex flex-col space-y-3 mt-4">
													<span className="text-sm text-tertiary/[0.8] font-medium">
														Revised Prompt :{" "}
													</span>
													<code className="text-sm inline-flex text-left items-center bg-tertiary text-secondary rounded-md p-4">
														{normalizedItem.revisedPrompt}
													</code>
												</div>
											)}
											{normalizedItem.response && (
												<div className="flex flex-col space-y-3 mt-4">
													<span className="text-sm text-tertiary/[0.8] font-medium">
														Response :{" "}
													</span>
													<code className="text-sm inline-flex text-left items-center bg-tertiary text-secondary rounded-md p-4">
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
														<ArrowTopRightOnSquareIcon className="w-6 h-6 ml-2 shrink-0" />
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
