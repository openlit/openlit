import { RootStore } from "@/types/store/root";

export const getAuditLookups = (state: RootStore) => state.audit;

export const getSetAuditLookups = (state: RootStore) => state.audit.setLookups;

export const getResetAuditLookups = (state: RootStore) => state.audit.reset;
