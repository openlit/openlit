"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Per-user "My apps" customization.
 *
 * By default every app from the Apps panel is shown in the inline
 * "My apps" section. We only persist the *delta* — the set of app links
 * the user has removed — so a typical user stores a handful of short
 * strings (tens of bytes). Opening a removed app un-hides it again.
 *
 * Storage is localStorage namespaced by user id, matching how OpenLIT
 * already persists column-visibility and filter preferences.
 */

const STORAGE_PREFIX = "openlit:my-apps-hidden:";

type SidebarPreferences = {
	hidden: string[];
};

function storageKeyFor(userId?: string) {
	return userId ? `${STORAGE_PREFIX}${userId}` : null;
}

function readPreferences(key: string | null): SidebarPreferences {
	if (!key || typeof window === "undefined") return { hidden: [] };
	try {
		const raw = window.localStorage.getItem(key);
		if (!raw) return { hidden: [] };
		const parsed = JSON.parse(raw);
		const hidden = Array.isArray(parsed?.hidden)
			? parsed.hidden.filter((link: unknown): link is string => typeof link === "string")
			: [];
		return { hidden };
	} catch {
		return { hidden: [] };
	}
}

export function useSidebarPreferences(userId?: string) {
	const key = storageKeyFor(userId);
	const [hidden, setHidden] = useState<string[]>([]);
	const [loaded, setLoaded] = useState(false);

	useEffect(() => {
		setHidden(readPreferences(key).hidden);
		setLoaded(Boolean(key));
	}, [key]);

	const update = useCallback(
		(updater: (previous: string[]) => string[]) => {
			setHidden((previous) => {
				const next = updater(previous);
				if (next === previous) return previous;
				if (key) {
					window.localStorage.setItem(key, JSON.stringify({ hidden: next }));
				}
				return next;
			});
		},
		[key]
	);

	const hide = useCallback(
		(link: string) =>
			update((previous) => (previous.includes(link) ? previous : [...previous, link])),
		[update]
	);

	const show = useCallback(
		(link: string) => update((previous) => previous.filter((item) => item !== link)),
		[update]
	);

	const toggle = useCallback(
		(link: string) =>
			update((previous) =>
				previous.includes(link)
					? previous.filter((item) => item !== link)
					: [...previous, link]
			),
		[update]
	);

	const isHidden = useCallback((link: string) => hidden.includes(link), [hidden]);

	return { hidden, loaded, isHidden, hide, show, toggle };
}
