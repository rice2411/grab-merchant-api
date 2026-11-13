<div align="center">

# grab-merchant-api

**Unofficial Grab Merchant API for Node.js**

Log in to the GrabFood merchant portal, read live and past orders, and manage menu availability and inventory.

[![npm](https://img.shields.io/npm/v/grab-merchant-api)](https://www.npmjs.com/package/grab-merchant-api)
[![license](https://img.shields.io/github/license/rice2411/grab-merchant-api)](LICENSE)
[![node](https://img.shields.io/node/v/grab-merchant-api)](package.json)

</div>

> [!WARNING]
> This project is not affiliated with or endorsed by Grab. It relies on the undocumented APIs behind
> `merchant.grab.com`, which can change at any time. Automating a merchant account may violate Grab's terms —
> use at your own risk.

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Authentication](#authentication)
- [API Reference](#api-reference)
- [Error Handling](#error-handling)
- [Examples](#examples)
- [Contributing](#contributing)
- [Support Us](#support-us)
- [License](#license)

## Features

- 🔐 Portal login through headless Chrome, with OTP and human-solved challenge support
- 🛎️ Live orders from the Orders screen — new orders appear immediately
- 📜 Order history by date range with automatic windowing and pagination
- 🧾 Full order details, fetched in parallel
- 🍔 Menu reading, item and modifier availability toggles
- 📦 Inventory export and bulk upload
- ✅ Mark orders as seen / food ready
- 🔁 Automatic retry on 5xx and network errors
- 📦 Written in TypeScript, ships type definitions — works with both ESM (`import`) and CommonJS (`require`)

## Installation

```bash
npm install grab-merchant-api
```

Requires **Node.js 22+**. The package ships both ESM and CommonJS builds:

```ts
import { GrabClient } from 'grab-merchant-api'; // ESM
const { GrabClient } = require('grab-merchant-api'); // CommonJS
```

Logging in needs a local Chrome or Chromium (found automatically); API calls with a saved session do not.

## Quick Start

```ts
import { GrabClient, PageType, loginGrab } from 'grab-merchant-api';

const session = await loginGrab(
  { username: 'my-store', password: '••••••' },
  { onOtp: async (hint) => askUser(hint) },
);

const grab = new GrabClient(session);

const active = await grab.listActiveOrders(PageType.PREPARING_V2);
const orders = await grab.getOrders(active.map((o) => o.orderID));
```

## Authentication

### Logging in

`loginGrab` fills in the portal login form in headless Chrome and resolves with a `GrabSession`
(`merchantId`, `cookie`, portal `headers`, `userAgent`). Save it and reuse it until it expires.

| Option | Type | Default | Description |
|---|---|---|---|
| `chromePath` | `string` | auto-detect | Path to Chrome / Chromium — defaults to `CHROME_PATH`, then standard install locations |
| `onOtp` | `(hint) => Promise<string>` | — | Return the OTP when Grab asks for one |
| `onChallenge` | `(remote) => void` | — | Grab shows an anti-bot challenge — hand `remote` to a person to solve |
| `challengeMs` | `number` | `300000` | Time allowed for solving the challenge |
| `onEvent` | `(e) => void` | — | Progress: `step` · `otp` · `challenge` |
| `profileDir` | `string` | — | Persistent Chrome profile, so Grab recognises the device |
| `signal` | `AbortSignal` | — | Cancel the login |
| `timeoutMs` | `number` | `180000` | Total login timeout |
| `userAgent` | `string` | — | Browser user agent |

### Challenges

When Grab requires an anti-bot challenge, the library keeps the browser open and passes a `GrabRemote` to
`onChallenge`. Show its screenshots to a person and forward their input — the library never solves challenges itself.

| Method | Description |
|---|---|
| `screenshot()` | JPEG frame of the login page |
| `click(x, y)` | Click at a 0–1 relative position |
| `type(text)` / `key(key)` | Keyboard input |
| `drag(points)` | Replay a drag gesture (slider puzzles) |

### Session lifetime

The access token lasts **2 days** and cannot be refreshed — call `loginGrab` again before `grab.expiresAt()`.

## API Reference

`new GrabClient(session, options?)` — `logger?: (level, msg) => void`, `retryDelaysMs?: number[]` (default `[2000, 5000]`).

### Orders

| Method | Returns | Description |
|---|---|---|
| `listActiveOrders(pageType, { autoAcceptGroup?, size? })` | `GrabActiveOrder[]` | Orders on a tab of the Orders screen |
| `listStatements(from, to, { pageSize?, maxPages? })` | `GrabStatement[]` | Order history, dates as `YYYY-MM-DD` |
| `getOrder(id)` | `object` | Full order details |
| `getOrders(ids)` | `GrabOrderBundle[]` | Details for many orders; one failure doesn't fail the batch |
| `markOrders(ids, status, preparationTaskIDs?)` | `void` | `1` food ready · `2` seen |

`PageType`: `PREPARING` · `PREPARING_V2` · `READY` · `UPCOMING` · `DELIVERING` · `COMPLETED`.

### Menu & inventory

| Method | Returns | Description |
|---|---|---|
| `getMenu()` | `object` | Categories, items and modifier groups |
| `setItemsAvailable(ids, status)` | `void` | `1` available · `2` out until restock · `3` unavailable |
| `setModifiersAvailable(ids, status)` | `void` | `1` available · `2` unavailable |
| `exportInventoryCsv()` | `string` | Current inventory as CSV |
| `uploadInventoryCsv(csv, fileName)` | `string` | Bulk-upload inventory, returns the task id |

Standalone helpers for the exported CSV:

| Function | Returns | Description |
|---|---|---|
| `readInventoryCsv(csv)` | `Map<itemID, { stock, max }>` | Stock per item; empty cells are `null` |
| `patchInventoryCsv(csv, rows)` | `{ csv, changed }` | Write new `CURRENTSTOCK` / `MAXSTOCK`; skip the upload when `changed` is `0` |

```ts
import { patchInventoryCsv } from 'grab-merchant-api';

const { csv, changed } = patchInventoryCsv(await grab.exportInventoryCsv(), [{ itemID: 'A1', qty: 3 }]);
if (changed > 0) await grab.uploadInventoryCsv(csv, 'stock.csv');
```

### Session

| Method | Description |
|---|---|
| `expiresAt()` | Token expiry (epoch ms) |
| `isAlive(today)` | `true` while the session works; `today` is `YYYY-MM-DD` |
| `call(url, { method?, body? })` | Raw authenticated request to `api.grab.com` |
| `tokenExpiresAt(cookie)` · `cookieValue(cookie, name)` | Cookie helpers |

## Error Handling

All library errors are instances of `GrabError` with a `code` (and HTTP `status` when available):

| Code | Meaning |
|---|---|
| `SESSION_EXPIRED` | Token expired (401) — log in again |
| `FORBIDDEN` | Session valid but the action is blocked (403) |
| `HTTP_ERROR` · `NETWORK` · `BAD_RESPONSE` | Request failed |
| `CSV_SHAPE` | Inventory CSV layout not recognised (Grab changed the export format) |
| `LOGIN_FAILED` | Wrong credentials, challenge not solved, Chrome failed to start… |
| `OTP_REQUIRED` | Grab asked for an OTP and `onOtp` was not provided |
| `LOGIN_ABORTED` | Login cancelled through `signal` |

```ts
import { GrabError } from 'grab-merchant-api';

try {
  await grab.listActiveOrders(PageType.READY);
} catch (err) {
  if (err instanceof GrabError && err.code === 'SESSION_EXPIRED') {
    // log in again
  }
}
```

## Examples

| File | What it shows |
|---|---|
| [`login-and-save-session.ts`](examples/login-and-save-session.ts) | Log in and save the session to a JSON file |
| [`poll-new-orders.ts`](examples/poll-new-orders.ts) | Poll the Orders screen every 30 s and print new orders |
| [`toggle-item.ts`](examples/toggle-item.ts) | Mark a menu item available / unavailable |

Run them with `npx tsx examples/<file> …`. Session files hold live cookies — never commit them.

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Protocol notes for maintainers are in
[docs/PROTOCOL.md](docs/PROTOCOL.md).

```bash
npm install
npm test                       # unit tests, no network
npm run build
node scripts/login-smoke.mjs   # interactive login test, prints cookie names only
```

## Support Us

- ⭐ **Star the repository** if you find it useful
- 🔄 **Share** it with others
- 💡 **Contribute** ideas and code
- ☕ **Buy me a coffee** — VietQR (MB Bank · `0776750418`)

<img src=".github/assets/vietqr-mb.png" alt="VietQR MB Bank 0776750418" width="220">

## License

[MIT](LICENSE) © rice2411
