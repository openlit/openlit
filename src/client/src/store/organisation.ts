"use client";
import { OrganisationStore } from "@/types/store/organisation";
import { lens } from "@dhmk/zustand-lens";

const initialState = {
	list: undefined,
	current: undefined,
	pendingInvitations: [],
	isLoading: false,
};

export const organisationStoreSlice: OrganisationStore = lens(
	(setStore, getStore) => ({
		...initialState,
		setList: (list) =>
			setStore(() => ({
				...getStore(),
				list,
				current: list.find((org) => org.isCurrent),
				isLoading: false,
			})),
		setCurrent: (org) =>
			setStore(() => {
				const currentList = getStore().list || [];
				const updatedList = currentList.map((item) => ({
					...item,
					isCurrent: item.id === org?.id,
				}));
				return {
					...getStore(),
					list: updatedList,
					current: org,
				};
			}),
		setPendingInvitations: (invites) =>
			setStore(() => ({
				...getStore(),
				pendingInvitations: invites,
			})),
		setIsLoading: (isLoading) =>
			setStore(() => ({
				...getStore(),
				isLoading,
			})),
		reset: () =>
			setStore(() => ({
				...initialState,
			})),
	})
);
