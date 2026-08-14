"use client";

import { lens } from "@dhmk/zustand-lens";
import { ProjectStore } from "@/types/store/project";

const initialState = {
	list: undefined,
	current: undefined,
	isLoading: false,
};

export const projectStoreSlice: ProjectStore = lens((setStore, getStore) => ({
	...initialState,
	setList: (list) =>
		setStore(() => ({
			...getStore(),
			list,
			current:
				list.find((project) => project.isCurrent) ||
				list.find((project) => project.isDefault) ||
				list[0],
			isLoading: false,
		})),
	setCurrent: (project) =>
		setStore(() => {
			const currentList = getStore().list || [];
			const updatedList = currentList.map((item) => ({
				...item,
				isCurrent: item.id === project?.id,
			}));

			return {
				...getStore(),
				list: updatedList,
				current: updatedList.find((item) => item.id === project?.id),
			};
		}),
	setIsLoading: (isLoading) =>
		setStore(() => ({
			...getStore(),
			isLoading,
		})),
	reset: () =>
		setStore(() => ({
			...initialState,
		})),
}));
