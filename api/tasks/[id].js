const { getTask, updateTask, deleteTask } = require('../../lib/store');
const { sendPing } = require('../../lib/webhook');
const { setCors } = require('../../lib/cors');

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { id } = req.query;

  if (req.method === 'GET') {
    const task = await getTask(id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    return res.status(200).json({ task });
  }

  // POST = run the task immediately, bypassing its schedule
  if (req.method === 'POST') {
    const task = await getTask(id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (task.status === 'paused') {
      return res.status(400).json({ error: 'Task is paused. Resume it before running.' });
    }

    let result;
    if (task.target.skill === 'ping-webhook') {
      result = await sendPing({ ...task.target.payload, source: 'api' });
    } else {
      result = { triggered: true, skill: task.target.skill, payload: task.target.payload };
    }

    await updateTask(id, {
      lastRun: new Date().toISOString(),
      runCount: (task.runCount || 0) + 1,
    });

    return res.status(200).json({ task: task.name, result });
  }

  if (req.method === 'PATCH') {
    const task = await updateTask(id, req.body || {});
    if (!task) return res.status(404).json({ error: 'Task not found' });
    return res.status(200).json({ task });
  }

  if (req.method === 'DELETE') {
    const deleted = await deleteTask(id);
    if (!deleted) return res.status(404).json({ error: 'Task not found' });
    return res.status(200).json({ deleted: true });
  }

  return res.status(405).json({ error: 'Method not allowed. Use GET, POST, PATCH, or DELETE.' });
};
