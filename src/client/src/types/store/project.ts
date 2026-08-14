export type ProjectWithMeta = {
	id: string;
	organisationId: string;
	name: string;
	slug: string;
	isDefault: boolean;
	isCurrent: boolean;
	createdAt: string;
};

export type ProjectStore = {
	list?: ProjectWithMeta[];
	current?: ProjectWithMeta;
	isLoading: boolean;
	setList: (list: ProjectWithMeta[]) => void;
	setCurrent: (project?: ProjectWithMeta) => void;
	setIsLoading: (loading: boolean) => void;
	reset: () => void;
};
