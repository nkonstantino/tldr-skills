'use strict';

/**
 * Scheduler cron handler.
 *
 * Reads all active tasks from the persistent store, evaluates which are due
 * based on their cron expression, fires them, and updates execution metadata.
 *
 * Called by GitHub Actions every 5 minutes (Vercel Hobby tier only supports
 * one daily cron, so GH Actions is the high-frequency trigger).
 */

const { listTasks, updateTask } = require('../../lib/store');
const { sendPing }              = require('../../lib/webhook');
const { isDue }                 = require('../../lib/cron-eval');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const now = new Date();
  let tasks;

  try {
    tasks = await listTasks();
  } catch (err) {
    return res.status(500).json({ error: `Failed to load tasks: ${err.message}` });
  }

  // Only evaluate tasks that can fire automatically
  const active = tasks.filter(
    (t) => t.status === 'active' && t.schedule.type !== 'manual'
  );

  const results = await Promise.all(
    active.map(async (task) => {
      try {
        let shouldRun = false;

        if (task.schedule.type === 'cron') {
          shouldRun = isDue(task.schedule.expression, task.lastRun, now);
        } else if (task.schedule.type === 'once') {
          // Fire once tasks whose scheduled time has passed and haven't run yet
          const runAt = new Date(task.schedule.expression);
          shouldRun   = runAt <= now && task.runCount === 0;
        }

        if (!shouldRun) return { id: task.id, name: task.name, skipped: true };

        // Execute based on target skill
        let result;
        if (task.target.skill === 'ping-webhook') {
          result = await sendPing({ ...task.target.payload, source: 'cron' });
        } else {
          // Unknown skills return their invocation contract for external dispatch
          result = {
            triggered: true,
            skill:     task.target.skill,
            payload:   task.target.payload,
            note:      'Skill not directly executable by scheduler — dispatch externally.',
          };
        }

        // Update execution metadata
        const newRunCount = (task.runCount || 0) + 1;
        const updates     = { lastRun: now.toISOString(), runCount: newRunCount };

        // Auto-complete once tasks or tasks that hit maxRuns
        if (task.schedule.type === 'once' || (task.maxRuns && newRunCount >= task.maxRuns)) {
          updates.status = 'completed';
        }

        await updateTask(task.id, updates);
        return { id: task.id, name: task.name, fired: true, result };
      } catch (err) {
        return { id: task.id, name: task.name, error: err.message };
      }
    })
  );

  return res.status(200).json({
    ran:       now.toISOString(),
    evaluated: active.length,
    tasks:     results,
  });
};
