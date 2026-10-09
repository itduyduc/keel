// GitHub pull requests on issues.
//
// A PR whose branch or title names an issue (PIC-123, any team's key) attaches itself to it. Its state
// then drives the issue: opened (not draft) → In Review, and once every linked PR is
// merged or closed with at least one merged → Done. Nothing moves an issue out of a
// completed or canceled status, and a draft or an unmerged close moves nothing.
//
// Two ways in, one code path: the org webhook (instant) and a poll of recently
// updated PRs (catches whatever a webhook missed while the server was down).
import crypto from 'node:crypto';
import { readBody, sendJson, safeEqual, log, now } from './util.js';

export function createGithub(store, cfg) {
  const state = {
    org: cfg.org,
    webhookConfigured: Boolean(cfg.webhookSecret),
    pollConfigured: Boolean(cfg.token),
    pollSeconds: cfg.pollSeconds,
    lastWebhookAt: null,
    lastPollAt: null,
    lastPollError: null,
    repos: [],
  };
  const github = { kind: 'github' };

  // the issue ids a branch or title names, e.g. "PIC-80"; keys are letters only, safe in a pattern
  function refsIn(text) {
    const keys = store.teamKeys().join('|');
    const re = new RegExp(`(?:^|[^A-Za-z0-9])(${keys})-(\\d+)(?![0-9])`, 'gi');
    return [...String(text || '').matchAll(re)].map((m) => `${m[1].toUpperCase()}-${m[2]}`);
  }

  function normalize(pr, repo) {
    return {
      repo,
      number: pr.number,
      title: pr.title || '',
      url: pr.html_url,
      branch: pr.head?.ref || null,
      author: pr.user?.login || null,
      state: pr.merged_at || pr.merged ? 'merged' : pr.state === 'closed' ? 'closed' : 'open',
      draft: Boolean(pr.draft),
      openedAt: pr.created_at || null,
      mergedAt: pr.merged_at || null,
      closedAt: pr.closed_at || null,
      updatedAt: pr.updated_at || now(),
    };
  }

  function automate(issueId) {
    const t = store.workspace();
    const issue = store.getIssueById(issueId);
    if (!issue) return;
    const status = store.statusById(issue.statusId);
    if (store.DONE_TYPES.has(status.type)) return;
    const prs = store.prsForIssue(issueId);
    const anyOpen = prs.some((p) => p.state === 'open');
    const anyReady = prs.some((p) => p.state === 'open' && !p.draft);
    const anyMerged = prs.some((p) => p.state === 'merged');
    if (anyMerged && !anyOpen && t.prMergedStatusId) {
      store.updateIssue(github, issue.identifier, { statusId: t.prMergedStatusId });
      return;
    }
    if (anyReady && t.prOpenStatusId && issue.statusId !== t.prOpenStatusId) {
      const target = store.statusById(t.prOpenStatusId);
      // only ever forward: past In Review already means someone put it there on purpose
      const behind = status.type !== 'started' || status.position < target.position;
      if (behind) store.updateIssue(github, issue.identifier, { statusId: t.prOpenStatusId });
    }
  }

  function processPullRequest(p) {
    const { pr, previous } = store.upsertPullRequest(p);
    const linked = new Set(store.issueIdsForPr(pr.id));
    const newlyLinked = new Set();
    for (const ref of new Set([...refsIn(p.branch), ...refsIn(p.title)])) {
      const issue = store.getIssue(ref, github);
      if (issue && store.linkPullRequest(issue.id, pr)) { linked.add(issue.id); newlyLinked.add(issue.id); }
    }
    const stateChanged = previous && (previous.state !== pr.state || previous.draft !== pr.draft);
    for (const issueId of linked) {
      if (stateChanged && !newlyLinked.has(issueId) && previous.state !== pr.state) store.notePullRequestState(issueId, pr);
      automate(issueId);
      store.refreshIssue(issueId);
    }
    return { pr, linked: [...linked] };
  }

  async function handleWebhook(req, res) {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST only' }, { allow: 'POST' });
    const raw = await readBody(req, 25_000_000);
    if (!cfg.webhookSecret) return sendJson(res, 503, { error: 'Webhook secret not configured' });
    const expected = `sha256=${crypto.createHmac('sha256', cfg.webhookSecret).update(raw).digest('hex')}`;
    if (!safeEqual(req.headers['x-hub-signature-256'] || '', expected)) return sendJson(res, 401, { error: 'Bad signature' });
    state.lastWebhookAt = now();
    const event = req.headers['x-github-event'];
    if (event === 'ping') return sendJson(res, 200, { ok: true });
    if (event !== 'pull_request') return sendJson(res, 202, { ignored: event });
    const payload = JSON.parse(raw.toString('utf8'));
    const repo = payload.repository?.full_name || '';
    if (repo.split('/')[0].toLowerCase() !== cfg.org.toLowerCase()) return sendJson(res, 202, { ignored: repo });
    const out = processPullRequest(normalize(payload.pull_request, repo));
    log(`github: webhook ${payload.action} ${repo}#${payload.pull_request.number} → linked ${out.linked.length}`);
    return sendJson(res, 200, { ok: true, linked: out.linked.length });
  }

  // ── poll ───────────────────────────────────────────────────────────────
  const cursors = new Map(); // repo → newest updated_at already processed
  let reposFetchedAt = 0;

  async function gh(path) {
    const r = await fetch(`https://api.github.com${path}`, {
      headers: {
        authorization: `Bearer ${cfg.token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'keel',
      },
    });
    if (!r.ok) throw new Error(`GitHub ${r.status} on ${path}: ${(await r.text()).slice(0, 200)}`);
    return r.json();
  }

  async function pollOnce() {
    if (!cfg.token) return;
    try {
      if (Date.now() - reposFetchedAt > 3_600_000 || !state.repos.length) {
        const repos = await gh(`/orgs/${encodeURIComponent(cfg.org)}/repos?per_page=100&type=all`);
        state.repos = repos.filter((r) => !r.archived).map((r) => r.full_name);
        reposFetchedAt = Date.now();
      }
      for (const repo of state.repos) {
        const prs = await gh(`/repos/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=30`);
        const since = cursors.get(repo);
        let newest = since;
        for (const pr of prs) {
          if (since && pr.updated_at <= since) break;
          processPullRequest(normalize(pr, repo));
          if (!newest || pr.updated_at > newest) newest = pr.updated_at;
        }
        if (newest) cursors.set(repo, newest);
      }
      state.lastPollAt = now();
      state.lastPollError = null;
    } catch (e) {
      state.lastPollError = e.message;
      log('github: poll failed —', e.message);
    }
  }

  let timer = null;
  function start() {
    if (!cfg.token) return;
    pollOnce();
    timer = setInterval(pollOnce, Math.max(30, cfg.pollSeconds) * 1000);
    timer.unref();
  }
  const stop = () => timer && clearInterval(timer);

  return { handleWebhook, processPullRequest, normalize, refsIn, pollOnce, start, stop, status: () => ({ ...state }) };
}
