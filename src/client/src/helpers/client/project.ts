import { useRootStore } from "@/store";
import { ProjectWithMeta } from "@/types/store/project";
import { getData, postData } from "@/utils/api";
import asaw from "@/utils/asaw";
import { toast } from "sonner";
import getMessage from "@/constants/messages";
import { fetchDatabaseConfigList, pingActiveDatabaseConfig } from "./database-config";

export const fetchProjectList = async (organisationId?: string) => {
	const currentOrgId =
		organisationId || useRootStore.getState().organisation.current?.id;

	if (!currentOrgId) {
		useRootStore.getState().project.setList([]);
		return [];
	}

	useRootStore.getState().project.setIsLoading(true);
	const [err, data] = await asaw(
		getData({
			url: `/api/organisation/${currentOrgId}/projects`,
			method: "GET",
		})
	);

	if (err || !Array.isArray(data)) {
		useRootStore.getState().project.setIsLoading(false);
		useRootStore.getState().project.setList([]);
		return [];
	}

	useRootStore.getState().project.setList(data);
	return data as ProjectWithMeta[];
};

export const changeActiveProject = async (
	projectId: string,
	successCb?: () => void
) => {
	const messages = getMessage();
	const currentOrgId = useRootStore.getState().organisation.current?.id;

	if (!currentOrgId) return;

	const [err, data] = await asaw(
		postData({
			url: `/api/organisation/${currentOrgId}/projects/current/${projectId}`,
			data: {},
		})
	);

	if (err || data?.err) {
		toast.error(err || data?.err || messages.PROJECT_SWITCH_FAILED, {
			id: "project-switch",
		});
		return;
	}

	const nextProject = useRootStore
		.getState()
		.project.list?.find((project) => project.id === projectId);
	if (nextProject) {
		useRootStore.getState().project.setCurrent(nextProject);
	}

	await fetchDatabaseConfigList(() => {});
	await pingActiveDatabaseConfig();
	successCb?.();
};
