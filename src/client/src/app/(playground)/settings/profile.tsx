import SideTabs, { SideTabItemProps } from "@/components/common/side-tabs";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { noop } from "@/utils/noop";
import { FormEventHandler, MouseEventHandler, useState } from "react";
import toast from "react-hot-toast";

const PROFILE_TOAST_ID = "profile-details";

function ModifyProfileDetails() {
	const { error, fireRequest, isLoading } = useFetchWrapper();

	const modifyDetails: FormEventHandler<HTMLFormElement> = (event) => {
		event.preventDefault();
		const formElement = event.target as HTMLFormElement;

		const bodyObject = {
			currentPassword: (formElement.currentPassword as any)?.value,
			newPassword: (formElement.newPassword as any)?.value,
			name: (formElement.name as any)?.value,
		};

		if (
			bodyObject.newPassword !== (formElement.confirmNewPassword as any)?.value
		) {
			toast.loading("New password and Confirm new password does not match...", {
				id: PROFILE_TOAST_ID,
			});
			return;
		}

		toast.loading("Modifying profile details...", {
			id: PROFILE_TOAST_ID,
		});

		fireRequest({
			body: JSON.stringify(bodyObject),
			requestType: "POST",
			url: "/api/user/profile",
			responseDataKey: "data",
			successCb: () => {
				toast.success("Profile details updated!", {
					id: PROFILE_TOAST_ID,
				});
				formElement.reset();
			},
			failureCb: (err?: string) => {
				toast.error(err || "Profile details updation failed!", {
					id: PROFILE_TOAST_ID,
				});
			},
		});
	};

	return (
		<form
			className="flex flex-col w-full"
			onSubmit={isLoading ? noop : modifyDetails}
		>
			<div className="flex flex-col relative flex-1 overflow-y-auto px-5 py-3">
				<h2 className="text-base font-semibold text-tertiary sticky top-0 bg-white">
					Update profile details
				</h2>

				<div className="flex flex-col mt-6 w-full">
					<div className="flex flex-1 items-center">
						<label
							htmlFor="name"
							className="text-tertiary/[0.8] text-sm font-normal w-1/5"
						>
							Profile Name
						</label>
						<div className="flex w-2/3 shadow-sm ring-1 ring-inset ring-gray-300">
							<input
								key="name"
								type="text"
								name="name"
								id="name"
								className="flex-1 border border-tertiary/[0.2] py-1.5 px-2 text-tertiary placeholder:text-tertiary/[0.4] outline-none focus:ring-0 text-sm"
								placeholder="profile name"
								defaultValue=""
							/>
						</div>
					</div>
				</div>

				<div className="flex flex-col mt-6 w-full">
					<div className="flex flex-1 items-center">
						<label
							htmlFor="currentPassword"
							className="text-tertiary/[0.8] text-sm font-normal w-1/5"
						>
							Current Password
						</label>
						<div className="flex w-2/3 shadow-sm ring-1 ring-inset ring-gray-300">
							<input
								key="currentPassword"
								type="password"
								name="currentPassword"
								id="currentPassword"
								className="flex-1 border border-tertiary/[0.2] py-1.5 px-2 text-tertiary placeholder:text-tertiary/[0.4] outline-none focus:ring-0 text-sm"
								placeholder="********"
							/>
						</div>
					</div>
				</div>

				<div className="flex flex-col mt-6 w-full">
					<div className="flex flex-1 items-center">
						<label
							htmlFor="newPassword"
							className="text-tertiary/[0.8] text-sm font-normal w-1/5"
						>
							New Password
						</label>
						<div className="flex w-2/3 shadow-sm ring-1 ring-inset ring-gray-300">
							<input
								key="newPassword"
								type="password"
								name="newPassword"
								id="newPassword"
								className="flex-1 border border-tertiary/[0.2] py-1.5 px-2 text-tertiary placeholder:text-tertiary/[0.4] outline-none focus:ring-0 text-sm"
								placeholder="********"
							/>
						</div>
					</div>
				</div>

				<div className="flex flex-col mt-6 w-full">
					<div className="flex flex-1 items-center">
						<label
							htmlFor="confirmNewPassword"
							className="text-tertiary/[0.8] text-sm font-normal w-1/5"
						>
							Confirm New Password
						</label>
						<div className="flex w-2/3 shadow-sm ring-1 ring-inset ring-gray-300">
							<input
								key="confirmNewPassword"
								type="password"
								name="confirmNewPassword"
								id="confirmNewPassword"
								className="flex-1 border border-tertiary/[0.2] py-1.5 px-2 text-tertiary placeholder:text-tertiary/[0.4] outline-none focus:ring-0 text-sm"
								placeholder="********"
							/>
						</div>
					</div>
				</div>
			</div>

			<div className="mt-6 flex items-center justify-end border-t border-secondary w-full py-2 gap-3">
				<button
					type="submit"
					className={`rounded-sm bg-primary/[0.9] px-5 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-primary focus-visible:outline ${
						isLoading ? "animate-pulse" : ""
					}`}
				>
					Update
				</button>
			</div>
		</form>
	);
}

export default function Profile() {
	const items: SideTabItemProps[] = [
		{
			id: "details",
			name: "Details",
		},
	];

	const [selectedTabId, setSelectedTabId] = useState<string>(items[0].id);

	const onClickDB: MouseEventHandler<HTMLElement> = (event) => {
		const { itemId = "" } = (
			(event.target as HTMLElement).closest("li") as HTMLLIElement
		).dataset;
		setSelectedTabId(itemId);
	};

	return (
		<div className="flex flex-1 h-full border-t border-secondary relative">
			<SideTabs
				items={items}
				onClickTab={onClickDB}
				selectedTabId={selectedTabId}
			/>
			<div className="flex flex-1 w-full h-full">
				{selectedTabId === "details" ? <ModifyProfileDetails /> : null}
			</div>
		</div>
	);
}
