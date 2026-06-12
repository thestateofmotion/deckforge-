# 🚀 DeckForge — Complete Setup Guide

Everything you need to do, in order, to go from this repo to a live system:
the app on your phone, voice capture working, and an assistant that texts you
every morning and evening.

**Total time: roughly an hour, spread across 5 phases. Phases 1–3 get you a
usable app in ~15 minutes; phases 4–5 add the assistant.**

---

## Phase 0 — Merge & secure (5 min)

- [ ] **Merge the working branch.** Open a pull request from
  `claude/project-integrity-visual-enhancement-wb2c3e` into `main` and merge it.
  The Pages deploy (next phase) triggers on `main`.
- [ ] **Revoke the old leaked API key** at [console.anthropic.com](https://console.anthropic.com)
  → Settings → API keys, if you haven't already. It was hardcoded in the
  original file and must be considered compromised.
- [ ] **Create a spend-limited workspace.** Console → Settings → Workspaces →
  New workspace ("DeckForge"), set a monthly spend limit ($5 is plenty).
  Create TWO keys inside it:
  - one for **voice capture** (you'll paste this into the app on your devices)
  - one for **the brain** (it lives in Cloudflare secrets, never a browser)

  Two keys means you can revoke one without breaking the other, and the usage
  page shows you exactly which feature spends what.

## Phase 1 — Put the app online (5 min)

- [ ] After merging to `main`, go to the repo's **Actions** tab — the
  "Deploy to GitHub Pages" workflow runs automatically. If it complains about
  Pages not being enabled: repo **Settings → Pages → Source: GitHub Actions**,
  then re-run it.
- [ ] Your app is now live at `https://<your-username>.github.io/deckforge-/`
  over HTTPS. Open it on your phone.
- [ ] **Install it**: in mobile Chrome/Safari → Share → "Add to Home Screen".
  Because of the service worker, it now works offline too.

> Alternative: drag the repo folder into [netlify.com/drop](https://app.netlify.com/drop)
> for an instant URL, no GitHub needed.

## Phase 2 — Make it yours (5 min)

- [ ] Open the app → banner → **Clear demo** to remove Lance & Grace's sample data.
- [ ] Build your first real cards (Library → + New Card) or just use voice (next phase).
- [ ] Planner → 📅 → **Export backup** once you have real data — make this a habit,
  or just connect the brain (Phase 4) which keeps a server-side snapshot.

## Phase 3 — Voice capture (2 min)

- [ ] Tap the mic button, allow microphone access, and speak. The app will ask
  for your Anthropic API key the first time — paste the **voice key** from
  Phase 0. It's stored only in that browser.
- [ ] Repeat on each device you use (phone + desktop each need the key once).
- [ ] Cost reality: ~$0.002 per capture on your own key. A $5 limit ≈ 2,000+ captures.

## Phase 4 — The Assistant Brain (~20 min)

This is the morning brief / evening check-in / Telegram assistant.
Full step-by-step in [`brain/README.md`](brain/README.md). Checklist version:

- [ ] Telegram: @BotFather → `/newbot` → save the token; message your bot once;
  get your chat id from `getUpdates`.
- [ ] Google: Cloud project → enable Calendar API → service account → JSON key
  → share your calendar with the service account email ("Make changes to events").
- [ ] Cloudflare: `cd brain && npx wrangler login && npx wrangler kv namespace create BRAIN_KV`
  → paste the id into `wrangler.toml` → fill in `TIMEZONE`, `GOOGLE_CALENDAR_ID`,
  `TELEGRAM_CHAT_ID`, and your `USER_NOTES` (sleep goals, wake time — the
  assistant reads these every time).
- [ ] Secrets: `npx wrangler secret put` for `ANTHROPIC_API_KEY` (the **brain key**),
  `TELEGRAM_BOT_TOKEN`, `GOOGLE_SERVICE_ACCOUNT`, `SYNC_TOKEN`,
  `TELEGRAM_WEBHOOK_SECRET` (invent the last two — long random strings).
- [ ] `npx wrangler deploy`, then register the webhook (curl command in brain/README.md).
- [ ] In the app: Planner → 📅 → **Assistant Brain** → paste worker URL + SYNC_TOKEN
  → Sync now.
- [ ] Test: `curl -X POST "https://<worker>/checkin" -H "Authorization: Bearer <SYNC_TOKEN>"`
  → check Telegram → **reply to it** and have a conversation.

## Phase 5 — Live with it (ongoing)

The daily loop the system is designed around:

| When | What happens | Your effort |
|---|---|---|
| ~9am | ☀️ Morning brief: today's events + suggested first card | Read it |
| Anytime | Think of something → text the bot ("need to call the vet this week") | One text — it lands in DeckForge |
| Anytime | Brain dump → mic button → review extracted cards | Talk for 5 minutes |
| During the day | Play a deck, water timer, complete cards | This is the fun part |
| ~9pm | 🌙 Check-in: tomorrow's first event, alarm question, punt suggestions | Reply "yes" and it makes the calendar block |

Tune the assistant by editing `USER_NOTES` in `brain/wrangler.toml` and
redeploying — that's its standing instructions about you.

---

## Costs at a glance

| Thing | Cost |
|---|---|
| Hosting (GitHub Pages) | $0 |
| Brain (Cloudflare Workers + KV free tier) | $0 |
| Telegram | $0 |
| Google Calendar API | $0 |
| Voice captures (your key, Haiku) | ~$0.002 each |
| Brain messages (2 scheduled + replies, Opus) | ~1–5¢/day |

A $5/month workspace limit caps the absolute worst case.

## When things go wrong

- **Voice says "key invalid"** → re-paste a fresh key (it offers the input again).
- **No Telegram messages** → `npx wrangler tail` shows live worker logs;
  test with the `/checkin` curl; check the cron times in `wrangler.toml` (UTC!).
- **"calendar error" in messages** → the service account email probably isn't
  shared on the calendar, or the Calendar API isn't enabled.
- **App seems stale after a deploy** → the service worker refreshes on next
  load; force-reload once or close/reopen the installed app.
- **Broke your data** → Planner → 📅 → Restore backup. Worst case, the error
  screen has "Reset saved data".

## What's next (when you're ready)

In rough order of value:
1. **Live with the loop for a week** — let real use tell you what's missing.
2. **Accounts + cloud sync** (Supabase) — real multi-device, real household
   sharing, and the foundation for selling access.
3. **Managed voice** — a proxy endpoint on the brain so users don't need their
   own API key; free monthly quota + paid tier (Stripe).
4. **Vite build** — faster loads, production-grade structure for the portfolio.
