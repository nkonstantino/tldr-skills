---
name: ping-webhook
description: >
  Send a ping to a webhook endpoint. Use when the user says "ping", "send a ping",
  "post to the webhook", "fire a ping", or when a scheduled task needs to deliver
  a webhook notification. Works both interactively and as an automated task.
---

## What This Skill Does

POSTs a JSON payload containing a person's name and an ISO-8601 timestamp to a webhook URL. The payload is intentionally minimal — it proves connectivity and identity in a single request.

## Payload Schema

Always use this exact shape. Do not add or remove fields.

```json
{
  "name": "Nick Konstantino",
  "timestamp": "2026-03-26T12:00:00.000Z",
  "source": "interactive | cron | api"
}
```

| Field       | Type   | Description                                      |
|-------------|--------|--------------------------------------------------|
| `name`      | string | Full name of the person sending the ping         |
| `timestamp` | string | ISO-8601 UTC timestamp at the moment of the ping |
| `source`    | string | How the ping was triggered                       |

## Default Configuration

- **Webhook URL:** `https://webhook.site/47cdccd9-78bb-420d-bce2-9f34d05df913`
- **Name:** `Nick Konstantino`
- **API Endpoint:** `POST /api/ping`

## Interactive Mode (Claude.ai)

Follow these steps when a user asks you to ping the webhook:

1. **Confirm details.** If the user hasn't specified a name, use `Nick Konstantino`. If they haven't specified a URL, use the default webhook URL above.
2. **Send the ping** by calling the API:
   ```
   POST {BASE_URL}/api/ping
   Content-Type: application/json

   {
     "name": "Nick Konstantino",
     "webhookUrl": "https://webhook.site/47cdccd9-78bb-420d-bce2-9f34d05df913"
   }
   ```
3. **Report the result.** On success, tell the user: "Ping sent at {timestamp}." On failure, report the status code and error.

If you don't have an HTTP tool available, construct and display the `curl` command so the user can run it:
```bash
curl -X POST https://webhook.site/47cdccd9-78bb-420d-bce2-9f34d05df913 \
  -H "Content-Type: application/json" \
  -d '{"name":"Nick Konstantino","timestamp":"2026-03-26T12:00:00.000Z","source":"interactive"}'
```

## Automated Mode (Scheduler)

When invoked by the Scheduler skill as a target, this skill expects:

**Input payload:**
```json
{
  "name": "Nick Konstantino",
  "webhookUrl": "https://webhook.site/47cdccd9-78bb-420d-bce2-9f34d05df913"
}
```

**Return contract:**
```json
{
  "success": true,
  "statusCode": 200,
  "timestamp": "2026-03-26T12:00:00.000Z"
}
```

No user confirmation is needed in automated mode. Execute immediately and return the result.

## Error Handling

- If the webhook returns a non-2xx status, retry **once** after a 2-second wait.
- If the retry also fails, return `{ "success": false, "statusCode": <code>, "timestamp": "<time>" }`.
- Never retry more than once — webhook endpoints may be rate-limited.

## Example Conversation

**User:** Ping the webhook.
**Assistant:** Sending a ping to the webhook as Nick Konstantino...

Ping sent successfully at 2026-03-26T14:32:01.000Z.

**User:** Ping the webhook with the name "Jane Doe".
**Assistant:** Sending a ping as Jane Doe...

Ping sent successfully at 2026-03-26T14:33:15.000Z.
