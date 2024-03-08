import { compare, genSaltSync, hashSync } from "bcrypt-ts";

export const getHashedPassword = (password: string): string => {
	const salt = genSaltSync(10);
	const hash = hashSync(password, salt);
	return hash;
};

export const doesPasswordMatches = async (
	password: string,
	userPassword: string
): Promise<boolean> => {
	return await compare(password, userPassword);
};
