/**
 * Log in once and save the session to a JSON file.
 *
 *   GRAB_USERNAME=my-store GRAB_PASSWORD=secret npx tsx examples/login-and-save-session.ts ./session.json
 *
 * ⚠️ The session file holds live credentials (cookies). Keep it private and NEVER commit it —
 * `session*.json` is already in this repo's .gitignore.
 */
import { writeFile } from 'node:fs/promises';
import readline from 'node:readline/promises';
import { GrabError, loginGrab } from 'grab-merchant-api';

const outPath = process.argv[2];
const username = process.env.GRAB_USERNAME;
const password = process.env.GRAB_PASSWORD;
if (!outPath || !username || !password) {
  console.error('Usage: GRAB_USERNAME=… GRAB_PASSWORD=… npx tsx examples/login-and-save-session.ts <session.json>');
  process.exit(1);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
try {
  const session = await loginGrab(
    { username, password },
    {
      // chromePath is optional — CHROME_PATH or a standard Chrome / Chromium install is detected automatically.
      onEvent: (e) => console.log('login:', e.type === 'step' ? e.step : e.type),
      onOtp: (hint) => rl.question(`OTP (${hint}): `),
    },
  );
  await writeFile(outPath, JSON.stringify(session, null, 2), { mode: 0o600 });
  console.log(`Saved session for merchant ${session.merchantId} to ${outPath}`);
  console.warn('This file contains credentials — do not commit or share it.');
} catch (e) {
  console.error(e instanceof GrabError ? `${e.code}: ${e.message}` : e);
  process.exitCode = 1;
} finally {
  rl.close();
}
