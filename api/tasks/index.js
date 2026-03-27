const { createTask, listTasks } = require('../../lib/store');
const { setCors } = require('../../lib/cors');

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const tasks = await listTasks();
    return res.status(200).json({ tasks });
  }

  if (req.method === 'POST') {
    try {
      const task = await createTask(req.body || {});
      return res.status(201).json({ task });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed. Use GET or POST.' });
};
