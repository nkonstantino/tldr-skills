'use strict';

/**
 * Minimal 5-field cron expression evaluator. No dependencies.
 *
 * Supported syntax per field: *, N, *\/N, N-M, N,M,P and combinations.
 * Does NOT support: @reboot, 6-field expressions, L/W/# modifiers.
 *
 * Strategy: iterate every minute in the window (lastRun, now] and check
 * if any minute matches all five fields. Efficient for typical windows (≤10 min).
 */

function parseField(field, min, max) {
  if (field === '*') return null; // null = match all

  const values = new Set();

  for (const part of field.split(',')) {
    if (part.includes('/')) {
      const [range, stepStr] = part.split('/');
      const step  = parseInt(stepStr, 10);
      let start   = min;
      let end     = max;

      if (range !== '*') {
        const dash = range.indexOf('-');
        if (dash !== -1) {
          start = parseInt(range.slice(0, dash),     10);
          end   = parseInt(range.slice(dash + 1),    10);
        } else {
          start = parseInt(range, 10);
        }
      }

      for (let i = start; i <= end; i += step) values.add(i);
    } else if (part.includes('-')) {
      const [s, e] = part.split('-').map(Number);
      for (let i = s; i <= e; i++) values.add(i);
    } else {
      values.add(parseInt(part, 10));
    }
  }

  return values;
}

/**
 * Returns true if the cron expression has a scheduled occurrence
 * in the half-open window (lastRun, now].
 *
 * @param {string}      expression  5-field cron expression
 * @param {string|null} lastRun     ISO-8601 timestamp of the last execution, or null
 * @param {Date}        now         current time (default: new Date())
 * @param {number}      windowMs    fallback window if lastRun is null (default: 6 min)
 */
function isDue(expression, lastRun, now = new Date(), windowMs = 25 * 60 * 60 * 1000) {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return false;

  const [minuteF, hourF, domF, monthF, dowF] = fields;

  const minutes = parseField(minuteF, 0, 59);
  const hours   = parseField(hourF,   0, 23);
  const doms    = parseField(domF,    1, 31);
  const months  = parseField(monthF,  1, 12);
  const dows    = parseField(dowF,    0,  6);

  // Start from (lastRun + 1 min) or (now - windowMs) if no lastRun
  const windowStart = lastRun
    ? new Date(new Date(lastRun).getTime() + 60_000)
    : new Date(now.getTime() - windowMs);

  // Snap to the top of the minute
  const cursor = new Date(windowStart);
  cursor.setUTCSeconds(0, 0);

  while (cursor <= now) {
    const m   = cursor.getUTCMinutes();
    const h   = cursor.getUTCHours();
    const dom = cursor.getUTCDate();
    const mon = cursor.getUTCMonth() + 1;
    const dow = cursor.getUTCDay();

    if (
      (!minutes || minutes.has(m))  &&
      (!hours   || hours.has(h))    &&
      (!doms    || doms.has(dom))   &&
      (!months  || months.has(mon)) &&
      (!dows    || dows.has(dow))
    ) {
      return true;
    }

    cursor.setTime(cursor.getTime() + 60_000);
  }

  return false;
}

module.exports = { isDue };
