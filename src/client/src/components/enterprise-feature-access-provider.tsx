"use client";

import type { ReactNode } from "react";
import type { EnterpriseFeatureAccessSnapshot } from "@/lib/enterprise-feature-access";

export function EnterpriseFeatureAccessProvider({
	children,
}: {
	children: ReactNode;
	snapshot: EnterpriseFeatureAccessSnapshot;
}) {
	return <>{children}</>;
}

export function EnterpriseFeatureRouteGate({ children }: { children: ReactNode }) {
	return <>{children}</>;
}

export function useEnterpriseFeatureAccess() {
	return {
		accounts: [],
		selectedAccountId: "",
		selectedAccount: null,
		accessByAccountId: {},
		setSelectedAccountId: () => {},
		hasFeatureAccess: () => true,
	};
}
