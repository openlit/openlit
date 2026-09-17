/**
 * Base class for scanner connectors.
 *
 * Every method defaults to throwing `UnsupportedScannerCapabilityError`, so a
 * vendor adapter only implements what its backend actually supports.
 */

import type { ConnectorHealthResult } from "../types";
import {
	UnsupportedScannerCapabilityError,
	type ScannerAdapter,
	type ScannerCapabilities,
	type ScannerJob,
	type ScannerRuntimeInfo,
	type ScannerScanInput,
	type ScannerSourceDescriptor,
} from "./types";

export abstract class BaseScannerAdapter implements ScannerAdapter {
	abstract readonly type: string;
	protected readonly descriptor: ScannerSourceDescriptor;

	constructor(descriptor: ScannerSourceDescriptor) {
		this.descriptor = descriptor;
	}

	abstract capabilities(): ScannerCapabilities;
	abstract healthCheck(): Promise<ConnectorHealthResult>;

	protected unsupported(capability: string): never {
		throw new UnsupportedScannerCapabilityError(this.type, capability);
	}

	async ensureRuntime(_input?: { upgrade?: boolean }): Promise<ScannerRuntimeInfo> {
		this.unsupported("install");
	}

	async scan(_input?: ScannerScanInput): Promise<ScannerJob> {
		this.unsupported("scan");
	}
}
