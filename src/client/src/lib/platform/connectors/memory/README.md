# Memory connectors — add-a-vendor checklist

This layer is **vendor-agnostic**: OpenLIT talks to external memory providers
(Claude, Mem0, and Zep today) through one adapter + a self-describing
descriptor. The
shared forms, Prisma `ConnectorInstance` rows, and the connector catalog are
driven by that descriptor, so **adding a new memory vendor must not require
editing shared forms, the schema, or any UI**.

## What a new memory connector needs (and nothing more)

1. **`memory/<vendor>/adapter.ts`** — a class extending `BaseMemoryAdapter`
   that implements the `MemoryAdapter` methods its `capabilities()` advertises.
   Reuse `http.ts` (which calls `http/safe-fetch`) for every outbound call and
   resolve credentials with `http/secret`. Methods for unsupported capabilities
   should throw `UnsupportedMemoryCapabilityError`.    Override `listFilters()` when
   the vendor can enumerate users, sessions, or agents for Memory page dropdowns.
   Typed and used filter ids are also remembered on the connector
   (`metadata.memoryFilters`, stripped from public responses) so vendors without
   an entities API still populate the dropdown.
   Override `feedback()` when the vendor accepts per-memory ratings (Mem0-style
   positive / negative / very negative plus an optional reason).
   Writes (`add` / `update` / `delete`) are exposed on the Memory page,
   `/api/memory`, and Otter chat tools (`list_memories`, `search_memories`,
   `add_memory`, `update_memory`, `delete_memory`) only when `capabilities()`
   advertises them. Copying between connectors (`POST /api/memory/copy`) writes
   `metadata.openlit.port` on the destination and stores the same link on the
   destination connector so the source can be opened later.
   Otter tools call `requireMemoryAccess` /
   `recordMemoryMutationAudit` from `@/lib/access/memory-route` so Enterprise
   RBAC and audit apply the same way as the HTTP routes.
2. **A `describe(): MemoryTypeDescriptor`** on the factory. This is the single
   source of truth for the add/edit form. Set:
   - `type`, `displayName`, `capabilities`
   - `configFields` — reuse `config-fields.ts` helpers (`memoryHttpVendorFields`)
     so labels come from `constants/messages/en.ts`
   - `filterFields` — Memory page filters for this vendor (`memoryPageFilters`).
     Empty means the page shows no user/session/agent controls. Set `allowCustom`
     so operators can type ids the vendor did not enumerate.
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
