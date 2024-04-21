import NextAuth, { AuthOptions } from "next-auth";
// import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { PrismaClient } from "@prisma/client";
import asaw from "@/utils/asaw";
import {
	createNewUser,
	getUserByEmail,
	updateUser,
	doesPasswordMatches,
} from "@/lib/user";

const prisma = new PrismaClient();

export const authOptions = {
	adapter: PrismaAdapter(prisma),
	callbacks: {
		async jwt({ token, account, user, ...rest }) {
			// Persist the OAuth access_token and or the user id to the token right after signin
			if (account) {
				token.accessToken = account.access_token;
			}

			if (user?.id) {
				token.id = user.id;
			}

			return token;
		},
		signIn: async ({ user, account, profile }) => {
			if (!user.email) {
				return false;
			}
			if (account?.provider === "google") {
				const [, existingUser] = await asaw(
					getUserByEmail({ email: user.email })
				);
				// if the user already exists via email,
				// update the user with their name and image from Google
				if (existingUser && !existingUser.name) {
					await asaw(
						updateUser({
							where: { email: user.email },
							data: {
								name: profile?.name,
								// @ts-ignore - this is a bug in the types, `picture` is a valid on the `Profile` type
								image: profile?.picture,
							},
						})
					);
				}
			}

			return true;
		},
		async session({ session, token }: { session: any; token: any }) {
			try {
				session.user.id = token.id;
			} catch (e) {
				console.log(e);
			}
			return session;
		},
	},
	providers: [
		// GoogleProvider({
		// 	clientId: process.env.GOOGLE_CLIENT_ID || "",
		// 	clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
		// }),
		CredentialsProvider({
			id: "login",
			name: "Credentials Login",
			credentials: {
				email: {
					label: "Email",
					type: "email",
					placeholder: "openlit@openlit.io",
				},
				password: { label: "Password", type: "password" },
			},
			async authorize(credentials) {
				if (!credentials) return null;
				const [err, user] = await asaw(
					getUserByEmail({ email: credentials.email, selectPassword: true })
				);
				if (!user || err) return err || "No such user exists!";
				const passwordsMatch = await doesPasswordMatches(
					credentials.password,
					user.password
				);

				if (passwordsMatch) return user;
				return null;
			},
		}),
		CredentialsProvider({
			id: "register",
			name: "Credentials Register",
			credentials: {
				email: {
					label: "Email",
					type: "email",
					placeholder: "openlit@openlit.io",
				},
				password: { label: "Password", type: "password" },
			},
			async authorize(credentials) {
				if (!credentials?.email || !credentials?.password) return null;
				const [err, user] = await asaw(
					createNewUser({
						email: credentials?.email,
						password: credentials?.password,
					})
				);

				if (err) throw new Error(err);
				return user;
			},
		}),
	],
	pages: {
		signIn: "/login",
		newUser: "/register",
	},
	session: { strategy: "jwt" },
} as AuthOptions;

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
