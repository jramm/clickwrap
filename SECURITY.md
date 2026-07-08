# Security policy

## Reporting a vulnerability

Please report security vulnerabilities **privately** — do not open a public GitHub issue for a
security-sensitive report.

*Report a vulnerability* under the **Security** tab for private disclosure.

Please include:

- a description of the vulnerability and its impact,
- steps to reproduce (or a proof of concept),
- affected version/commit and configuration,
- any suggested remediation, if you have one.

## What to expect

- We aim to acknowledge a report within a few business days.
- We will keep you informed about the assessment and the fix timeline.
- Please give us a reasonable window to release a fix before any public disclosure.
- We are happy to credit reporters in the release notes unless you prefer to stay anonymous.

## Scope notes

`clickwrap-server` handles legally relevant acceptance evidence. When deploying it, pay particular
attention to:

- **Service-to-service auth** (`/customers/**`) uses a shared `SERVICE_API_TOKEN` plus forwarded
  context headers — treat it as a trusted-network seam and move to mTLS/JWT for production.
- **Admin auth** relies on Google SSO (`GOOGLE_CLIENT_ID` + `ADMIN_ALLOWED_DOMAIN` /
  `ADMIN_ALLOWED_EMAILS`); the `ADMIN_API_TOKEN` fallback is for dev/CI only.
- **Append-only evidence** integrity in the Prisma driver depends on separating the migration/owner
  DB role from the app runtime role (see [`docs/PERSISTENCE.md`](docs/PERSISTENCE.md)).
