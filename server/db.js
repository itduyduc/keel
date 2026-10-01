// SQLite through node:sqlite (no dependencies). One file: <dataDir>/plumb.db.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { now } from './util.js';

// Each entry runs once, in order; PRAGMA user_version records how far we got.
const MIGRATIONS = [
  `
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);

  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT,
    handle TEXT UNIQUE COLLATE NOCASE,
    git_handle TEXT,
    avatar_url TEXT,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
    active INTEGER NOT NULL DEFAULT 1,
    invited_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL,
    last_seen_at TEXT
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    refreshed_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    user_agent TEXT
  );

  CREATE TABLE api_tokens (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    prefix TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_used_at TEXT,
    revoked_at TEXT
  );

  CREATE TABLE statuses (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL CHECK (type IN ('backlog', 'unstarted', 'started', 'completed', 'canceled')),
    color TEXT NOT NULL,
    position INTEGER NOT NULL
  );

  CREATE TABLE labels (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    color TEXT NOT NULL,
    description TEXT,
    archived_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE projects (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    icon TEXT NOT NULL DEFAULT 'cube',
    color TEXT NOT NULL DEFAULT '#bec2c8',
    description TEXT,
    sort_order REAL NOT NULL DEFAULT 0,
    archived_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE issues (
    id INTEGER PRIMARY KEY,
    number INTEGER NOT NULL UNIQUE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status_id INTEGER NOT NULL REFERENCES statuses(id),
    priority INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 4),
    assignee_id INTEGER REFERENCES users(id),
    creator_id INTEGER REFERENCES users(id),
    project_id INTEGER REFERENCES projects(id),
    cycle INTEGER,
    parent_id INTEGER REFERENCES issues(id),
    estimate INTEGER,
    due_date TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    canceled_at TEXT,
    deleted_at TEXT
  );
  CREATE INDEX issues_status ON issues(status_id);
  CREATE INDEX issues_parent ON issues(parent_id);

  CREATE TABLE issue_labels (
    issue_id INTEGER NOT NULL REFERENCES issues(id),
    label_id INTEGER NOT NULL REFERENCES labels(id),
    PRIMARY KEY (issue_id, label_id)
  );

  CREATE TABLE comments (
    id INTEGER PRIMARY KEY,
    issue_id INTEGER NOT NULL REFERENCES issues(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    edited_at TEXT,
    deleted_at TEXT
  );
  CREATE INDEX comments_issue ON comments(issue_id);

  CREATE TABLE reactions (
    comment_id INTEGER NOT NULL REFERENCES comments(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    emoji TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (comment_id, user_id, emoji)
  );

  -- who changed what, when; values are display strings so history survives renames
  CREATE TABLE activity (
    id INTEGER PRIMARY KEY,
    issue_id INTEGER NOT NULL REFERENCES issues(id),
    actor_kind TEXT NOT NULL CHECK (actor_kind IN ('user', 'github', 'system')),
    actor_id INTEGER REFERENCES users(id),
    actor_name TEXT,
    kind TEXT NOT NULL,
    from_value TEXT,
    to_value TEXT,
    meta TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX activity_issue ON activity(issue_id);

  CREATE TABLE pull_requests (
    id INTEGER PRIMARY KEY,
    repo TEXT NOT NULL,
    number INTEGER NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    branch TEXT,
    author TEXT,
    state TEXT NOT NULL CHECK (state IN ('open', 'closed', 'merged')),
    draft INTEGER NOT NULL DEFAULT 0,
    opened_at TEXT,
    merged_at TEXT,
    closed_at TEXT,
    updated_at TEXT,
    UNIQUE (repo, number)
  );

  CREATE TABLE issue_prs (
    issue_id INTEGER NOT NULL REFERENCES issues(id),
    pr_id INTEGER NOT NULL REFERENCES pull_requests(id),
    linked_at TEXT NOT NULL,
    PRIMARY KEY (issue_id, pr_id)
  );
  `,
  // 2: saved views — a named filter over the team's issues, shared by everyone
  `
  CREATE TABLE views (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    icon TEXT NOT NULL DEFAULT 'layers',
    color TEXT NOT NULL DEFAULT '#9b9b9e',
    filters TEXT NOT NULL DEFAULT '{}',
    creator_id INTEGER REFERENCES users(id),
    sort_order REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  );
  `,
];

// The PiCubed workspace as it was set up in Linear (read 2026-09-29). Issues start fresh.
const SEED = {
  meta: {
    team_key: 'PIC',
    team_name: 'Picubed',
    team_icon: 'shop',
    team_color: '#4ea7fc',
    next_issue_number: '79', // PIC-1…78 stay in Linear's archive
    cycle_anchor: '2026-08-31',
    cycle_tz: 'America/Los_Angeles',
    cycle_length_days: '7',
    estimate_scale: 'fibonacci',
    default_status: 'Backlog',
    pr_open_status: 'In Review',
    pr_merged_status: 'Done',
  },
  statuses: [
    ['Backlog', 'backlog', '#bec2c8'],
    ['Todo', 'unstarted', '#e2e2e2'],
    ['In Progress', 'started', '#f2c94c'],
    ['In Review', 'started', '#4cb782'],
    ['Done', 'completed', '#5e6ad2'],
    ['Canceled', 'canceled', '#95a2b3'],
    ['Duplicate', 'canceled', '#95a2b3'],
  ],
  labels: [
    ['Bug', '#eb5757', null],
    ['Feature', '#bb87fc', null],
    ['Improvement', '#4ea7fc', null],
    ['apply-to-anur', '#9b7bff', 'Built in a personal app first; the same idea belongs in Anur.'],
  ],
  projects: [
    ['Thesis survives or dies', 'heart', '#26b5ce'],
    ['Biz', 'cube', '#f2c94c'],
  ],
};

export function openDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'plumb.db'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

function migrate(db) {
  const version = db.prepare('PRAGMA user_version').get().user_version;
  for (let v = version; v < MIGRATIONS.length; v++) {
    tx(db, () => {
      db.exec(MIGRATIONS[v]);
      if (v === 0) seed(db);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

function seed(db) {
  const t = now();
  const setMeta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(SEED.meta)) setMeta.run(k, v);
  const addStatus = db.prepare('INSERT INTO statuses (name, type, color, position) VALUES (?, ?, ?, ?)');
  SEED.statuses.forEach(([name, type, color], i) => addStatus.run(name, type, color, i));
  const addLabel = db.prepare('INSERT INTO labels (name, color, description, created_at) VALUES (?, ?, ?, ?)');
  for (const [name, color, description] of SEED.labels) addLabel.run(name, color, description, t);
  const addProject = db.prepare('INSERT INTO projects (name, icon, color, sort_order, created_at) VALUES (?, ?, ?, ?, ?)');
  SEED.projects.forEach(([name, icon, color], i) => addProject.run(name, icon, color, i, t));
}

export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function getMeta(db, key) {
  return db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null;
}

export function setMeta(db, key, value) {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}
