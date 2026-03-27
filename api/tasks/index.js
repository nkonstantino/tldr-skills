const { createTask, listTasks } = require('../../lib/store');

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ tasks: listTasks() });
  }

  if (req.method === 'POST') {
    try {
      const task = createTask(req.body || {});
      return res.status(201).json({ task });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed. Use GET or POST.' });
};
