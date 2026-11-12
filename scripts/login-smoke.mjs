// Login smoke test: node scripts/login-smoke.mjs   → prompts for username + password (hidden), and OTP if Grab asks.
// CHROME_PATH is optional. Set VISIBLE=1 to see the Chrome window (machines with a display only).
// Prints steps + merchant id + cookie NAMES, never values.
import { createRequire } from 'node:module';
import readline from 'node:readline/promises';
const require = createRequire(import.meta.url);
const { loginGrab, GrabClient } = require('../dist/index.js');
const chromePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
/** Hidden prompt — the password never shows on screen or lands in shell history. */
const askHidden = async (q) => {
  const write = rl._writeToOutput;
  rl._writeToOutput = (s) => { if (s.startsWith(q)) write.call(rl, s); };
  const v = await rl.question(q);
  rl._writeToOutput = write;
  process.stdout.write('\n');
  return v;
};
const [argUser, argPass] = process.argv.slice(2);
const username = argUser || (await rl.question('Grab username: '));
const password = argPass || (await askHidden('Password: '));
try {
  const s = await loginGrab({ username, password }, {
    chromePath,
    onEvent: (e) => console.log('event', JSON.stringify(e).replace(/\d{6,}/g, '<num>')),
    onOtp: async (hint) => rl.question(`OTP (${hint.slice(0, 80).replace(/\n/g, ' ')}): `),
  });
  const grab = new GrabClient(s);
  console.log('merchant', s.merchantId, '| header', Object.keys(s.headers ?? {}).join(','), '| cookie', s.cookie.split(';').map((c) => c.split('=')[0].trim()).join(','));
  console.log('expires', new Date(grab.expiresAt() ?? 0).toISOString());
} catch (e) {
  console.log('ERROR', e.code, e.message);
} finally { rl.close(); }
