import { RootStore } from "@/types/store/root";

export const getProjectList = (state: RootStore) => state.project.list;

export const getCurrentProject = (state: RootStore) => state.project.current;

export const getCurrentProjectEnvironment = (state: RootStore) =>
	state.project.currentEnvironment;

export const getProjectIsLoading = (state: RootStore) => state.project.isLoading;
