import { FormEventHandler, Fragment, useCallback } from "react";
import { Dialog, Transition } from "@headlessui/react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { CONNECTIONS, CONNECTIONS_FORM_FIELD } from "./constant";
import { CONNECTION_PLATFORM_TYPE } from "@/utils/connection";
import FormBuilder from "@/components/common/form-builder";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import toast from "react-hot-toast";
import Image from "next/image";

const CONNECTIONS_TOAST_ID = "connection-details";

export default function AddConnections({
	platform,
	onClose,
	onSuccesscb,
}: {
	platform: string;
	onClose: () => void;
	onSuccesscb: () => void;
}) {
	const { fireRequest: firePostRequest, isLoading: isCreating } =
		useFetchWrapper();

	const onSubmit: FormEventHandler<HTMLFormElement> = useCallback(
		(event) => {
			event.preventDefault();
			const formElement = event.target as HTMLFormElement;

			toast.loading("Adding connection...", {
				id: CONNECTIONS_TOAST_ID,
			});

			const formFields =
				CONNECTIONS_FORM_FIELD[platform as CONNECTION_PLATFORM_TYPE];

			const payload: any = formFields.reduce(
				(acc: any, item) => {
					acc[item.name] = (formElement[item.name] as any).value;
					return acc;
				},
				{ platform }
			);

			firePostRequest({
				body: JSON.stringify(payload),
				requestType: "POST",
				url: "/api/connections",
				responseDataKey: "data",
				successCb: () => {
					onSuccesscb();
					toast.success("Connection added successfully!", {
						id: CONNECTIONS_TOAST_ID,
					});
				},
				failureCb: (err?: string) => {
					toast.error(err || "Connection addition failed!", {
						id: CONNECTIONS_TOAST_ID,
					});
				},
			});
		},
		[platform]
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
												<Dialog.Title className="flex items-center text-2xl font-bold leading-7 text-tertiary">
													<Image
														className="w-8 h-8 rounded-l-sm"
														src={`/images/connections${
															CONNECTIONS[platform as CONNECTION_PLATFORM_TYPE]
																.image
														}`}
														alt={
															CONNECTIONS[platform as CONNECTION_PLATFORM_TYPE]
																.name
														}
														width="64"
														height="64"
													/>
													<p className="ml-4">
														Export to{" "}
														{
															CONNECTIONS[platform as CONNECTION_PLATFORM_TYPE]
																.name
														}
													</p>
												</Dialog.Title>
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
											<FormBuilder
												fields={
													CONNECTIONS_FORM_FIELD[
														platform as keyof typeof CONNECTIONS_FORM_FIELD
													]
												}
												heading={`Add details to connect to ${platform}`}
												isLoading={isCreating}
												onSubmit={onSubmit}
												submitButtonText={"Save"}
											/>
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
