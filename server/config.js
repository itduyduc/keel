// Everything the server reads from its environment, in one place.
// Locally a `.env` at the repo root is loaded first (gitignored; see .env.example).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile) && !process.env.KEEL_SKIP_ENV_FILE) process.loadEnvFile(envFile);

const env = process.env;
const port = Number(env.PORT || 4747);

function readVersion() {
  // deploy writes VERSION next to the code; a dev run says so
  try { return fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim(); } catch { return `dev-${Date.now().toString(36)}`; }
}

export const config = {
  port,
  host: env.HOST || '127.0.0.1',
  publicUrl: (env.KEEL_PUBLIC_URL || `http://localhost:${port}`).replace(/\/+$/, ''),
  dataDir: env.KEEL_DATA_DIR || path.join(ROOT, 'data'),
  webDir: env.KEEL_WEB_DIR || path.join(ROOT, 'web', 'dist'),
  // Dev login skips Google. It only ever answers on loopback, and only with this flag.
  devLogin: env.KEEL_DEV_LOGIN === '1',
  google: {
    clientId: env.KEEL_GOOGLE_CLIENT_ID || '',
    clientSecret: env.KEEL_GOOGLE_CLIENT_SECRET || '',
  },
  // Emails that are always admins; ensured at every start, so the first admin exists.
  adminEmails: (env.KEEL_ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  // The team, read once: on the first start it seeds the database, after that the database wins.
  team: {
    name: env.KEEL_TEAM_NAME || 'Team',
    key: (env.KEEL_TEAM_KEY || 'TM').toUpperCase(),
    firstIssueNumber: Number(env.KEEL_FIRST_ISSUE_NUMBER || 1),
    cycleAnchor: env.KEEL_CYCLE_ANCHOR || '',       // a Monday, YYYY-MM-DD; default: the most recent Monday
    tz: env.KEEL_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  },
  // Shown on /privacy.html, which Google's OAuth consent screen links to.
  operator: {
    name: env.KEEL_OPERATOR_NAME || 'the administrator',
    contact: env.KEEL_CONTACT_EMAIL || '',
  },
  github: {
    org: env.KEEL_GITHUB_ORG || '',
    token: env.KEEL_GITHUB_TOKEN || '',
    webhookSecret: env.KEEL_GITHUB_WEBHOOK_SECRET || '',
    pollSeconds: Number(env.KEEL_GITHUB_POLL_SECONDS || 120),
  },
  version: readVersion(),
};

export const googleConfigured = () => Boolean(config.google.clientId && config.google.clientSecret);
