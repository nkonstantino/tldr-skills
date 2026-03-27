const { getTask, updateTask, deleteTask } = require('../../lib/store');

module.exports = async function handler(req, res) {
  const { id } = req.query;

  if (req.method === 'GET') {
    const task = await getTask(id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    return res.status(200).json({ task });
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

  return res.status(405).json({ error: 'Method not allowed. Use GET, PATCH, or DELETE.' });
};
