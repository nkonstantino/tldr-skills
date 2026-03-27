const { sendPing } = require('../lib/webhook');
const { setCors } = require('../lib/cors');

module.exports = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  const { name, webhookUrl } = req.body || {};

  try {
    const result = await sendPing({ name, webhookUrl, source: 'api' });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
