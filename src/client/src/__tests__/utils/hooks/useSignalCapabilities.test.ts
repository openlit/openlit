import { renderHook, waitFor, act } from "@testing-library/react";
import {
	useSignalCapabilities,
	__clearSignalCapabilitiesCache,
	type SignalCapabilities,
} from "@/utils/hooks/useSignalCapabilities";

const sampleCapabilities: SignalCapabilities = {
	traces: {
		sourceType: "clickhouse",
		sourceName: "default",
		isBuiltIn: true,
		capabilities: { traceTree: true },
	},
	logs: null,
	metrics: null,
};

function mockFetchOnce(body: unknown, ok = true) {
	(global.fetch as jest.Mock).mockResolvedValueOnce({
		ok,
		json: async () => body,
	});
}

describe("useSignalCapabilities", () => {
	beforeEach(() => {
		__clearSignalCapabilitiesCache();
		global.fetch = jest.fn();
	});

	it("starts in a loading state with null capabilities when uncached", async () => {
		mockFetchOnce({ signalCapabilities: sampleCapabilities });
		const { result } = renderHook(() => useSignalCapabilities());
		expect(result.current.loading).toBe(true);
		expect(result.current.capabilities).toBeNull();

		await waitFor(() => expect(result.current.loading).toBe(false));
	});

	it("resolves capabilities from a successful fetch", async () => {
		mockFetchOnce({ signalCapabilities: sampleCapabilities });
		const { result } = renderHook(() => useSignalCapabilities());

		await waitFor(() => expect(result.current.loading).toBe(false));

		expect(result.current.capabilities).toEqual(sampleCapabilities);
		expect(global.fetch).toHaveBeenCalledWith("/api/telemetry-source");
	});

	it("appends the environment query param when provided", async () => {
		mockFetchOnce({ signalCapabilities: sampleCapabilities });
		const { result } = renderHook(() => useSignalCapabilities("prod"));

		await waitFor(() => expect(result.current.loading).toBe(false));

		expect(global.fetch).toHaveBeenCalledWith(
			"/api/telemetry-source?environment=prod"
		);
		expect(result.current.capabilities).toEqual(sampleCapabilities);
	});

	it("resolves to null capabilities when the response is not ok", async () => {
		mockFetchOnce({ signalCapabilities: sampleCapabilities }, false);
		const { result } = renderHook(() => useSignalCapabilities());

		await waitFor(() => expect(result.current.loading).toBe(false));

		expect(result.current.capabilities).toBeNull();
	});

	it("resolves to null when the fetch throws", async () => {
		(global.fetch as jest.Mock).mockRejectedValueOnce(new Error("network down"));
		const { result } = renderHook(() => useSignalCapabilities());

		await waitFor(() => expect(result.current.loading).toBe(false));

		expect(result.current.capabilities).toBeNull();
	});

	it("falls back to null when the body has no signalCapabilities field", async () => {
		mockFetchOnce({});
		const { result } = renderHook(() => useSignalCapabilities());

		await waitFor(() => expect(result.current.loading).toBe(false));

		expect(result.current.capabilities).toBeNull();
	});

	it("falls back to null when the response body itself is nullish", async () => {
		mockFetchOnce(null);
		const { result } = renderHook(() => useSignalCapabilities());

		await waitFor(() => expect(result.current.loading).toBe(false));

		expect(result.current.capabilities).toBeNull();
	});

	it("serves a second mount from the module cache without a new fetch", async () => {
		mockFetchOnce({ signalCapabilities: sampleCapabilities });
		const first = renderHook(() => useSignalCapabilities());
		await waitFor(() => expect(first.result.current.loading).toBe(false));
		expect(global.fetch).toHaveBeenCalledTimes(1);

		const second = renderHook(() => useSignalCapabilities());
		expect(second.result.current.loading).toBe(false);
		expect(second.result.current.capabilities).toEqual(sampleCapabilities);
		await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
	});

	it("dedupes concurrent in-flight requests for the same environment", async () => {
		let resolveFetch: (value: unknown) => void = () => {};
		(global.fetch as jest.Mock).mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveFetch = resolve;
				})
		);

		const a = renderHook(() => useSignalCapabilities("dev"));
		const b = renderHook(() => useSignalCapabilities("dev"));

		expect(global.fetch).toHaveBeenCalledTimes(1);

		await act(async () => {
			resolveFetch({
				ok: true,
				json: async () => ({ signalCapabilities: sampleCapabilities }),
			});
			await Promise.resolve();
			await Promise.resolve();
		});

		await waitFor(() => expect(a.result.current.loading).toBe(false));
		await waitFor(() => expect(b.result.current.loading).toBe(false));
		expect(a.result.current.capabilities).toEqual(sampleCapabilities);
		expect(b.result.current.capabilities).toEqual(sampleCapabilities);
	});

	it("re-fetches when the environment argument changes", async () => {
		mockFetchOnce({ signalCapabilities: sampleCapabilities });
		const { result, rerender } = renderHook(
			({ environment }: { environment?: string }) =>
				useSignalCapabilities(environment),
			{ initialProps: { environment: undefined as string | undefined } }
		);
		await waitFor(() => expect(result.current.loading).toBe(false));
		expect(global.fetch).toHaveBeenCalledTimes(1);

		mockFetchOnce({ signalCapabilities: sampleCapabilities });
		rerender({ environment: "staging" });
		await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
		expect(global.fetch).toHaveBeenLastCalledWith(
			"/api/telemetry-source?environment=staging"
		);
	});

	it("does not update state after unmount once the fetch resolves", async () => {
		let resolveFetch: (value: unknown) => void = () => {};
		(global.fetch as jest.Mock).mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveFetch = resolve;
				})
		);

		const { unmount } = renderHook(() => useSignalCapabilities("unmount-env"));
		unmount();

		await act(async () => {
			resolveFetch({
				ok: true,
				json: async () => ({ signalCapabilities: sampleCapabilities }),
			});
			await Promise.resolve();
			await Promise.resolve();
		});
		// No assertion beyond "did not throw" — the effect's cleanup flips
		// `active` to false so the late resolution is a no-op.
	});
});
