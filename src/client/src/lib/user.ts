import { User } from "@prisma/client";
import prisma from "./prisma";
import asaw from "@/utils/asaw";
import { genSaltSync, hashSync } from "bcrypt-ts";

function exclude<User>(
	user: User,
	keys: string[] = ["password"]
): Omit<User, string> {
	// @ts-expect-error
	return Object.fromEntries(
		// @ts-expect-error
		Object.entries(user).filter(([key]) =>
			typeof keys.includes === "function" ? !keys.includes(key) : true
		)
	);
}

export const getUserByEmail = async ({
	email,
	selectPassword = false,
}: {
	email?: string;
	selectPassword?: boolean;
}) => {
	if (!email) return ["No email Provided"];
	const user = await prisma.user.findUnique({
		where: {
			email,
		},
	});

	if (!user) null;

	// @ts-expect-error
	return exclude(user, selectPassword && []);
};

export const getUserById = async ({ id }: { id?: string }) => {
	if (!id) return null;
	return await prisma.user.findUnique({
		where: {
			id,
		},
	});
};

export const createNewUser = async (
	{
		email,
		password,
	}: {
		email: string;
		password: string;
	},
	options?: { selectPassword?: boolean }
) => {
	const [, existingUser] = await asaw(getUserByEmail({ email }));
	if (existingUser) throw new Error("User already exists! Please signin!");

	const salt = genSaltSync(10);
	const hash = hashSync(password, salt);

	let createdUser = await prisma.user.create({
		data: {
			email,
			password: hash,
		},
	});

	if (createdUser?.id) {
		// @ts-expect-error
		return exclude(createdUser, options?.selectPassword && []);
	}

	throw new Error("Cannot create a user!");
};
