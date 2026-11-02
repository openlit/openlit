jest.mock("@/lib/prisma", () => ({
	__esModule: true,
	default: { user: { findFirst: jest.fn() } },
}));

import prisma from "@/lib/prisma";
import { getInstanceAdminUserId, isInstanceAdminUser } from "@/lib/instance-admin";

const findFirst = prisma.user.findFirst as jest.Mock;

describe("instance admin", () => {
	beforeEach(() => findFirst.mockReset());

	it("picks the earliest account, with id as the tie-break", async () => {
		findFirst.mockResolvedValue({ id: "first-user" });
		await expect(getInstanceAdminUserId()).resolves.toBe("first-user");
		expect(findFirst).toHaveBeenCalledWith({
			orderBy: [{ createdAt: "asc" }, { id: "asc" }],
			select: { id: true },
		});
	});

	it("is only true for the first account", async () => {
		findFirst.mockResolvedValue({ id: "first-user" });
		await expect(isInstanceAdminUser("first-user")).resolves.toBe(true);
		await expect(isInstanceAdminUser("second-user")).resolves.toBe(false);
	});

	it("is false without a user id or when no account exists", async () => {
		await expect(isInstanceAdminUser(undefined)).resolves.toBe(false);
		await expect(isInstanceAdminUser(null)).resolves.toBe(false);
		expect(findFirst).not.toHaveBeenCalled();

		findFirst.mockResolvedValue(null);
		await expect(getInstanceAdminUserId()).resolves.toBeNull();
		await expect(isInstanceAdminUser("someone")).resolves.toBe(false);
	});
});
