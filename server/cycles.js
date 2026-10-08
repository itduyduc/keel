// Weekly cycles, numbered from a fixed anchor Monday in the team's time zone.
// Nothing is stored: cycle N is always the same week, so Keel's numbers line
// up with the weeks Linear already used (Cycle 1 began Monday 2026-08-31).

const DAY = 86_400_000;

// local wall-clock minus UTC, for this zone at this instant
function zoneOffset(tz, utcMs) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(f.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - utcMs;
}

const dayNumber = (dateStr) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / DAY);
};

export function addDays(dateStr, n) {
  return new Date((dayNumber(dateStr) + n) * DAY).toISOString().slice(0, 10);
}

// the calendar date at this instant, in this zone
export function localDate(utcMs, tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(utcMs));
}

// the UTC instant of local midnight at the start of this date, DST-safe
export function zonedMidnight(dateStr, tz) {
  const guess = dayNumber(dateStr) * DAY;
  let utc = guess - zoneOffset(tz, guess);
  utc = guess - zoneOffset(tz, utc);
  return utc;
}

export function cycleNumberAt(utcMs, cfg) {
  const days = dayNumber(localDate(utcMs, cfg.tz)) - dayNumber(cfg.anchor);
  return Math.floor(days / cfg.lengthDays) + 1;
}

export function cycleRange(n, cfg) {
  const startDate = addDays(cfg.anchor, (n - 1) * cfg.lengthDays);
  const endDate = addDays(startDate, cfg.lengthDays);
  return {
    number: n,
    startDate,
    endDate, // exclusive: the next cycle's first day
    startsAt: new Date(zonedMidnight(startDate, cfg.tz)).toISOString(),
    endsAt: new Date(zonedMidnight(endDate, cfg.tz)).toISOString(),
  };
}

// what the UI and the MCP show: recent past, current, and the next few
export function cycleList(cfg, nowMs = Date.now(), { past = 6, upcoming = 3 } = {}) {
  const current = cycleNumberAt(nowMs, cfg);
  const out = [];
  for (let n = Math.max(1, current - past); n <= current + upcoming; n++) {
    out.push({ ...cycleRange(n, cfg), isCurrent: n === current, isPast: n < current, isFuture: n > current });
  }
  return { current, cycles: out };
}
