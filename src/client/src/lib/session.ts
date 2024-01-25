import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/auth";
import asaw from "@/utils/asaw";
import { User } from "next-auth";
import { getUserById } from "./user";

export async function getCurrentUser(): Promise<User | null> {
	const [, session] = await asaw(getServerSession(authOptions));

	if (session?.user?.id) {
		const [, user] = await asaw(getUserById({ id: session.user.id }));
		return user ?? null;
	}

	return null;
}
