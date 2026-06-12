# 🧠 DeckForge Brain

The proactive assistant layer for DeckForge. A single Cloudflare Worker (free tier) that:

- **9am morning brief** — today's calendar, today's plan, and a suggested first card to get moving.
- **9pm check-in** — reads tomorrow's Google Calendar and your latest DeckForge plan, then Claude composes one short Telegram message: *"Lunch with your mom at noon — alarm set? Two cards left from today; punt them?"*
- **Talk back** — reply to the bot in plain language. Claude answers with full context and can **create calendar events** ("block 30 minutes tomorrow at 10 for prep" → done) and **capture tasks into DeckForge** ("I need to buy Jackson's insulin tomorrow" → appears as a quick card next time the app opens).
- **Stays in sync** — the DeckForge app pushes its state here automatically, so the brain always knows your plan.

Costs: Cloudflare free tier covers all of it. Claude usage is ~1–3¢/day on the default model. Your API key lives in Worker secrets — never in a browser.

---

## Setup (~20 minutes, one time)

### 1. Telegram bot (2 min)
1. Message [@BotFather](https://t.me/BotFather) → `/newbot` → pick a name → copy the **bot token**.
2. Message your new bot anything (e.g. "hi") so it can message you back.
3. Get your **chat id**: open `https://api.telegram.org/bot<TOKEN>/getUpdates` in a browser and find `"chat":{"id":123456789,...}`.

### 2. Google Calendar service account (5 min)
1. [console.cloud.google.com](https://console.cloud.google.com) → create a project (or reuse one) → enable the **Google Calendar API**.
2. IAM & Admin → Service Accounts → **Create service account** (no roles needed) → Keys → **Add key → JSON**. Download it.
3. In Google Calendar (calendar.google.com) → your calendar → Settings → **Share with specific people** → add the service account's email (`...@...iam.gserviceaccount.com`) with **"Make changes to events"** (lets the bot create events; use "See all event details" for read-only).

### 3. Anthropic API key (2 min)
[console.anthropic.com](https://console.anthropic.com) → create a **Workspace** with a small monthly spend limit (e.g. $5) → create a key inside it.

### 4. Deploy the worker (5 min)
```sh
cd brain
npx wrangler login                          # free Cloudflare account
npx wrangler kv namespace create BRAIN_KV   # paste the returned id into wrangler.toml
# edit wrangler.toml: TIMEZONE, GOOGLE_CALENDAR_ID (usually your gmail), TELEGRAM_CHAT_ID, USER_NOTES, cron hour

npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put GOOGLE_SERVICE_ACCOUNT   # paste the whole JSON file contents
npx wrangler secret put SYNC_TOKEN               # invent a long random string
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET  # invent another one

npx wrangler deploy                              # note the printed URL
```

### 5. Point Telegram at the worker (1 min)
```sh
curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -d "url=https://<your-worker>.workers.dev/telegram" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

### 6. Connect the DeckForge app (1 min)
In DeckForge → Planner → 📅 → **Assistant Brain**: paste the worker URL and your `SYNC_TOKEN`, hit **Sync now**. From then on the app syncs automatically whenever your data changes.

### 7. Test it
```sh
curl -X POST "https://<your-worker>.workers.dev/checkin" \
  -H "Authorization: Bearer <SYNC_TOKEN>"
# or the morning brief:
curl -X POST "https://<your-worker>.workers.dev/checkin?mode=morning" \
  -H "Authorization: Bearer <SYNC_TOKEN>"
```
You should get the message on Telegram within a few seconds. Then reply to it and have a conversation — try "add buy dog food to tomorrow" and watch it appear in the app.

---

## What it can and can't do (v2)

| Can | Can't yet |
|---|---|
| Read your calendar (next 36h) | Read further ahead / multiple calendars |
| Create calendar events & reminder blocks | Edit or delete events |
| See your full DeckForge plan | Edit or complete existing cards |
| Queue new tasks into DeckForge from chat | Push tasks while the app is closed (they apply on next open) |
| Morning brief + nightly check-in + free-form chat | Voice messages (text only for now) |

## Tuning

- **`USER_NOTES`** in `wrangler.toml` is your standing instruction to the assistant — sleep goals, tone preferences, things to always check. Edit and `npx wrangler deploy`.
- **Check-in hour**: edit the cron in `wrangler.toml` (UTC!).
- **Model**: set a `CLAUDE_MODEL` var to override the default (`claude-opus-4-8`).
