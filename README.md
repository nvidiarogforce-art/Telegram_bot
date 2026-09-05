# JohanBot — automated Telegram AI replier

This bot receives Telegram messages through a webhook, sends the text to Gemini, and replies automatically.

## Run locally

1. Install Node.js 18 or newer.
2. Copy `.env.example` to `.env`.
3. Put your Telegram bot token and OpenAI API key in `.env`.
4. Run:

```bash
npm install
npm start
```

For local testing, the server needs a public HTTPS tunnel such as Cloudflare Tunnel or ngrok. Render deployment is easier for a permanent bot.

## Deploy on Render

Create a Web Service from this repository.

- Build command: `npm install`
- Start command: `npm start`
- Add `TELEGRAM_BOT_TOKEN` and `GEMINI_API_KEY` as environment variables.
- Optional: set `GEMINI_MODEL` and `PORT`.

After deployment, copy the HTTPS service URL and register the Telegram webhook:

```text
https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://YOUR-RENDER-URL.onrender.com/telegram-webhook
```

Verify it:

```text
https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo
```

The response should contain your `/telegram-webhook` URL and no error.

## Security

- Never upload `.env` to GitHub.
- Never send your bot token or OpenAI key to anyone.
- If a token is exposed, revoke it in BotFather and create a replacement.
