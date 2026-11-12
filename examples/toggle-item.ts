/**
 * Mark a menu item available or unavailable (sold out until the next restock).
 *
 *   npx tsx examples/toggle-item.ts ./session.json <itemID> on|off
 *
 * Item ids come from `grab.getMenu()` (`categories[].items[].itemID`).
 */
import { readFile } from 'node:fs/promises';
import { GrabClient, GrabError, type GrabSession } from 'grab-merchant-api';

const [sessionPath, itemID, state] = process.argv.slice(2);
if (!sessionPath || !itemID || (state !== 'on' && state !== 'off')) {
  console.error('Usage: npx tsx examples/toggle-item.ts <session.json> <itemID> on|off');
  process.exit(1);
}

const session = JSON.parse(await readFile(sessionPath, 'utf8')) as GrabSession;
const grab = new GrabClient(session);
try {
  // 1 = available · 2 = sold out until next restock · 3 = discontinued
  await grab.setItemsAvailable([itemID], state === 'on' ? 1 : 2);
  console.log(`Item ${itemID} is now ${state === 'on' ? 'available' : 'unavailable'}.`);
} catch (e) {
  if (e instanceof GrabError && e.code === 'SESSION_EXPIRED') console.error('Session expired — log in again.');
  else console.error(e instanceof GrabError ? `${e.code}: ${e.message}` : e);
  process.exitCode = 1;
}
