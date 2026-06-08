# Security Validation

Use this command before handing off security-sensitive OpenLIT changes.

1. Identify every route touched by the change.
2. Confirm server-side authorization is enforced in each route.
3. Confirm malformed JSON returns `400`, not `500`.
4. Confirm secrets, tokens, cookies, passwords, API keys, and license keys are redacted from logs and audit metadata.
5. Confirm user-facing strings come from `src/client/src/constants/messages/en.ts`.
6. Run:

```bash
cd src/client
npm test -- --runInBand
npm run lint
npx prisma validate --schema prisma/schema.prisma
```
