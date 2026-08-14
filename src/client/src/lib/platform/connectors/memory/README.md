# Memory connectors — add-a-vendor checklist

This layer is **vendor-agnostic**: OpenLIT talks to external memory providers
(Mem0 and Zep today) through one adapter + a self-describing descriptor. The
shared forms, Prisma `ConnectorInstance` rows, and the connector catalog are
driven by that descriptor, so **adding a new memory vendor must not require
editing shared forms, the schema, or any UI**.

## What a new memory connector needs (and nothing more)

1. **`memory/<vendor>/adapter.ts`** — a class extending `BaseMemoryAdapter`
   that implements the `MemoryAdapter` methods its `capabilities()` advertises.
   Reuse `http.ts` (which calls `http/safe-fetch`) for every outbound call and
   resolve credentials with `http/secret`. Methods for unsupported capabilities
   should throw `UnsupportedMemoryCapabilityError`. Override `listFilters()` when
   the vendor can enumerate users, sessions, or agents for Memory page dropdowns.
2. **A `describe(): MemoryTypeDescriptor`** on the factory. This is the single
   source of truth for the add/edit form. Set:
   - `type`, `displayName`, `capabilities`
   - `configFields` — reuse `config-fields.ts` helpers (`memoryHttpVendorFields`)
     so labels come from `constants/messages/en.ts`
   - `authStyle` (`"api-key"` for hosted memory APIs) plus optional `authHelp`
     and `docsUrl`
3. **Register the factory** in `bootstrap.ts` (`VENDOR_FACTORIES`), or ship it
   from the private repo via the `getExternalMemoryAdapters()` hook for
   EE-only vendors.

Credentials are encrypted onto `ConnectorInstance.secretRef` (`enc:v1:…`) so
memory connectors do not depend on the ClickHouse vault.

## What you must NOT touch

- No new form fields in `data-sources-page.tsx` — it renders `configFields`.
- No Prisma migration or enum — `ConnectorInstance.type` is a free string and
  `category` is `"memory"`.
- No per-vendor `switch` anywhere — capability gating + descriptors handle it.
- No `@/ee/**` import from CE; keep vendor strings in `constants/messages/en.ts`.
