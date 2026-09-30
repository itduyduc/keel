# Plumb

A minimal Linear for a three-person team: a Mac app, Google sign-in, one shared
server, GitHub pull requests on issues, and an MCP so Claude can work in it.

## Local

```bash
cp .env.example .env            # set PLUMB_ADMIN_EMAILS and PLUMB_DEV_LOGIN=1
npm run build                   # the web UI (web/ → web/dist)
node server/index.js            # http://localhost:4747
node scripts/seed-demo.mjs      # optional: sample issues
npm test                        # server tests
```

The Mac app: `bash mac/build-app.sh` (installs to `~/Applications`), or point a
copy at a local server with `--server http://localhost:4747`.

## Connect Claude

Settings ▸ API & Claude ▸ Create token, then:

```bash
claude mcp add --scope user --transport http plumb https://plumb.itsduy.com/mcp --header "Authorization: Bearer plumb_…"
```

Tools: `list_issues`, `get_issue`, `save_issue`, `save_comment`, `list_comments`,
`list_issue_statuses`, `list_issue_labels`, `list_projects`, `list_cycles`, `list_users`.

## GitHub

A PR whose branch or title contains `PIC-123` links to that issue. Opening it moves
the issue to In Review; once every linked PR is merged or closed (at least one
merged) it moves to Done. Org webhook: `https://plumb.itsduy.com/github/webhook`,
content type JSON, event "Pull requests", secret from `/etc/plumb.env`.

## Deploy

See `CLAUDE.md`. In short: `bash scripts/setup-vm.sh` once, then `bash scripts/deploy.sh`.
