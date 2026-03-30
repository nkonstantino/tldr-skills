const DEFAULT_WEBHOOK_URL = process.env.WEBHOOK_URL || 'https://webhook.site/5b5e0c04-0da6-43a6-91b9-027506dbd2a5';
const DEFAULT_NAME = process.env.PING_NAME || 'Nick Konstantino';

async function sendPing({ name, webhookUrl, source = 'api' } = {}) {
  const resolvedName = name || DEFAULT_NAME;
  const resolvedUrl = webhookUrl || DEFAULT_WEBHOOK_URL;

  const payload = {
    name: resolvedName,
    timestamp: new Date().toISOString(),
    source,
  };

  const res = await fetch(resolvedUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  return {
    success: res.ok,
    statusCode: res.status,
    timestamp: payload.timestamp,
  };
}

module.exports = { sendPing, DEFAULT_WEBHOOK_URL, DEFAULT_NAME };
