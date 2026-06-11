// DeckForge Brain — a Cloudflare Worker that acts as the proactive assistant layer.
//
// What it does:
//   • Scheduled (cron): evening check-in — reads tomorrow's Google Calendar +
//     the latest DeckForge snapshot, has Claude compose a short message, and
//     sends it to you on Telegram.
//   • POST /sync     — receives DeckForge state snapshots from the app (Bearer SYNC_TOKEN)
//   • POST /telegram — Telegram webhook: reply to the bot in plain language;
//     Claude answers with full context and can create calendar events for you.
//   • POST /checkin  — manually trigger the check-in (Bearer SYNC_TOKEN), for testing.
//
// See brain/README.md for setup.

const CLAUDE_MODEL = "claude-opus-4-8";
const MAX_HISTORY_TURNS = 12;

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCheckin(env, "evening"));
  },

  async fetch(req, env) {
    const url = new URL(req.url);

    if (url.pathname === "/health") return new Response("ok");

    if (url.pathname === "/sync" && req.method === "POST") {
      if (!authed(req, env)) return new Response("unauthorized", { status: 401 });
      const body = await req.text();
      if (body.length > 250_000) return new Response("snapshot too large", { status: 413 });
      try { JSON.parse(body); } catch { return new Response("invalid json", { status: 400 }); }
      await env.BRAIN_KV.put("deckforge:snapshot", body);
      return Response.json({ ok: true, bytes: body.length });
    }

    if (url.pathname === "/checkin" && req.method === "POST") {
      if (!authed(req, env)) return new Response("unauthorized", { status: 401 });
      const result = await runCheckin(env, "evening");
      return Response.json({ ok: true, sent: result });
    }

    if (url.pathname === "/telegram" && req.method === "POST") {
      if (env.TELEGRAM_WEBHOOK_SECRET &&
          req.headers.get("x-telegram-bot-api-secret-token") !== env.TELEGRAM_WEBHOOK_SECRET) {
        return new Response("unauthorized", { status: 401 });
      }
      const update = await req.json().catch(() => null);
      const msg = update?.message;
      // Only the configured chat gets a response — this is a personal assistant.
      if (msg?.text && String(msg.chat?.id) === String(env.TELEGRAM_CHAT_ID)) {
        try { await handleReply(env, msg.text); }
        catch (e) { await sendTelegram(env, "⚠️ I hit an error handling that: " + e.message); }
      }
      return Response.json({ ok: true });
    }

    return new Response("DeckForge Brain " + (env.TIMEZONE || ""), { status: 200 });
  },
};

const authed = (req, env) => req.headers.get("authorization") === `Bearer ${env.SYNC_TOKEN}`;

// ── EVENING CHECK-IN ──────────────────────────────────────────────
async function runCheckin(env, mode) {
  try {
    const context = await gatherContext(env);
    const text = await askClaude(env, {
      system: checkinSystem(env),
      messages: [{ role: "user", content: "Compose tonight's check-in message.\n\nContext:\n" + context }],
    });
    if (text) await sendTelegram(env, text);
    return Boolean(text);
  } catch (e) {
    console.error("checkin failed:", e.message);
    try { await sendTelegram(env, "⚠️ Evening check-in failed: " + e.message); } catch {}
    return false;
  }
}

function checkinSystem(env) {
  return `You are the personal evening check-in assistant for the owner of DeckForge, a card-based day planner. Each evening you send ONE short Telegram message (under 130 words, plain text — no markdown formatting).

Priorities, in order:
1. Tomorrow's first calendar event: if it starts before noon, ask whether an alarm is set and suggest a concrete wake-up time with a sensible buffer.
2. If the current time is already late relative to that first event, do the bedtime math plainly (e.g. "for 7 hours before the 9am meeting, lights out by 1:30").
3. Unfinished items from today's DeckForge plan — suggest what to punt to tomorrow.
4. One-clause preview of tomorrow's DeckForge plan.

Be warm, specific, brief. No lectures, no guilt. At most one question. The user can reply to this message, so keep the door open.

User notes: ${env.USER_NOTES || "(none)"}`;
}

