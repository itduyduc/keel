# Keel

A minimal, self-hosted Linear for a small team. One Node server, no dependencies on the server side, SQLite through `node:sqlite`, a Vite + React web UI, a Swift shell for the Mac. README has the user's view; this file is the contributor's.

```
mac/Keel/main.swift   the Mac shell: WKWebView + ASWebAuthenticationSession
web/src                      the UI (React, TipTap); built into web/dist
server/index.js              http server: /auth, /api, /mcp, /github/webhook, static
server/store.js              EVERY write: validation, activity trail, live updates
server/db.js                 schema, migrations, first-run seed from KEEL_TEAM_*
server/auth.js               Google OAuth, dev login, the Mac app's code exchange
server/github.js             PR webhook + catch-up poll → issue status
server/mcp.js                MCP over streamable HTTP, bearer tokens
server/cycles.js             weekly cycles, computed from an anchor Monday
test/                        node --test against a real server on a throwaway db
scripts/ deploy/             gcloud-driven VM setup, deploy, backup; systemd + Caddy
```

## Run, test, build

- `npm test` — server tests, ~3 s. Run on Node 22 as well as the latest: `node:sqlite` is where they differ.
- Local: `.env` (copy `.env.example`), `node server/index.js`, `npm run build` for the UI. `KEEL_DEV_LOGIN=1` signs in without Google and only answers on localhost.
- `bash mac/build-app.sh --server <url>` — the Mac shell. Rebuild only when `mac/` changes; the UI comes from the server.
- `bash scripts/deploy.sh` needs `deploy/deploy.env` (see the example) and `gcloud`.

## Rules that bite

- **Every write goes through `server/store.js`.** REST, MCP, GitHub and the cycle rollover all call it, so validation, the activity trail and live updates cannot drift apart.
- **Google refuses OAuth inside a web view** (403 disallowed_useragent). The Mac shell signs in with ASWebAuthenticationSession and a one-time code (`/auth/exchange`); never "fix" sign-in by loading Google in the WKWebView.
- **PR status automation only moves forward**: open (not draft) → In Review; all linked PRs merged or closed with ≥1 merged → Done; nothing leaves Done/Canceled/Duplicate.
- **Cycles are computed, not stored**: weekly from the anchor Monday in the team's zone. Unfinished issues in an ended cycle roll into the current one every minute.
- **The first-run seed is read once.** `KEEL_TEAM_*` shape a new database; after that the database wins, and a change needs a migration or Settings.
- **Migrations append to `MIGRATIONS` in `db.js`**, never edit an entry: `PRAGMA user_version` counts them.
- **The Mac app is one instance.** A second launch raises the first and exits; one-shot `--flag` launches are exempt.

## Gotchas

- **The editor is TipTap (ProseMirror, like Linear's) saving plain markdown** via `@tiptap/markdown`, an early release. Its raw output padded tables, turned `&` into `&amp;` in cells and `~10s` into `\~10s`; `tidyMarkdown()` in `RichEditor.tsx` puts that back. It only saves after a person types, so opening an issue never rewrites its description. Check fidelity with `keelDebug.roundTrip(md)` in the page console.
- TipTap's `focus('end')` reports success without taking focus from another field; `focusEnd()` focuses the view itself.
- Testing the editor through browser automation: a `type` action inserts text in one go, which skips markdown shortcuts (`**bold**` stays literal). Feed characters one at a time, the way a keyboard does, before calling a shortcut broken.
- Headless Chrome never finishes loading a signed-in page: the live-update stream keeps it busy, so `--screenshot` / `--virtual-time-budget` hang. Drive it over the DevTools protocol and capture after a fixed wait.
- Vite fingerprints `/assets/*`, served immutable; `index.html` is served `no-store` so a deploy reaches an open window on ⌘R. Open windows also get a "New version · Reload" offer over the event stream.
- A plain `curl` under `set -e` inside the deploy's remote command once ended the script silently; the version check retries for ten seconds instead.

## Naming

Keel, everywhere: env vars `KEEL_*`, tokens `keel_…`, cookie `keel_session`, URL scheme `keel://`, `keel.db`, `/opt/keel`, `keel.service`. Tokens from before the rename start with `plumb_` and are still accepted.
