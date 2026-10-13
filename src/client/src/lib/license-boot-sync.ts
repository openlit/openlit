/**
 * CE no-op: enterprise overlays this via `@/lib/*` → `ee/lib/*`.
 * Boot/periodic license sync is an EE-only concern.
 */
export async function syncAllActiveLicensesIfDue(): Promise<{
	ran: boolean;
	organisations: number;
}> {
	return { ran: false, organisations: 0 };
}
