import NextAuth, { AuthOptions } from "next-auth";
import type { NextRequest } from "next/server";
import CredentialsProvider from "next-auth/providers/credentials";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { PrismaClient } from "@prisma/client";
import {
	buildOAuthProviders,
	emailFromProfile,
	isEmailExplicitlyUnverified,
	isEmailVouched,
	OAUTH_LINK_PROVIDERS,
	oauthProfilePatch,
} from "@/lib/auth/oauth-providers";
import asaw from "@/utils/asaw";
import {
	createNewUser,
	getUserByEmail,
	updateUser,
	doesPasswordMatches,
	getUserById,
} from "@/lib/user";
import { isInstanceAdminUser } from "@/lib/instance-admin";

const prisma = new PrismaClient();

// Invitations and shared database configs are addressed by email, so a new
// account only claims them when its provider vouched for that email.
async function claimEmailGrants(email: string, userId: string) {
	try {
		const { moveSharedDBConfigToDBUser } = await import("@/lib/db-config");
		await moveSharedDBConfigToDBUser(email, userId);

		const { moveInvitationsToMembership } = await import("@/lib/organisation");
		await moveInvitationsToMembership(email, userId);
	} catch (error) {
		console.error("Error during new user setup:", error);
	}
}

// Create a custom adapter that normalizes emails
function createNormalizedEmailAdapter(p: PrismaClient) {
	const baseAdapter = PrismaAdapter(p);
	return {
		...baseAdapter,
		async createUser(user: any) {
			// next-auth passes the whole provider profile. Keep only User columns;
			// provider-specific fields such as emailTrusted are not stored.
			const created = await baseAdapter.createUser!({
				name: user.name ?? null,
				email: typeof user.email === "string" ? user.email.toLowerCase().trim() : user.email,
				image: user.image ?? null,
				emailVerified: user.emailVerified ?? null,
			});
			if (user.emailVouched === true && created.email && created.id) {
				await claimEmailGrants(created.email, created.id);
			}
			return created;
		},
		async getUserByEmail(email: string) {
			// Normalize email before lookup
			const normalizedEmail = email.toLowerCase().trim();
			return baseAdapter.getUserByEmail!(normalizedEmail);
		},
	};
}

