jest.mock("@/lib/session", () => ({ getCurrentUser: jest.fn() }));
jest.mock("@/lib/instance-admin", () => ({ isInstanceAdminUser: jest.fn() }));

import { getCurrentUser } from "@/lib/session";
import { isInstanceAdminUser } from "@/lib/instance-admin";
import { withInstanceAdmin } from "@/lib/instance-admin/route";

class TestResponse {
	constructor(private body: unknown, public status = 200) {}
	static json(body: unknown, init?: { status?: number }) {
		return new TestResponse(body, init?.status);
	}
	async json() {
		return this.body;
	}
}

describe("withInstanceAdmin", () => {
	const originalResponse = global.Response;
	const handler = jest.fn(async (_request: Request, _context: unknown) => TestResponse.json({ ok: true }) as unknown as Response);
	const wrapped = withInstanceAdmin(handler);
	const request = {} as Request;

	beforeAll(() => {
		(global as any).Response = TestResponse;
	});
	afterAll(() => {
		(global as any).Response = originalResponse;
	});
	beforeEach(() => jest.clearAllMocks());

	it("returns 401 without a signed-in user", async () => {
		(getCurrentUser as jest.Mock).mockResolvedValue(null);
		const response = await wrapped(request, {});
		expect(response.status).toBe(401);
		expect(handler).not.toHaveBeenCalled();
	});

	it("returns 403 for a user who is not the instance admin", async () => {
		(getCurrentUser as jest.Mock).mockResolvedValue({ id: "member" });
		(isInstanceAdminUser as jest.Mock).mockResolvedValue(false);
		const response = await wrapped(request, {});
		expect(response.status).toBe(403);
		expect(isInstanceAdminUser).toHaveBeenCalledWith("member");
		expect(handler).not.toHaveBeenCalled();
	});

	it("calls the handler for the instance admin", async () => {
		(getCurrentUser as jest.Mock).mockResolvedValue({ id: "admin" });
		(isInstanceAdminUser as jest.Mock).mockResolvedValue(true);
		const response = await wrapped(request, { params: {} });
		expect(response.status).toBe(200);
		expect(handler).toHaveBeenCalledWith(request, { params: {} });
	});
});