// ── TELEGRAM REPLIES (conversational, with calendar write access) ─
async function handleReply(env, userText) {
  const context = await gatherContext(env);
  const history = JSON.parse((await env.BRAIN_KV.get("chat:history")) || "[]");

  const system = `You are the user's personal assistant on Telegram, connected to their Google Calendar and a read-only snapshot of their DeckForge planner. Keep replies short and conversational — Telegram-sized, plain text.

You can create calendar events with the create_calendar_event tool when the user asks to schedule something, set a reminder-style block, or agrees to a suggestion you made. Confirm briefly after creating. If asked for something you can't do yet (editing DeckForge cards, deleting calendar events), say so plainly and suggest the nearest thing you can do.

User notes: ${env.USER_NOTES || "(none)"}

Current context:
${context}`;

  const tools = [{
    name: "create_calendar_event",
    description: "Create an event on the user's Google Calendar. Use when the user asks to add, schedule, block time for, or be reminded of something at a specific date/time.",
    input_schema: {
      type: "object",
      properties: {
        title:           { type: "string" },
        date:            { type: "string", description: "YYYY-MM-DD in the user's local timezone" },
        start:           { type: "string", description: "HH:MM 24-hour local time; omit for an all-day event" },
        durationMinutes: { type: "integer", description: "Event length in minutes; default 30" },
        description:     { type: "string" },
      },
      required: ["title", "date"],
    },
  }];

  const messages = [...history, { role: "user", content: userText }];
  let finalText = "";

  // Manual tool loop, bounded
  for (let i = 0; i < 4; i++) {
    const res = await claudeRequest(env, { system, messages, tools });
    const toolUses = res.content.filter(b => b.type === "tool_use");
    finalText = res.content.filter(b => b.type === "text").map(b => b.text).join("\n").trim();
    if (res.stop_reason !== "tool_use" || toolUses.length === 0) break;

    // Echo the assistant turn exactly, then answer each tool call
    messages.push({ role: "assistant", content: res.content });
    const results = [];
    for (const tu of toolUses) {
      let result, isError = false;
      try { result = await createCalendarEvent(env, tu.input); }
      catch (e) { result = "Error: " + e.message; isError = true; }
      results.push({ type: "tool_result", tool_use_id: tu.id, content: result, is_error: isError });
    }
    messages.push({ role: "user", content: results });
  }

  if (!finalText) finalText = "Done.";
  await sendTelegram(env, finalText);

  const newHistory = [...history, { role: "user", content: userText }, { role: "assistant", content: finalText }]
    .slice(-MAX_HISTORY_TURNS * 2);
  await env.BRAIN_KV.put("chat:history", JSON.stringify(newHistory));
}

// ── CONTEXT ───────────────────────────────────────────────────────
async function gatherContext(env) {
  const tz = env.TIMEZONE || "America/New_York";
  const nowLocal = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, weekday: "long", month: "long", day: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  }).format(new Date());

  let calendarBlock = "(calendar unavailable)";
  try {
    const token = await googleAccessToken(env);
    const events = await listEvents(env, token);
    calendarBlock = events.length
      ? events.map(e => `- ${e.when}: ${e.title}${e.location ? " @ " + e.location : ""}`).join("\n")
      : "(no events in the next 36 hours)";
  } catch (e) { calendarBlock = "(calendar error: " + e.message + ")"; }

  let deckBlock = "(no DeckForge snapshot synced yet)";
  try {
    const raw = await env.BRAIN_KV.get("deckforge:snapshot");
    if (raw) deckBlock = summarizeSnapshot(JSON.parse(raw), tz);
  } catch {}

  return `Local time now: ${nowLocal} (${tz})

CALENDAR — next 36 hours:
${calendarBlock}

DECKFORGE:
${deckBlock}`;
}

function summarizeSnapshot(snap, tz) {
  const dayKey = (offset) => {
    const d = new Date(Date.now() + offset * 86400000);
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
  };
  const today = dayKey(0), tomorrow = dayKey(1);
  const deckById = Object.fromEntries((snap.decks || []).map(d => [d.id, d]));
  const cardById = Object.fromEntries((snap.cards || []).map(c => [c.id, c]));

  function dayPlan(key) {
    const deckLines = ((snap.schedule || {})[key] || []).map(id => {
      const deck = deckById[id];
      if (!deck) return null;
      const cards = (deck.cardIds || []).map(cid => cardById[cid]?.title).filter(Boolean);
      const time = snap.deckTimes?.[key]?.[id];
      return `deck "${deck.name}"${time ? " at " + time : ""} (${cards.join(", ") || "empty"})`;
    }).filter(Boolean);
    const quicks = ((snap.quickCards || {})[key] || []).map(q =>
      `${q.done ? "[done]" : "[todo]"} ${q.title}${q.time ? " at " + q.time : ""} (${q.duration}m)`);
    const lines = [...deckLines, ...quicks];
    return lines.length ? lines.map(l => "  - " + l).join("\n") : "  (nothing scheduled)";
  }

  const doneToday = (snap.sessions || []).filter(s => s.dayKey === today).length;
  return `Today (${today}) — ${doneToday} session(s) completed:\n${dayPlan(today)}\nTomorrow (${tomorrow}):\n${dayPlan(tomorrow)}\nLast sync: ${snap.syncedAt || "unknown"}`;
}

