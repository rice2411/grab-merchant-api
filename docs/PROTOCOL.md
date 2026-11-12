# Protocol Notes

Reference for maintainers: how the `merchant.grab.com` portal talks to Grab's APIs.

- [Overview](#overview)
- [Session](#session)
- [Login](#login)
- [Orders](#orders)
- [Menu & inventory](#menu--inventory)
- [Debugging](#debugging)

## Overview

| Gateway | Base URL | Used for |
|---|---|---|
| Delivery platform | `https://api.grab.com/delvplatformapi/merchant` | active orders, reports, inventory, bulk tasks |
| Food | `https://api.grab.com/food/merchant` | menu, order details, availability toggles |
| Portal | `https://merchant.grab.com` | web app |
| Login | `https://weblogin.grab.com/merchant/login?service_id=MEXUSERS` | Grab ID login |

`api.grab.com` authenticates by **cookies only** — no IP binding and no request signatures.

## Session

| Cookie | Lifetime | Role |
|---|---|---|
| `mexusers_authn_token` | 2 days | Access token (JWT); expiry → 401 |
| `mexusers_authn_token_jti` | 2 days | CSRF value |
| `sa_MEXUSERS_*` | 30 days | Portal session |
| `grabid-openid-authn-ck` | 3 months | Grab ID |

- **Write requests** must send header `X-CSRF-Token` equal to the `mexusers_authn_token_jti` cookie
  (double-submit); without it Grab returns 403 even with a valid session.
- There is **no refresh path**: on 401 the portal logs out. Clients must log in again before the access token expires.

Portal headers sent with every request:

| Header | Value |
|---|---|
| `requestSource` | `troyPortal` |
| `x-client-id` | `GrabMerchant-Portal` |
| `x-grabkit-clientid` | `grabmerchant-portal` |
| `merchantID` | store id, e.g. `5-XXXXXXXXXXXX` |

## Login

1. Open `weblogin.grab.com/merchant/login?service_id=MEXUSERS` (username / phone / SSO tabs).
2. Grab ID runs a challenge-style flow: `POST api.grab.com/grabid/v1/authnv4/login`, first step sends only
   `accountIdentifier`.
3. Errors appear as page text only — read the HTTP status and `{code}` body of `/grabid/` responses instead
   (e.g. 404 = account not found).
4. `ERROR_CODE_CHALLENGE_SESSION_COMPLETION_REQUIRED` (HTTP 400) means Grab wants an anti-bot challenge;
   the page renders it and a person must solve it.
5. After redirecting to the portal, cookies are set for `.grab.com`.

A persistent Chrome profile keeps Grab ID device cookies between logins, which reduces challenges.

## Orders

### Active orders

```text
GET {delv}/v4/orders-pagination?AutoAcceptGroup=1&merchantID=…&PageType=PreparingV2&searchToken=&size=50
```

| Parameter | Notes |
|---|---|
| `AutoAcceptGroup` | Store's auto-accept setting — a wrong value returns 400 |
| `PageType` | Portal tabs: `PreparingV2`, `Ready`, `Upcoming` |
| `searchToken` | Next page from `nextSearchToken`; `"\|"` means no more pages |

Empty response: `{"orderStats":{},"pollInterval":300,"nextSearchToken":"|"}`.

### History

```text
GET {delv}/v1/reports/daily-pagination
```

Date ranges are limited to 30 days per request.

### Details & marking

| Endpoint | Notes |
|---|---|
| `GET {food}/v3/orders/{id}` | Full order (items, modifiers, fare, customer note) |
| `POST {food}/orders/mark` | Body `{orderIDs, markStatus}` — `1` food ready, `2` seen |

`markStatus 1` must include `preparationTaskIDs` (only returned by `v4/orders-pagination`); without them Grab
returns 204 but the order does not change state. Unknown order ids also return 204.

## Menu & inventory

| Endpoint | Notes |
|---|---|
| `GET {food}/v2/menu` | `categories[].items[]`, `modifierGroups[]` |
| `{food}/v1/items/available-status` · `{food}/v2/modifiers/available` | items: `1` available, `2` out until restock, `3` unavailable · modifiers: `1` / `2` |
| `GET {delv}/v1/inventory/categories/export` | CSV export (3 header rows) |
| `POST {delv}/v1/bulktasks` → upload to presigned URL → `{delv}/v1/bulktasks/{id}/complete-uploading` | Bulk inventory import |

Grab does not automatically disable an item when its stock reaches 0 — toggle availability explicitly.
Retrying `POST /v1/bulktasks` is safe: a task only takes effect after `complete-uploading`.

## Debugging

1. Start Chrome with a remote debugging port, log in to the portal, and capture traffic over CDP.
2. Parameter maps live in the portal's module-federation bundles (`merchant.grab.com/gf/remoteEntry.js`,
   order manager chunk `gf/js/8024.*.js`).
3. Replay the request with only cookies and the portal headers to confirm what the server checks.
