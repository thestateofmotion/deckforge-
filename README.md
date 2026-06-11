# 🃏 DeckForge

**Card · Deck · Play** — a card-based household planner. Turn tasks into cards, build decks for different parts of your life, budget your day by time *and* energy, then play through your deck with a focus timer.

Current version: **v0.23.0-beta**

## Running it

DeckForge is a single self-contained `index.html` — no build step, no install.

```sh
# open directly, or serve it:
npx serve .
```

React and Babel are loaded from a CDN and JSX is transformed in the browser, so an internet connection is required on first load.

## Features

- **Library** — personal and shared task cards with category, duration, energy cost (1–5), tags, and recurrence (daily / weekdays / weekly). Swipe a card right to edit, left to delete (works with mouse drag on desktop too).
- **Decks** — group cards into playable decks with capacity feedback (time + energy load vs. your day budget).
- **Planner** — month/week calendar, day capacity meter with traffic-light status, quick cards, recurring cards with skip-for-today, and an archive with auto-purge after a configurable retention period.
- **Play mode** — animated water-fill focus timer with tilt response, low-time warnings, audio chimes, and overtime handling. Filter the deck by how much energy you have right now.
- **Household** — two-member shared pool, send cards to each other with a note, accept/decline via the Inbox, household streak tracking and a 21-day activity heatmap.
- **Voice capture** — tap the mic, speak your tasks, and Claude extracts structured cards (title, duration, energy, category, scheduling) for review before they're added.
- **Calendar export** — the 📅 button in the Planner exports your next 30 days (scheduled decks, quick cards, and recurring cards with proper repeat rules) as an `.ics` file for Google Calendar, Apple Calendar, or Outlook, plus one-click "Add to Google Calendar" links per item.
- **Backup & restore** — export all your data as a JSON file and restore it on another device or after cleared browser storage. API keys are never included in backups.

## Data & privacy

- All data is stored locally in your browser (`localStorage`) — nothing is sent to a server, and your cards, decks, schedule, and session history survive reloads.
- Voice capture requires an [Anthropic API key](https://console.anthropic.com). The app prompts for it on first use and keeps it in your browser's local storage only. **Never commit an API key to this repository.**
- First run shows seeded demo data so you can explore; use **Clear demo** in the banner to start fresh.

## Project layout

```
index.html   — the entire app (React 18 + in-browser Babel)
```