export const authOptions = {
	adapter: createNormalizedEmailAdapter(prisma),
	callbacks: {
		async jwt({ token, account, user, trigger }) {
			// Persist the OAuth access_token and or the user id to the token right after signin
			if (account) {
				token.accessToken = account.access_token;
			}

			if (user?.id) {
				token.id = user.id;
			}

			// Handle explicit session update requests (e.g., after completing onboarding)
			if (trigger === "update" && token?.id) {
				try {
					const [, existingUser] = await asaw(
						getUserById({ id: token.id as string })
					);

					if (!existingUser) {
						return null;
					}

					// Update hasCompletedOnboarding status from database
					token.hasCompletedOnboarding = existingUser.hasCompletedOnboarding;
					token.isInstanceAdmin = await isInstanceAdminUser(existingUser.id);
				} catch (error) {
					console.error("Database error during JWT update:", error);
				}
			}

		// Validate that the user still exists in the database for existing tokens
		// This prevents issues when starting with a fresh database but stale cookies
		if (token?.id && !user && trigger !== "update") {
			try {
				const [, existingUser] = await asaw(
					getUserById({ id: token.id as string })
				);

				// If user doesn't exist in database, invalidate the token
				if (!existingUser) {
					return null;
				}

				// Update hasCompletedOnboarding status on every token refresh
				token.hasCompletedOnboarding = existingUser.hasCompletedOnboarding;
				token.isInstanceAdmin = await isInstanceAdminUser(existingUser.id);
			} catch (error) {
				// If there's a database connection error during startup,
				// allow the token to pass through to avoid blocking the app
				// The error will be handled at the application level
				console.error("Database error during JWT validation:", error);
			}
		}

		// Set initial hasCompletedOnboarding for new users or OAuth logins
		// For OAuth logins, the user object doesn't include custom fields, so fetch from database
		if (user && token?.id) {
			try {
				const [, existingUser] = await asaw(
					getUserById({ id: token.id as string })
				);
				
				if (existingUser) {
					// Use the value from database (handles OAuth logins correctly)
					token.hasCompletedOnboarding = existingUser.hasCompletedOnboarding;
					token.isInstanceAdmin = await isInstanceAdminUser(existingUser.id);
				} else {
					// Fallback for brand new users (credentials provider during registration)
					token.hasCompletedOnboarding = (user as any).hasCompletedOnboarding ?? false;
				}
			} catch (error) {
				// Fallback to user object value if database query fails
				console.error("Database error during JWT user setup:", error);
				token.hasCompletedOnboarding = (user as any).hasCompletedOnboarding ?? false;
			}
		}

			return token;
		},
		signIn: async ({ user, account, profile }) => {
			if (!user.email) {
				const candidate = emailFromProfile(profile);
				if (candidate) user.email = candidate;
			}

			if (!user.email) {
				return false;
			}

			if (account?.provider && OAUTH_LINK_PROVIDERS.has(account.provider)) {
				// A provider that says the email is unverified cannot claim it.
				if (isEmailExplicitlyUnverified(profile)) {
					return "/login?error=AccessDenied";
				}
				const emailVouched = isEmailVouched(account.provider, profile, user);
				// Read by the adapter when this sign-in creates a new account.
				(user as { emailVouched?: boolean }).emailVouched = emailVouched;

				const [, existingUser] = await asaw(
					getUserByEmail({ email: user.email })
				);

				// If user exists but doesn't have this provider linked yet
				if (existingUser) {
					const linkedAccount = await prisma.account.findFirst({
						where: {
							provider: account.provider,
							providerAccountId: account.providerAccountId,
						},
						select: { userId: true },
					});
					// An identity linked to another account never signs in as this one.
					if (linkedAccount && linkedAccount.userId !== existingUser.id) {
						return "/login?error=OAuthAccountNotLinked";
					}
					// Linking a new identity by email needs a provider-verified email.
					// An identity already linked to this account can always sign in.
					if (!linkedAccount && !emailVouched) {
						return "/login?error=OAuthAccountNotLinked";
					}
					try {
						if (!linkedAccount) {
							await prisma.account.create({
								data: {
									userId: existingUser.id,
									type: account.type,
									provider: account.provider,
									providerAccountId: account.providerAccountId,
									access_token: account.access_token,
									expires_at: account.expires_at,
									id_token: account.id_token,
									refresh_token: account.refresh_token,
									scope: account.scope,
									token_type: account.token_type,
								}
							});
						}

						// Update user info if name/image is missing
						if (!existingUser.name || !existingUser.image) {
							const patch = oauthProfilePatch(account.provider, profile);
							const updateData: { name?: string; image?: string } = {};
							if (!existingUser.name && patch.name) updateData.name = patch.name;
							if (!existingUser.image && patch.image) updateData.image = patch.image;

							if (Object.keys(updateData).length > 0) {
								await asaw(
									updateUser({
										where: { email: user.email },
										data: updateData
									})
								);
							}
						}

					// Set the user ID to the existing user
					user.id = existingUser.id;
				} catch (error) {
					// Use separate parameters to prevent log injection
					console.error('Error linking account for provider:', account.provider, error);
					return false;
				}
				}
				return true;
			}

			return true;
		},
		async session({ session, token }: { session: any; token: any }) {
			try {
				session.user.id = token.id;
				session.user.isInstanceAdmin = token.isInstanceAdmin === true;
			} catch (e) {
				console.log(e);
			}
			return session;
		},
	},
	providers: [
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
		error: "/login", // Redirect errors back to login page
	},
	session: { strategy: "jwt" },
} as AuthOptions;

async function buildAuthOptions(): Promise<AuthOptions> {
	const oauthProviders = await buildOAuthProviders();
	return {
		...authOptions,
		providers: [...oauthProviders, ...authOptions.providers],
	};
}

async function handler(
	req: NextRequest,
	context: { params: { nextauth: string[] } }
) {
	return NextAuth(req, context, await buildAuthOptions());
}

export { handler as GET, handler as POST };