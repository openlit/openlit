import FormBuilder from "@/components/common/form-builder";
import SideTabs, { SideTabItemProps } from "@/components/common/side-tabs";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { User } from "@prisma/client";
import {
	FormEventHandler,
	MouseEventHandler,
	useEffect,
	useState,
} from "react";
import toast from "react-hot-toast";

const PROFILE_TOAST_ID = "profile-details";

function ModifyProfileDetails() {
	const { data: user, fireRequest: getUser } = useFetchWrapper();
	const { fireRequest, isLoading } = useFetchWrapper();

	const fetchUser = () => {
		getUser({
			requestType: "GET",
			url: "/api/user/profile",
			responseDataKey: "data",
			failureCb: (err?: string) => {
				toast.error(err || "Unauthorized access!", {
					id: PROFILE_TOAST_ID,
				});
			},
		});
	};

	useEffect(() => {
		fetchUser();
	}, []);

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
				fetchUser();
			},
			failureCb: (err?: string) => {
				toast.error(err || "Profile details updation failed!", {
					id: PROFILE_TOAST_ID,
				});
			},
		});
	};

	const updatedUser = user as User;

	return (
		<FormBuilder
			fields={[
				{
					label: "Profile Name",
					type: "text",
					name: "name",
					placeholder: "db-config",
					defaultValue: updatedUser?.name || "",
					inputKey: `${updatedUser?.id}-name`,
				},
				{
					label: "Current Password",
					type: "password",
					name: "currentPassword",
					placeholder: "*******",
					inputKey: `${updatedUser?.id}-currentPassword`,
				},
				{
					label: "New Password",
					type: "password",
					name: "newPassword",
					placeholder: "*******",
					inputKey: `${updatedUser?.id}-newPassword`,
				},
				{
					label: "Confirm New Password",
					type: "password",
					name: "confirmNewPassword",
					placeholder: "*******",
					inputKey: `${updatedUser?.id}-confirmNewPassword`,
				},
			]}
			heading={`Update profile details`}
			isLoading={isLoading}
			onSubmit={modifyDetails}
			submitButtonText={"Update"}
		/>
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
