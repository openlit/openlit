"use client";

import FormBuilder from "@/components/common/form-builder";
import { getUserDetails, setUser } from "@/selectors/user";
import { useRootStore } from "@/store";
import useFetchWrapper from "@/utils/hooks/useFetchWrapper";
import { User } from "@prisma/client";
import { FormEventHandler } from "react";
import { toast } from "sonner";

const PROFILE_TOAST_ID = "profile-details";

function ModifyProfileDetails({
	user,
	fetchUser,
}: {
	user: User | null;
	fetchUser: () => void;
}) {
	const { fireRequest, isLoading } = useFetchWrapper();

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

	return (
		<FormBuilder
			fields={[
				{
					label: "Email",
					type: "text",
					name: "email",
					placeholder: "db-config",
					defaultValue: user?.email || "",
					inputKey: `${user?.email}-email`,
					disabled: true,
				},
				{
					label: "Profile Name",
					type: "text",
					name: "name",
					placeholder: "db-config",
					defaultValue: user?.name || "",
					inputKey: `${user?.id}-name`,
				},
				{
					label: "Current Password",
					type: "password",
					name: "currentPassword",
					placeholder: "*******",
					inputKey: `${user?.id}-currentPassword`,
				},
				{
					label: "New Password",
					type: "password",
					name: "newPassword",
					placeholder: "*******",
					inputKey: `${user?.id}-newPassword`,
				},
				{
					label: "Confirm New Password",
					type: "password",
					name: "confirmNewPassword",
					placeholder: "*******",
					inputKey: `${user?.id}-confirmNewPassword`,
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
	const userDetails = useRootStore(getUserDetails);
	const setUserDetails = useRootStore(setUser);
	const { fireRequest: getUser } = useFetchWrapper();

	const fetchUser = () => {
		getUser({
			requestType: "GET",
			url: "/api/user/profile",
			responseDataKey: "data",
			successCb(res) {
				setUserDetails(res);
			},
			failureCb: (err?: string) => {
				toast.error(err || "Unauthorized access!", {
					id: PROFILE_TOAST_ID,
				});
			},
		});
	};

	return (
		<div className="flex flex-1 h-full w-full relative">
			<ModifyProfileDetails user={userDetails as User} fetchUser={fetchUser} />
		</div>
	);
}
