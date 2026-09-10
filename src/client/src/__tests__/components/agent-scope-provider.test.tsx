import { render } from "@testing-library/react";
import AgentScopeProvider, {
	useIsAgentScoped,
} from "@/components/(playground)/agents/agent-scope-provider";
import { useRootStore } from "@/store";

function ScopeProbe() {
	const scoped = useIsAgentScoped();
	return <div data-testid="probe">{scoped ? "scoped" : "global"}</div>;
}

const serviceNames = (): string[] =>
	(useRootStore.getState().filter.details.selectedConfig?.serviceNames as
		| string[]
		| undefined) ?? [];

describe("AgentScopeProvider scope lock", () => {
	beforeEach(() => {
		// Reset any leftover scope between tests.
		useRootStore
			.getState()
			.filter.updateFilter("selectedConfig", {}, { clearFilter: true });
	});

	it("locks serviceNames on mount and clears the lock on unmount", () => {
		expect(serviceNames()).toEqual([]);

		const { getByTestId, unmount } = render(
			<AgentScopeProvider serviceName="demo-openai-app">
				<ScopeProbe />
			</AgentScopeProvider>
		);

		// Lock applied synchronously (layout effect) so children render scoped.
		expect(getByTestId("probe")).toHaveTextContent("scoped");
		expect(serviceNames()).toEqual(["demo-openai-app"]);

		// Restore runs in a layout-effect cleanup, so the agent scope is gone the
		// moment the page unmounts — before the next route (e.g. Telemetry) can
		// issue a query. This is what keeps the global list showing every service.
		unmount();
		expect(serviceNames()).toEqual([]);
	});

	it("does not leak one agent's scope into the next", () => {
		const first = render(
			<AgentScopeProvider serviceName="demo-openai-app">
				<ScopeProbe />
			</AgentScopeProvider>
		);
		expect(serviceNames()).toEqual(["demo-openai-app"]);
		first.unmount();
		expect(serviceNames()).toEqual([]);

		const second = render(
			<AgentScopeProvider serviceName="demo-anthropic-app">
				<ScopeProbe />
			</AgentScopeProvider>
		);
		expect(serviceNames()).toEqual(["demo-anthropic-app"]);
		second.unmount();
		expect(serviceNames()).toEqual([]);
	});

	it("useIsAgentScoped is false outside any provider", () => {
		const { getByTestId } = render(<ScopeProbe />);
		expect(getByTestId("probe")).toHaveTextContent("global");
	});
});
