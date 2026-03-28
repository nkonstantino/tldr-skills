'use strict';

/**
 * Task store backed by Upstash Redis (REST API).
 *
 * All functions are async — they make a single fetch call to Upstash's
 * HTTP REST API, so no SDK is needed. Tasks are stored as a Redis hash:
 *   key  = "tasks"
 *   field = task UUID
 *   value = JSON string
 *
 * Setup: add Upstash Redis from the Vercel marketplace. It auto-populates
 * UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in your project's
 * env vars. Run `vercel env pull` to sync them locally.
 */

const { randomUUID } = require('crypto');

const HASH_KEY = 'tasks';

async function redis(...args) {
  // Support both Vercel KV (KV_REST_API_*) and standalone Upstash (UPSTASH_REDIS_REST_*)
  const url   = process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    throw new Error(
      'Missing Redis credentials. Set KV_REST_API_URL + KV_REST_API_TOKEN ' +
      '(Vercel KV) or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN ' +
      '(standalone Upstash), then redeploy.'
    );
  }

  const res  = await fetch(url, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(args),
  });

  const data = await res.json();
  if (data.error) throw new Error(`Redis error: ${data.error}`);
  return data.result;
}

async function createTask({ name, description, schedule, target, maxRuns }) {
  if (!name)          throw new Error('Task name is required');
  if (!schedule?.type) throw new Error('Schedule with type is required');
  if (!target?.skill)  throw new Error('Target skill is required');

  if (schedule.type === 'cron' && schedule.expression) {
    const parts = schedule.expression.trim().split(/\s+/);
    if (parts.length !== 5) throw new Error('Invalid cron expression: must have 5 fields');
  }

  const task = {
    id:          randomUUID(),
    name,
    description: description || '',
    schedule: {
      type:       schedule.type,
      expression: schedule.expression || null,
      timezone:   schedule.timezone   || 'UTC',
    },
    target: {
      skill:   target.skill,
      payload: target.payload || {},
    },
    status:    'active',
    lastRun:   null,
    nextRun:   null,
    createdAt: new Date().toISOString(),
    runCount:  0,
    maxRuns:   maxRuns || null,
  };

  await redis('HSET', HASH_KEY, task.id, JSON.stringify(task));
  return task;
}

async function listTasks() {
  const result = await redis('HGETALL', HASH_KEY);
  if (!result || result.length === 0) return [];

  // HGETALL returns [field, value, field, value, ...]
  const tasks = [];
  for (let i = 0; i < result.length; i += 2) {
    try { tasks.push(JSON.parse(result[i + 1])); } catch { /* skip malformed */ }
  }

  return tasks.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

async function getTask(id) {
  const result = await redis('HGET', HASH_KEY, id);
  if (!result) return null;
  return JSON.parse(result);
}

async function updateTask(id, updates) {
  const task = await getTask(id);
  if (!task) return null;

  if (updates.name        !== undefined) task.name        = updates.name;
  if (updates.description !== undefined) task.description = updates.description;
  if (updates.status      !== undefined) task.status      = updates.status;
  if (updates.lastRun     !== undefined) task.lastRun     = updates.lastRun;
  if (updates.runCount    !== undefined) task.runCount    = updates.runCount;
  if (updates.schedule) {
    const s = typeof updates.schedule === 'string' ? JSON.parse(updates.schedule) : updates.schedule;
    Object.assign(task.schedule, s);
  }
  if (updates.target) {
    const t = typeof updates.target === 'string' ? JSON.parse(updates.target) : updates.target;
    Object.assign(task.target, t);
  }

  await redis('HSET', HASH_KEY, id, JSON.stringify(task));
  return task;
}

async function deleteTask(id) {
  const result = await redis('HDEL', HASH_KEY, id);
  return result === 1;
}

module.exports = { createTask, listTasks, getTask, updateTask, deleteTask };
