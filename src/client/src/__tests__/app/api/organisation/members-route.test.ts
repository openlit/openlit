jest.mock("@/lib/organisation", () => ({
	removeUserFromOrganisation: jest.fn(),
	updateMemberRole: jest.fn(),
}));

import { PATCH } from "@/app/api/organisation/[id]/members/[userId]/route";
import { updateMemberRole } from "@/lib/organisation";

const params = { params: Promise.resolve({ id: "org1", userId: "u2" }) };

(globalThis as unknown as { Response: { json: unknown } }).Response = {
	json: (body: unknown, init?: ResponseInit) => ({
		status: init?.status ?? 200,
		json: async () => body,
	}),
};

function request(json: () => Promise<unknown>) {
	return { json: jest.fn(json) } as unknown as Request;
}

describe("PATCH /api/organisation/[id]/members/[userId]", () => {
	beforeEach(() => jest.clearAllMocks());

	it("returns 400 for invalid JSON instead of throwing", async () => {
		const res = await PATCH(
			request(() => Promise.reject(new SyntaxError("Unexpected token"))),
			params
		);

		expect(res.status).toBe(400);
		expect(updateMemberRole).not.toHaveBeenCalled();
	});

	it("returns 400 when the role is missing", async () => {
		const res = await PATCH(request(() => Promise.resolve({})), params);

		expect(res.status).toBe(400);
		expect(updateMemberRole).not.toHaveBeenCalled();
	});

	it("updates the member role", async () => {
		(updateMemberRole as jest.Mock).mockResolvedValue({ success: true });

		const res = await PATCH(
			request(() => Promise.resolve({ role: "admin" })),
			params
		);

		expect(res.status).toBe(200);
		expect(updateMemberRole).toHaveBeenCalledWith("org1", "u2", "admin");
	});
});
