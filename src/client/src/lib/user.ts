import prisma from "./prisma";
import asaw from "@/utils/asaw";
import { getCurrentUser } from "./session";
import { User } from "@prisma/client";
import { getHashedPassword, doesPasswordMatches } from "@/utils/user";

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
	if (!email) throw new Error("No email Provided");
	const user = await prisma.user.findUnique({
		where: {
			email,
		},
	});

	if (!user) throw new Error("No user with this email exists");

	// @ts-expect-error
	return exclude(user, selectPassword && []);
};

export const getUserById = async ({
	id,
	selectPassword = false,
}: {
	id?: string;
	selectPassword?: boolean;
}) => {
	if (!id) return null;
	const user = await prisma.user.findUnique({
		where: {
			id,
		},
	});

	// @ts-expect-error
	return exclude(user, selectPassword && []);
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

	const hashedPassword = getHashedPassword(password);

	let createdUser = await prisma.user.create({
		data: {
			email,
			password: hashedPassword,
		},
	});

	if (createdUser?.id) {
		// @ts-expect-error
		return exclude(createdUser, options?.selectPassword && []);
	}

	throw new Error("Cannot create a user!");
};

export const updateUser = async ({
	data,
	where,
}: {
	data: any;
	where: any;
}) => {
	if (!where || !Object.keys(where).length)
		throw new Error("No where clause defined");
	return await prisma.user.update({
		where,
		data,
	});
};

export const updateUserProfile = async ({
	currentPassword,
	newPassword,
	name,
}: {
	currentPassword?: string;
	newPassword?: string;
	name?: string;
}) => {
	const user = await getCurrentUser({ selectPassword: true });

	if (!user) throw new Error("Unauthorized user!");

	const updatedUserObject: Partial<User> = {};

	if (newPassword) {
		if (!currentPassword)
			throw new Error("Provide current password to update it to new one!");
		const passwordsMatch = await doesPasswordMatches(
			currentPassword,
			user.password || ""
		);
		if (!passwordsMatch) throw new Error("Wrong current password!");
		updatedUserObject.password = getHashedPassword(newPassword);
	}

	if (name) {
		updatedUserObject.name = name;
	}

	if (Object.keys(updatedUserObject).length === 0)
		throw new Error("Nothing to update!");

	return updateUser({
		data: updatedUserObject,
		where: { id: user.id },
	});
};
