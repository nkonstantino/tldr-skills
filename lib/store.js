const { randomUUID } = require('crypto');

// In-memory task store. Resets on cold start — by design.
// The schema is the product; swap this Map for KV/Postgres when persistence matters.
const tasks = new Map();

function createTask({ name, description, schedule, target }) {
  if (!name) throw new Error('Task name is required');
  if (!schedule || !schedule.type) throw new Error('Schedule with type is required');
  if (!target || !target.skill) throw new Error('Target skill is required');

  // Validate cron frequency: no faster than once per minute
  if (schedule.type === 'cron' && schedule.expression) {
    const parts = schedule.expression.trim().split(/\s+/);
    if (parts.length !== 5) throw new Error('Invalid cron expression: must have 5 fields');
  }

  const task = {
    id: randomUUID(),
    name,
    description: description || '',
    schedule: {
      type: schedule.type, // "cron" | "once" | "manual"
      expression: schedule.expression || null,
      timezone: schedule.timezone || 'UTC',
    },
    target: {
      skill: target.skill,
      payload: target.payload || {},
    },
    status: 'active',
    lastRun: null,
    nextRun: null,
    createdAt: new Date().toISOString(),
    runCount: 0,
    maxRuns: target.maxRuns || null,
  };

  tasks.set(task.id, task);
  return task;
}

function listTasks() {
  return Array.from(tasks.values()).sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );
}

function getTask(id) {
  return tasks.get(id) || null;
}

function updateTask(id, updates) {
  const task = tasks.get(id);
  if (!task) return null;

  // Allowed mutable fields
  if (updates.name !== undefined) task.name = updates.name;
  if (updates.description !== undefined) task.description = updates.description;
  if (updates.status !== undefined) task.status = updates.status;
  if (updates.lastRun !== undefined) task.lastRun = updates.lastRun;
  if (updates.runCount !== undefined) task.runCount = updates.runCount;
  if (updates.schedule) Object.assign(task.schedule, updates.schedule);
  if (updates.target) Object.assign(task.target, updates.target);

  tasks.set(id, task);
  return task;
}

function deleteTask(id) {
  return tasks.delete(id);
}

module.exports = { createTask, listTasks, getTask, updateTask, deleteTask };
