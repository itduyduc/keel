# Plumb

A minimal Linear clone for the PiCubed team (Duy, Harshit, Priyanka). Built
2026-09-29 so the team never has to pay Linear's per-seat bill; Linear stays as
the read-only archive of PIC-1…78. Nothing was imported.

```
Mac app (WKWebView shell) ──https──▶ Caddy ─▶ node server/index.js ─▶ SQLite
Claude (MCP, bearer token) ─────────▶  /mcp        (/var/lib/plumb/plumb.db)
GitHub org webhook ─────────────────▶  /github/webhook   + a catch-up poll
```

## Decisions (Duy, 2026-09-29, from the clarify session)

- **Why**: avoid a future Linear bill. PiCubed is on Linear Free today. So it runs at **$0/month**.
- **Mac only**: all three are on Macs. The Mac app is a web UI in a WKWebView, the way Linear's own
  app is built; UI updates reach everyone on reload, no reinstall. No browser or iPhone target.
- **Start fresh**, numbering **continues from PIC-79**, so no number ever means two things.
- **One team** (PIC). Google sign-in, **invite-only** (an admin adds the email).
- **Online-only v1** with live updates. Offline, the Inbox + macOS notifications, and
  images/files are the **next pass**, in that order of size.
- **Claude**: an MCP from day one; Claude acts as the token's owner.
- Out: board view, issue relations, email, multiple teams, roadmaps, triage, light theme.

## Run, test, deploy

- `npm test` — server tests on a throwaway database (17 cases, ~3 s). Run on Node 22 too:
  the VM has `v22.23.2`, this Mac `v26`.
- Local: `.env` (copy `.env.example`), `node server/index.js`, `npm run build` for the UI,
  `node scripts/seed-demo.mjs` for the screenshot issues. `PLUMB_DEV_LOGIN=1` signs in without
  Google and only answers on localhost.
- `bash mac/build-app.sh [dest]` — the shell. Rebuild only when `mac/` changes.
- Hosting: co-hosted on the free GCP VM `duymydo` (see Duy My Do's CLAUDE.md), code in
  `/opt/plumb`, data in `/var/lib/plumb`, Caddy site `plumb.itsduy.com`.
  First time `bash scripts/setup-vm.sh`, then `bash scripts/deploy.sh`. Backups: `bash scripts/backup.sh`.
  Deploying, DNS, the Google client, the GitHub webhook and sharing the app are **Duy's calls**.

## Rules that bite

- **Every write goes through `server/store.js`.** REST, MCP, GitHub and the cycle rollover all
  call it, so validation, the activity trail and live updates cannot drift apart.
- **Google refuses OAuth inside a web view** (403 disallowed_useragent). The Mac shell signs in
  with ASWebAuthenticationSession and a one-time code (`/auth/exchange`); never "fix" sign-in by
  loading Google in the WKWebView.
- **PR status automation only moves forward**: open (not draft) → In Review; all linked PRs
  merged or closed with ≥1 merged → Done; nothing leaves Done/Canceled/Duplicate.
- **Cycles are computed, not stored**: weekly from Monday 2026-08-31 00:00 Pacific, same numbers as
  Linear's. Unfinished issues in an ended cycle roll into the current one every minute.
- **Lives in `Projects/Personal/dev/`** (2026-09-30): never pushed, so `dev/` by Personal's
  prod/dev rule — the first push moves it to `prod/` in the same turn, with that section's path
  checklist. `Personal/CLAUDE.md` applies: one Mac-app instance, a diagnostics log (`~/Library/Logs/Plumb/plumb.log`), the ASC API
  key for signing, and its git flow (a branch in its own worktree for anything beyond a quick edit,
  merge to `main`, never push; `duy-merge`). Its "Duy My" naming and suite icon rules do not:
  Plumb is the team's tool, and Duy named it.

## Gotchas

- **The editor is TipTap (ProseMirror, like Linear's) saving plain markdown** via `@tiptap/markdown`,
  which TipTap calls an early release. Its raw output padded tables, turned `&` into `&amp;` in
  cells and `~10s` into `\~10s`; `tidyMarkdown()` in `RichEditor.tsx` puts that back. It only saves
  after a person types, so opening an issue never rewrites its description. Check fidelity with
  `plumbDebug.roundTrip(md)` in the page console.
- TipTap's `focus('end')` reports success without taking focus from another field; `focusEnd()`
  focuses the view itself.
- Testing the editor through browser automation: a `type` action inserts text in one go, which
  skips markdown shortcuts (`**bold**` stays literal). Feed characters through `handleTextInput`
  one at a time, the way a keyboard does, before calling a shortcut broken.
- The local server started from a Claude session dies with that session; the app then shows
  "Can't reach Plumb — not saved". The cure is the VM, not a launchd job for a dev server.

- Headless Chrome never finishes loading a signed-in page: the live-update stream keeps it
  busy, so `--screenshot`/`--virtual-time-budget` hang. Drive it over the DevTools protocol
  and capture after a fixed wait.
- `screencapture` from an agent returns black frames (no Screen Recording permission). Verify
  the Mac shell through its log and its open connection, or ask Duy for a screenshot.
- The list's look was matched against Duy's screenshots at 1.72 px per CSS px: 13 px list text,
  44 px rows, 36 px group bands, 24 px chips, 22.5 px issue title, 15 px body, 385 px rail.
  Neutrals are sampled; accents are Linear's palette (the screenshots over-saturate them).

## Open

- Estimate scale is Fibonacci until Duy picks (Settings ▸ Team).
- After cutover: nobody creates issues in Linear (its numbers would clash from PIC-79). The
  `duy-write` skill's description still names Linear; Duy decides whether it changes.
