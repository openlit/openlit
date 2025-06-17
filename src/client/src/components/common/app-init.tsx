"use client";

import { useEffect } from "react";
import { fetchAndPopulateCurrentUserStore } from "@/helpers/client/user";
import { getIsUserFetched } from "@/selectors/user";
import { useRootStore } from "@/store";

export default function AppInit() {
	const isFetched = useRootStore(getIsUserFetched);
	useEffect(() => {
		if (!isFetched) fetchAndPopulateCurrentUserStore();
	}, [isFetched]);

	// Top-level effect: set pingStatus for demo accounts
	useEffect(() => {
		if (typeof window !== 'undefined') {
			const isDemo = localStorage.getItem('isDemoAccount') === 'true';
			if (isDemo) {
				const currentStatus = useRootStore.getState().databaseConfig.ping.status;
				if (currentStatus !== 'success') {
					useRootStore.getState().databaseConfig.setPing({ status: 'success' });
					console.log('[AppInit Debug] Patched pingStatus to success for demo account (top-level effect)');
				}
			}
		}
	}, []);

	return null;
}
