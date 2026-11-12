/**
 * Poll the Orders screen every 30 seconds and print new order ids.
 *
 *   npx tsx examples/poll-new-orders.ts ./session.json
 *
 * Create the session file first with examples/login-and-save-session.ts.
 */
import { readFile } from 'node:fs/promises';
import { GrabClient, GrabError, PageType, type GrabSession } from 'grab-merchant-api';

const sessionPath = process.argv[2];
if (!sessionPath) {
  console.error('Usage: npx tsx examples/poll-new-orders.ts <session.json>');
  process.exit(1);
}

const session = JSON.parse(await readFile(sessionPath, 'utf8')) as GrabSession;
const grab = new GrabClient(session, { logger: (level, msg) => console.log(`[${level}] ${msg}`) });
const seen = new Set<string>();
const tabs = [PageType.PREPARING_V2, PageType.READY, PageType.UPCOMING];

async function poll(): Promise<void> {
  for (const tab of tabs) {
    for (const order of await grab.listActiveOrders(tab)) {
      if (seen.has(order.orderID)) continue;
      seen.add(order.orderID);
      console.log(`${new Date().toISOString()} new order ${order.orderID} (${tab})`);
    }
  }
}

const expiresAt = grab.expiresAt();
if (expiresAt) console.log(`Session valid until ${new Date(expiresAt).toISOString()}`);

for (;;) {
  try {
    await poll();
  } catch (e) {
    if (e instanceof GrabError && e.code === 'SESSION_EXPIRED') {
      console.error('Session expired — log in again with examples/login-and-save-session.ts.');
      process.exit(1);
    }
    console.error('Poll failed:', e instanceof Error ? e.message : e);
  }
  await new Promise((r) => setTimeout(r, 30_000));
}
