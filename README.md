# Keel

**A minimal, self-hosted Linear for a small team: one Node server, one SQLite file, a Mac app, Google sign-in, GitHub pull requests on issues, and an MCP so Claude can work in it.**

```
Mac app (WKWebView) ─┐
browser ─────────────┼─▶ Caddy ─▶ node ─▶ keel.db
Claude (MCP token) ──┤  /mcp
GitHub org webhook ──┘  /github/webhook
```

## Your own server, your own data

There is no hosted version and no shared server.
You run your own copy, on your own machine or VM, under your own domain and your own Google OAuth client.
Nothing ships with it: the database is created empty on the first start, and nothing here connects to, imports from or syncs with anyone else's instance.
`data/` and `*.db` are gitignored, so a fork never carries a database either.

## What it has

- Issues with status, priority, assignee, labels, project, estimate, parent, weekly cycles.
- Live updates: every open window sees a change the moment it is saved.
- Markdown descriptions and comments (TipTap editor), @mentions, reactions, an activity trail.
- Google sign-in, invite-only: an admin adds an email, that person can sign in.
- A pull request whose branch or title names `TM-12` attaches to that issue and moves it: opened → In Review, merged → Done.
- An MCP server with personal tokens: Claude creates, updates and comments as the token's owner.
- One team, no accounts to host, no database server. Node 22.13+ only.

## Run it locally

```bash
cp .env.example .env            # set KEEL_ADMIN_EMAILS and KEEL_DEV_LOGIN=1
npm run build                   # the web UI (web/ → web/dist)
node server/index.js            # http://localhost:4747
npm test                        # server tests on a throwaway database
```

Dev login signs in as any member without Google and only answers on localhost.
The team's name, issue prefix and first issue number are read from `.env` on the first start, when the database is created.

## Google sign-in

- Google Cloud console ▸ APIs & Services ▸ Credentials ▸ Create OAuth client, type **Web application**.
- Redirect URI: `<KEEL_PUBLIC_URL>/auth/google/callback`.
- Put the client id and secret in `KEEL_GOOGLE_CLIENT_ID` / `KEEL_GOOGLE_CLIENT_SECRET`.
- The consent screen's privacy link is `<KEEL_PUBLIC_URL>/privacy.html`; it names `KEEL_OPERATOR_NAME` and `KEEL_CONTACT_EMAIL`.

## The Mac app

```bash
bash mac/build-app.sh --server https://your.tracker     # installs to ~/Applications
```

A thin native window around the web UI, the way Linear's own app is built: a web deploy reaches it on reload, no reinstall.
Sign-in opens in the system browser session, because Google refuses OAuth inside a web view.
To hand the app to teammates, sign with a Developer ID certificate and run `bash mac/notarize.sh`.

## Deploy

The scripts drive a Google Cloud VM with `gcloud`; any Linux box with systemd and Caddy works the same way by hand.

```bash
cp deploy/deploy.env.example deploy/deploy.env   # project, zone, VM, its IP, your domain
bash scripts/setup-vm.sh                         # once: user, dirs, /etc/keel.env, systemd unit, Caddy site
bash scripts/deploy.sh                           # every release: test, build, copy, restart, verify
bash scripts/backup.sh                           # a consistent snapshot of keel.db, newest 7 kept
```

On the VM: code in `/opt/keel`, data in `/var/lib/keel`, settings in `/etc/keel.env`, unit `keel.service`.
Point the domain's A record at the VM before the first setup run; Caddy gets the certificate itself.

## GitHub

- Set `KEEL_GITHUB_ORG`. Pull requests from any other org are ignored.
- Org webhook: `<KEEL_PUBLIC_URL>/github/webhook`, content type JSON, event "Pull requests", secret `KEEL_GITHUB_WEBHOOK_SECRET`.
- `KEEL_GITHUB_TOKEN` (read-only) adds a catch-up poll for anything the webhook missed.

## Claude

Settings ▸ API & Claude ▸ Create token, then:

```bash
claude mcp add --scope user --transport http keel https://your.tracker/mcp --header "Authorization: Bearer keel_…"
```

Tools: `list_issues`, `get_issue`, `save_issue`, `save_comment`, `list_comments`, `list_issue_statuses`, `list_issue_labels`, `list_projects`, `list_cycles`, `list_users`.

## Settings

Every setting is in `.env.example`, with a comment each.

## License

MIT.
