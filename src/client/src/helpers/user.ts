import { getData } from "@/utils/api";
import asaw from "@/utils/asaw";
import { redirect } from "next/navigation";

export const fetchAndPopulateCurrentUserStore = async (updateUser) => {
	const [, user] = await asaw(
		getData({
			url: "/api/user/profile",
			method: "GET",
		})
	);

	if (!user) return redirect("/login");
	updateUser(user);
};