// ── CLAUDE ────────────────────────────────────────────────────────
async function claudeRequest(env, { system, messages, tools }) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: env.CLAUDE_MODEL || CLAUDE_MODEL,
      max_tokens: 1024,
      thinking: { type: "adaptive" },
      system,
      messages,
      ...(tools ? { tools } : {}),
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${data?.error?.message || "unknown"}`);
  return data;
}

async function askClaude(env, { system, messages }) {
  const res = await claudeRequest(env, { system, messages });
  return res.content.filter(b => b.type === "text").map(b => b.text).join("\n").trim();
}

// ── TELEGRAM ──────────────────────────────────────────────────────
async function sendTelegram(env, text) {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: text.slice(0, 4000) }),
  });
  if (!res.ok) throw new Error("telegram send failed: " + (await res.text()).slice(0, 120));
}

// ── GOOGLE CALENDAR (service account, no OAuth dance) ────────────
async function googleAccessToken(env) {
  const sa = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT);
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/calendar",
    aud: "https://oauth2.googleapis.com/token",
    iat: now, exp: now + 3600,
  }));
  const input = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    "pkcs8", pemToArrayBuffer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(input));
  const jwt = `${input}.${b64urlBytes(new Uint8Array(sig))}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("google auth failed: " + JSON.stringify(data).slice(0, 160));
  return data.access_token;
}

async function listEvents(env, token) {
  const tz = env.TIMEZONE || "America/New_York";
  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(env.GOOGLE_CALENDAR_ID)}/events`);
  url.searchParams.set("timeMin", new Date().toISOString());
  url.searchParams.set("timeMax", new Date(Date.now() + 36 * 3600 * 1000).toISOString());
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", "25");
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  const data = await res.json();
  if (!res.ok) throw new Error("calendar list failed: " + (data?.error?.message || res.status));
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", minute: "2-digit", hour12: true });
  return (data.items || []).map(e => {
    const allDay = !e.start?.dateTime;
    const start = new Date(e.start?.dateTime || (e.start?.date + "T12:00:00"));
    return {
      title: e.summary || "(untitled)",
      when: allDay
        ? new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(start) + " (all day)"
        : fmt.format(start),
      location: e.location || "",
    };
  });
}

async function createCalendarEvent(env, { title, date, start, durationMinutes = 30, description }) {
  const tz = env.TIMEZONE || "America/New_York";
  const token = await googleAccessToken(env);
  let body;
  if (start) {
    const [h, m] = start.split(":").map(Number);
    const endMins = h * 60 + m + durationMinutes;
    const endDate = endMins >= 1440 ? nextDate(date) : date;
    const end = `${String(Math.floor((endMins % 1440) / 60)).padStart(2, "0")}:${String(endMins % 60).padStart(2, "0")}`;
    body = {
      summary: title, description,
      start: { dateTime: `${date}T${start}:00`, timeZone: tz },
      end:   { dateTime: `${endDate}T${end}:00`, timeZone: tz },
      reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 10 }] },
    };
  } else {
    body = { summary: title, description, start: { date }, end: { date: nextDate(date) } };
  }
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(env.GOOGLE_CALENDAR_ID)}/events`,
    { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error("event create failed: " + (data?.error?.message || res.status));
  return `Created "${title}" on ${date}${start ? " at " + start : " (all day)"} — ${data.htmlLink || "ok"}`;
}

function nextDate(dateStr) {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// ── ENCODING HELPERS ──────────────────────────────────────────────
const b64url = (s) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function b64urlBytes(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function pemToArrayBuffer(pem) {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}
