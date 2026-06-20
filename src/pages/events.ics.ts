// AsPEN events iCal feed.
//
// Public URL: https://www.aspensig.asia/events.ics
// Subscribers paste this URL into Google Calendar / Outlook / Apple Calendar.
//
// Why public (no auth):
//   Calendar clients fetch the feed periodically with no Authorization header
//   and no cookie; so any "Bearer required" path is unusable. The events
//   themselves (ICPE / ISPE Asian conference dates, AsPEN teleconference) are
//   public knowledge already; nothing in the feed is sensitive.
//
// Build mode: this is a static endpoint; Astro emits a single .ics file at
// build time. The feed is therefore refreshed on each site deploy (which
// matches our PagesCMS edit → push → GH Actions cycle).
//
// RFC 5545 compliance: minimal subset. We intentionally avoid VTIMEZONE
// blocks and treat all events as all-day (VALUE=DATE) since none of the
// AsPEN-relevant events need wall-clock precision in the .ics; conference
// dates and deadlines are date-granularity anyway.

import type { APIRoute } from "astro";
import eventsRaw from "../data/events.json";

export const prerender = true;

interface EventEntry {
  date: string;
  endDate?: string;
  title: string;
  type?: string;
  location?: string;
  url?: string;
  description?: string;
}

// RFC 5545 §3.3.11; TEXT field escaping. Backslash MUST come first.
const escText = (s: string | undefined): string =>
  (s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\n|\r/g, "\\n");

// RFC 5545 §3.1; long lines must be folded at 75 octets. Keeping this simple:
// fold every output line after 73 chars to leave room for CRLF.
const fold = (line: string): string => {
  if (line.length <= 75) return line;
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    out.push((i === 0 ? "" : " ") + line.slice(i, i + (i === 0 ? 75 : 74)));
    i += i === 0 ? 75 : 74;
  }
  return out.join("\r\n");
};

// 2026-08-24 → 20260824
const toIcsDate = (iso: string): string => iso.replace(/-/g, "");

// DTEND is EXCLUSIVE for all-day events (RFC 5545 §3.6.1). So for a single-day
// event on 2026-08-24, DTEND = 2026-08-25. For a multi-day 2026-08-24..27,
// DTEND = 2026-08-28.
const addOneDay = (iso: string): string => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

// 2026-08-24T11:00:00.000Z → 20260824T110000Z (the DTSTAMP format).
const toIcsTimestamp = (d: Date): string =>
  d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

// Stable UID per event: date + slug of title. Avoids "this event got deleted
// and re-added" creating a duplicate in subscribers' calendars.
const buildUid = (e: EventEntry): string => {
  const slug = e.title.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "event";
  return `${e.date}-${slug}@aspensig.asia`;
};

const buildVEvent = (e: EventEntry, dtstamp: string): string[] => {
  const start = toIcsDate(e.date);
  const end   = toIcsDate(addOneDay(e.endDate ?? e.date));
  const lines: string[] = [
    "BEGIN:VEVENT",
    `UID:${buildUid(e)}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART;VALUE=DATE:${start}`,
    `DTEND;VALUE=DATE:${end}`,
    `SUMMARY:${escText(e.title)}`,
  ];
  if (e.location)    lines.push(`LOCATION:${escText(e.location)}`);
  if (e.url)         lines.push(`URL:${escText(e.url)}`);
  if (e.description) lines.push(`DESCRIPTION:${escText(e.description)}`);
  if (e.type)        lines.push(`CATEGORIES:${escText(e.type.toUpperCase())}`);
  lines.push("END:VEVENT");
  return lines.map(fold);
};

export const GET: APIRoute = () => {
  // Build-time "now"; fine since this is prerendered.
  const dtstamp = toIcsTimestamp(new Date());
  const events = eventsRaw as EventEntry[];

  const header = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//AsPEN//Events//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:AsPEN events",
    "X-WR-CALDESC:Conferences, teleconferences, training and deadlines for the Asian Pharmacoepidemiology Network.",
    "X-WR-TIMEZONE:UTC",
  ].map(fold);

  const body = events.flatMap((e) => buildVEvent(e, dtstamp));

  const footer = ["END:VCALENDAR"];

  // RFC 5545 §3.1 requires CRLF line endings.
  const ics = [...header, ...body, ...footer].join("\r\n") + "\r\n";

  return new Response(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": "inline; filename=aspen-events.ics",
      // Mild cache; but calendar clients ignore this and refresh on their own
      // schedule (Google Calendar refreshes a subscribed URL every few hours).
      "Cache-Control": "public, max-age=600",
    },
  });
};
