import { useRootStore } from "@/store";
import { getData } from "@/utils/api";
import asaw from "@/utils/asaw";

export const fetchAndPopulateCurrentUserStore = async () => {
	const [, user] = await asaw(
		getData({
			url: "/api/user/profile",
			method: "GET",
		})
	);

	useRootStore.getState().user.set(user);
};
