/**
 * Memory connector contract.
 *
 * Memory adapters are the category-specific runtime behind `category: "memory"`
 * connector instances. Vendors implement only the operations their
 * `capabilities()` advertise; the rest throw `UnsupportedMemoryCapabilityError`
 * so product surfaces can gate honestly instead of guessing.
 */

import type { ConnectorHealthResult, ConnectorRuntime } from "../types";
import type { AuthStyle, FieldDef } from "../datasource/types";

export interface MemoryCapabilities {
	add: boolean;
	search: boolean;
	get: boolean;
	list: boolean;
	update: boolean;
	delete: boolean;
}

export interface MemoryMessage {
	role: string;
	content: string;
}

export interface MemoryHistoryEvent {
	id?: string;
	event: string;
	input?: MemoryMessage[];
	oldMemory?: string;
	newMemory?: string;
	createdAt?: string;
	actorId?: string;
}

export interface MemoryRecord {
	id: string;
	content: string;
	userId?: string;
	agentId?: string;
	sessionId?: string;
	appId?: string;
	metadata?: Record<string, unknown>;
	categories?: string[];
	input?: MemoryMessage[];
	history?: MemoryHistoryEvent[];
	score?: number;
	createdAt?: string;
	updatedAt?: string;
	expirationDate?: string;
	structuredAttributes?: Record<string, unknown>;
	synthesized?: boolean;
	lifecycleState?: string;
}

export interface MemoryWriteInput {
	content?: string;
	messages?: MemoryMessage[];
	userId?: string;
	agentId?: string;
	sessionId?: string;
	metadata?: Record<string, unknown>;
}

export interface MemoryUpdateInput {
	content: string;
	metadata?: Record<string, unknown>;
}

export interface MemorySearchQuery {
	query: string;
	userId?: string;
	agentId?: string;
	sessionId?: string;
	limit?: number;
	threshold?: number;
}

export interface MemoryListFilter {
	userId?: string;
	agentId?: string;
	sessionId?: string;
	limit?: number;
}

export interface MemoryFilterChoice {
	id: string;
	label: string;
	userId?: string;
}

export interface MemoryFilterOptions {
	users: MemoryFilterChoice[];
	sessions: MemoryFilterChoice[];
	agents: MemoryFilterChoice[];
}

export type MemoryQueryHint = "session_required" | "filter_required";

export function emptyMemoryFilters(): MemoryFilterOptions {
	return { users: [], sessions: [], agents: [] };
}

export interface MemorySourceDescriptor {
	type: string;
	id: string;
	settings: Record<string, unknown>;
	secretRef?: string | null;
	projectId?: string | null;
	name: string;
	environment?: string;
}

export interface MemoryTypeDescriptor {
	type: string;
	displayName: string;
	description?: string;
	internal?: boolean;
	icon?: string;
	capabilities: MemoryCapabilities;
	configFields: FieldDef[];
	authStyle: AuthStyle;
	authHelp?: string;
	docsUrl?: string;
}

export interface MemoryAdapter extends ConnectorRuntime {
	readonly type: string;
	capabilities(): MemoryCapabilities;
	healthCheck(): Promise<ConnectorHealthResult>;
	add(input: MemoryWriteInput): Promise<MemoryRecord[]>;
	search(query: MemorySearchQuery): Promise<MemoryRecord[]>;
	get(id: string): Promise<MemoryRecord | null>;
	list(filter: MemoryListFilter): Promise<MemoryRecord[]>;
	listFilters(): Promise<MemoryFilterOptions>;
	update(id: string, input: MemoryUpdateInput): Promise<MemoryRecord>;
	delete(id: string): Promise<void>;
}

export interface MemoryAdapterFactory {
	type: string;
	create(descriptor: MemorySourceDescriptor): MemoryAdapter;
	describe(): MemoryTypeDescriptor;
}

export class UnsupportedMemoryCapabilityError extends Error {
	readonly capability: string;
	readonly sourceType: string;
	constructor(sourceType: string, capability: string, message?: string) {
		super(
			message ||
				`Capability "${capability}" is not supported by memory connector "${sourceType}".`
		);
		this.name = "UnsupportedMemoryCapabilityError";
		this.capability = capability;
		this.sourceType = sourceType;
	}
}
