**Issue number**:
Closes # 

### Change description:
This PR implements client-wide OpenAPI specification documentation, centralizes Bearer token/API Key authentication at the Next.js middleware level, and introduces an interactive OpenAPI Spec UI on the settings dashboard.

#### Key Enhancements:
1. **Traces & Exceptions Telemetry in OpenAPI Spec**:
   * Added OpenAPI definitions and schema documentation for the traces retrieval API `/api/metrics/request` and the exceptions retrieval API `/api/metrics/exception`.
   * Updated the route handlers to validate keys using the centralized `resolveDbConfigId` helper and correctly forward the resolved `databaseConfigId` down to the ClickHouse `dataCollector`.
   * Added the two telemetry endpoints to the dashboard's interactive API Reference explorer (`query-traces` and `query-exceptions`).

2. **Edge-Compatible Middleware Authorization**:
   * Intercepts requests containing an `Authorization: Bearer <API_KEY>` header inside the Next.js auth middleware (`check-auth.ts`).
   * **No-Prisma Edge Sandbox Safety**: To prevent Edge runtime bundling and native driver errors (which occur when importing Prisma/SQLite into Next.js middleware), we created a dedicated Node.js verification API route `/api/auth/verify-key`. The middleware securely resolves key validation using a `fetch` loopback request.
   * Restricts token authentication checks to paths registered under the `ALLOWED_OPENLIT_ROUTES_WITH_TOKEN` and `ALLOWED_OPENLIT_ROUTE_PREFIXES_WITH_TOKEN` (including `/api/metrics/`) constants defined in `route.ts`.
   * Returns a clean `401 Unauthorized` JSON response for unauthenticated API requests instead of redirecting them to the `/login` HTML page.

3. **Unified Page Header Height & Tabs Removal**:
   * Removed the API Keys sub-route tabs block completely, solving the header height discrepancy. The API keys settings page now matches the exact same header height and styling as all other playground pages.
   * Added a clean link button with a `BookOpen` icon in the API keys page header actions section that points directly to `/openapi-spec`.

4. **Simplified and Unified Route Handlers**:
   * Implemented a unified `resolveDbConfigId` utility function in `auth.ts` to handle DB config resolution from headers/session.
   * Updated all 9 telemetry API handlers (under `src/client/src/app/api/telemetry/`) and the rule engine evaluate handler (`evaluate/route.ts`) to use the unified helper, removing duplicate auth checking code.
   * Optimized the controller poll handler (`poll/route.ts`) to read the middleware header directly, avoiding redundant database lookup queries.

5. **Correct Config Script Loading Order**:
   * Swapped the loading order in `api-docs.html` so that configuration (system dark mode, custom styling, default themes) is fully applied to the DOM node *before* the Scalar CDN script is executed and initialises, preventing configuration bypass bugs.

6. **Internationalization (i18n)**:
   * Localized all newly introduced user-facing UI strings in `en.ts`.

### Checklist

* [ ] PR name follows conventional commit format: `feat: ...` or `fix: ....`
* [x] I have reviewed the [contributing guidelines](https://github.com/openlit/openlit/blob/main/CONTRIBUTING.md)
* [x] Have you checked to ensure there aren't other open [Pull Requests](https://github.com/openlit/openlit/pulls) for the same update/change?
* [x] I have performed a self-review of this change
* [x] Changes have been tested
* [x] Changes are documented

### Acknowledgment

By submitting this pull request, I confirm that you can use, modify, copy, and redistribute this contribution, under the terms of the [project license](https://github.com/openlit/openlit/blob/main/LICENSE).
