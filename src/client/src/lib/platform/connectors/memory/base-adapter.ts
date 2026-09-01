/**
 * Base class for memory connectors.
 *
 * Every method defaults to throwing `UnsupportedMemoryCapabilityError`, so a
 * vendor adapter only implements what its backend actually supports.
 */

import type { ConnectorHealthResult } from "../types";
import {
	UnsupportedMemoryCapabilityError,
	type MemoryAdapter,
	type MemoryCapabilities,
	emptyMemoryFilters,
	type MemoryFeedback,
	type MemoryFeedbackInput,
	type MemoryFilterOptions,
	type MemoryListFilter,
	type MemoryRecord,
	type MemorySearchQuery,
	type MemorySourceDescriptor,
	type MemoryUpdateInput,
	type MemoryWriteInput,
} from "./types";

export abstract class BaseMemoryAdapter implements MemoryAdapter {
	abstract readonly type: string;
	protected readonly descriptor: MemorySourceDescriptor;

	constructor(descriptor: MemorySourceDescriptor) {
		this.descriptor = descriptor;
	}

	abstract capabilities(): MemoryCapabilities;
	abstract healthCheck(): Promise<ConnectorHealthResult>;

	protected unsupported(capability: string): never {
		throw new UnsupportedMemoryCapabilityError(this.type, capability);
	}

	async add(_input: MemoryWriteInput): Promise<MemoryRecord[]> {
		this.unsupported("add");
	}

	async search(_query: MemorySearchQuery): Promise<MemoryRecord[]> {
		this.unsupported("search");
	}

	async get(_id: string): Promise<MemoryRecord | null> {
		this.unsupported("get");
	}

	async list(_filter: MemoryListFilter): Promise<MemoryRecord[]> {
		this.unsupported("list");
	}

	async listFilters(): Promise<MemoryFilterOptions> {
		return emptyMemoryFilters();
	}

	async update(_id: string, _input: MemoryUpdateInput): Promise<MemoryRecord> {
		this.unsupported("update");
	}

	async delete(_id: string): Promise<void> {
		this.unsupported("delete");
	}

	async feedback(_id: string, _input: MemoryFeedbackInput): Promise<MemoryFeedback> {
		this.unsupported("feedback");
	}
}
