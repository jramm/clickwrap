# Main-Portal Provider-Groups endpoint (clickwrap customer source)

This is the **system-to-system contract** for the endpoint the Main-Portal (metergrid) team must
expose so that clickwrap-server can sync **Provider Groups** as clickwrap customers.

## Why

Provider Groups are the legal entities that use the Main Portal and must accept the AGB. The
clickwrap `mainportal` customer source (`CUSTOMER_SOURCE=mainportal`) is the source of truth for
**who must accept**: it pulls the full set of provider groups every 12 hours and reconciles them
into clickwrap (create / update / soft-delete). This replaces the metergrid/Game source as the
source of truth for AGB acceptance. Each provider group becomes one clickwrap customer; its MANAGER
users become the contact recipients.

The clickwrap side is already built (against a **mocked** endpoint). The Main-Portal team owns and
builds the actual endpoint below. Only the response shape and auth are load-bearing — the path is
configurable on the clickwrap side (`MAINPORTAL_PROVIDER_GROUPS_PATH`) so it can be finalised here.

## Authentication

Reuse the Main Portal's existing `api_system` service-auth pattern (`SystemAPIAuth`, Bearer
`system_api` JWT):

- **Header:** `Authorization: Bearer <system_api token>`
- **Scope (new):** `provider_group:read` — the token must carry this scope; reject with `403`
  otherwise.
- clickwrap sends `accept: application/json`. The token is stored in the clickwrap deployment env
  (`MAINPORTAL_API_TOKEN`) and is **never logged** by clickwrap.

## Endpoint

```
GET {MAINPORTAL_BASE_URL}{MAINPORTAL_PROVIDER_GROUPS_PATH}
```

- Proposed path: `/system/v1/provider-groups` (configurable on the clickwrap side).
- `MAINPORTAL_BASE_URL` is the Main-Portal origin, e.g. `https://app.metergrid.de`.

### Semantics

- Return **ALL provider groups that are NOT merged** — exclude any group with `merged_into != null`.
  A group that becomes merged (or is deleted) simply drops out of the response; clickwrap
  soft-deletes it by absence (the evidence chain is preserved).
- Each group carries its **MANAGER users**: all users with `ProviderGroupAccess.role == MANAGER`.
  There is no OWNER role in the Main Portal — MANAGER is the top role, so the managers are the
  "owner(s)" who must accept the AGB. A group with no managers is still returned (clickwrap imports
  it with an empty contact list).

### Data mapping (Django → response)

| Response field           | Source                                                             |
| ------------------------ | ------------------------------------------------------------------ |
| `id`                     | `ProviderGroup.id`                                                 |
| `name`                   | `ProviderGroup.name`                                               |
| `managers[]`             | `ProviderGroupAccess(role=MANAGER)` → `users.User`                 |
| `managers[].email`       | `User.email`                                                       |
| `managers[].firstName`   | `User.first_name` (nullable)                                       |
| `managers[].lastName`    | `User.last_name` (nullable)                                        |

### Response JSON

```json
{
  "items": [
    {
      "id": 1234,
      "name": "Stadtwerke Beispiel GmbH",
      "managers": [
        { "email": "manager-a@example.test", "firstName": "Ada", "lastName": "Tester" },
        { "email": "manager-b@example.test", "firstName": null, "lastName": null }
      ]
    }
  ],
  "next": null
}
```

- `items` — the (current page of) non-merged provider groups.
- `firstName` / `lastName` — `string | null` (nullable in the source).
- `email` — always a non-empty string.

### Pagination (proposed: `next` cursor)

Optional. Two supported shapes; **propose the `next` link**:

- **`next` link (recommended):** `next` is either `null`/absent (last page) or an opaque URL to GET
  for the next page — an absolute URL, or a path/query relative to `MAINPORTAL_BASE_URL` (e.g.
  `/system/v1/provider-groups?cursor=abc`). clickwrap follows `next` until it is `null`.
- **Alternative `?limit=&offset=`:** if you prefer offset paging, still return a `next` link that
  encodes the next `?limit=&offset=` query so the clickwrap side needs no change.

The clickwrap plugin starts with a single call and follows `next` if the response carries one, so a
non-paginated endpoint that always returns `{ "items": [...], "next": null }` is valid.

## clickwrap-side configuration

| Env var                          | Default                       | Meaning                                          |
| -------------------------------- | ----------------------------- | ------------------------------------------------ |
| `CUSTOMER_SOURCE`                | `none`                        | Set to `mainportal` to activate this source.     |
| `MAINPORTAL_BASE_URL`            | *(required)*                  | Main-Portal origin. Boot error if missing.       |
| `MAINPORTAL_API_TOKEN`           | *(required)*                  | `system_api` bearer token. Boot error if missing; never logged. |
| `MAINPORTAL_PROVIDER_GROUPS_PATH`| `/system/v1/provider-groups`  | Endpoint path (configurable until finalised).    |
| `CUSTOMER_SYNC_DEFAULT_ROLES`    | *(empty)*                     | Set `customer` so imported groups get the customer audience. |
| `CUSTOMER_SYNC_WON_ACCEPT_TYPES` | *(empty)*                     | **Leave EMPTY** — provider groups are imported PENDING and must still accept the AGB (that is the point). Do NOT auto-accept. |

Because `CUSTOMER_SYNC_WON_ACCEPT_TYPES` is empty for this source, imported provider groups come in
**PENDING** and go through the normal rollout so they must accept the AGB. This is purely a
deployment env choice; no code change is involved.

Reference implementation:
[`src/plugins/customer-source/mainportal/mainportal.source.ts`](../../src/plugins/customer-source/mainportal/mainportal.source.ts)
and the built-in
[`src/plugins/builtins/mainportal-customer-source.plugin.ts`](../../src/plugins/builtins/mainportal-customer-source.plugin.ts).
