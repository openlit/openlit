import { getOpenLitEdition } from "@/lib/edition";
import {
	controllerProductDisabledResponse,
	isControllerProductEnabled,
	withControllerProduct,
} from "@/lib/platform/controller/product";

jest.mock("@/lib/edition", () => ({
	getOpenLitEdition: jest.fn(),
}));

const mockedEdition = getOpenLitEdition as jest.MockedFunction<
	typeof getOpenLitEdition
>;

describe("controller product gate", () => {
	beforeEach(() => {
		mockedEdition.mockReset();
	});

	it("is disabled for oss", () => {
		mockedEdition.mockReturnValue("oss");
		expect(isControllerProductEnabled()).toBe(false);
	});

	it("is enabled for enterprise and cloud", () => {
		mockedEdition.mockReturnValue("enterprise");
		expect(isControllerProductEnabled()).toBe(true);
		mockedEdition.mockReturnValue("cloud");
		expect(isControllerProductEnabled()).toBe(true);
	});

	it("returns 404 Not found without calling the handler on oss", async () => {
		mockedEdition.mockReturnValue("oss");
		const handler = jest.fn(async () =>
			Response.json({ ok: true }, { status: 200 })
		);
		const wrapped = withControllerProduct(handler);
		const res = await wrapped();
		expect(handler).not.toHaveBeenCalled();
		expect(res.status).toBe(404);
		await expect(res.json()).resolves.toEqual({ error: "Not found" });
	});

	it("forwards to the handler when enabled", async () => {
		mockedEdition.mockReturnValue("enterprise");
		const handler = jest.fn(async () =>
			Response.json({ ok: true }, { status: 200 })
		);
		const wrapped = withControllerProduct(handler);
		const res = await wrapped();
		expect(handler).toHaveBeenCalledTimes(1);
		expect(res.status).toBe(200);
	});

	it("controllerProductDisabledResponse is a 404 JSON body", async () => {
		const res = controllerProductDisabledResponse();
		expect(res.status).toBe(404);
		await expect(res.json()).resolves.toEqual({ error: "Not found" });
	});
});
