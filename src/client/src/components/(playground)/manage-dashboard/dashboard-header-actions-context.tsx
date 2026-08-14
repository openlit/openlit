"use client";

import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
	type ReactNode,
} from "react";

export type DashboardHeaderActions = {
	onCreate: () => void;
	onImport?: (data: unknown) => Promise<unknown>;
};

type DashboardHeaderActionsContextValue = {
	actions: DashboardHeaderActions | null;
	register: (actions: DashboardHeaderActions | null) => void;
};

const DashboardHeaderActionsContext =
	createContext<DashboardHeaderActionsContextValue | null>(null);

export function DashboardHeaderActionsProvider({
	children,
}: {
	children: ReactNode;
}) {
	const [actions, setActions] = useState<DashboardHeaderActions | null>(null);
	const register = useCallback((next: DashboardHeaderActions | null) => {
		setActions(next);
	}, []);
	const value = useMemo(() => ({ actions, register }), [actions, register]);

	return (
		<DashboardHeaderActionsContext.Provider value={value}>
			{children}
		</DashboardHeaderActionsContext.Provider>
	);
}

export function useDashboardHeaderActions() {
	const context = useContext(DashboardHeaderActionsContext);
	if (!context) {
		throw new Error(
			"useDashboardHeaderActions must be used within DashboardHeaderActionsProvider"
		);
	}
	return context;
}

export function useRegisterDashboardHeaderActions(
	actions: DashboardHeaderActions | null
) {
	const { register } = useDashboardHeaderActions();

	useEffect(() => {
		register(actions);
		return () => register(null);
	}, [actions, register]);
}
