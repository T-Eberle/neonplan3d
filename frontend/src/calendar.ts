/**
 * Calendar events (fork): the next events of the Home Assistant calendars chosen in ⚙ Settings → Calendar, listed
 * in their own section of the glass card "Today in the household". The events come from Home Assistant's REST API
 * (`GET /api/calendars/<id>?start&end`); a calendar entity's state only knows the current or next event.
 * Pure logic apart from fetchEvents: see calendar.test.ts.
 *
 * Until 3.1.1.1 each calendar had an invisible point in the plan (furniture of type "x_calendar"); normalizeBuilding
 * and the backend take their calendars over into the settings and drop the points (dropCalendarPoints).
 */

import type { Building } from "./model.ts";
import type { HomeAssistant } from "./types.ts";

/** The furniture type of the former calendar points (only to clean them up). */
export const LEGACY_CALENDAR_TYPE = "x_calendar";
/** Events listed when the settings do not say how many. */
export const DEFAULT_CALENDAR_COUNT = 5;
/** Days ahead that are asked for when the settings do not say. */
export const DEFAULT_CALENDAR_DAYS = 14;
export const MAX_CALENDAR_COUNT = 20;
export const MAX_CALENDAR_DAYS = 90;

/** The house's calendar settings (building.settings.x_calendar). */
export interface CalendarSettings {
  /** The calendars whose events the household card lists. */
  entities?: string[] | null;
  /** Events in the card's calendar section (of all calendars together). */
  count?: number | null;
  /** How many days ahead are looked at. */
  days?: number | null;
  /** The card's calendar section starts open (else folded to its title; a tap on it opens and folds it). */
  open?: boolean | null;
  /** How the day is written (null = relative). */
  date_style?: DateStyle | null;
  /** The own format of date_style "custom": a template with placeholders (see FORMAT_TOKENS). */
  date_format?: string | null;
  /** The event's place shows under its title. */
  location?: boolean | null;
}

/**
 * How a card writes when an event is: "relative" says "Heute", "Morgen" and the date only further ahead, "days"
 * counts the days ("Übermorgen", "In 13 Tagen"), "date" always the weekday and the date ("Mo., 2. Nov."), "numeric"
 * the short date ("02.11."), "custom" follows the own template (date_format).
 */
export type DateStyle = "relative" | "days" | "date" | "numeric" | "custom";
export const DATE_STYLES: readonly DateStyle[] = ["relative", "days", "date", "numeric", "custom"];
/** The template of "custom" when none is set. */
export const DEFAULT_DATE_FORMAT = "{relative}, {dd}.{mm}. {time}";
export const MAX_DATE_FORMAT = 80;
/** The placeholders of an own format (the editor lists them). */
export const FORMAT_TOKENS = ["relative", "days", "weekday", "weekday_long", "d", "dd", "m", "mm", "month", "month_long", "yy", "yyyy", "time", "end", "allday"] as const;

/** An event as Home Assistant's REST API returns it. */
export interface CalApiEvent {
  summary?: string;
  location?: string | null;
  start?: { date?: string; dateTime?: string } | string;
  end?: { date?: string; dateTime?: string } | string;
}

/** An event in the form the card needs. */
export interface CalEvent {
  title: string;
  location: string | null;
  /** The calendar it comes from (a tap on its line opens it). */
  calendar?: string | null;
  /** All-day: the first and the day after the last day ("YYYY-MM-DD", as the calendar says it). */
  allDay: boolean;
  startDay: string | null;
  endDay: string | null;
  /** With a time: start and end in ms. */
  start: number;
  end: number;
}

/** A card's line. */
export interface CalLine {
  when: string;
  title: string;
  /** Running right now. */
  now: boolean;
  /** Today (or running). */
  today: boolean;
  /** Where it is, when the settings show places and the event has one. */
  location: string | null;
  /** The calendar it comes from. */
  calendar: string | null;
}

const isCalendar = (id: unknown): id is string => typeof id === "string" && id.startsWith("calendar.");

/** The chosen calendars (each once, only calendar entities). */
export function calendarEntities(settings: CalendarSettings | null | undefined): string[] {
  return [...new Set((settings?.entities ?? []).filter(isCalendar))];
}

/**
 * Cleans up the calendar points of 3.1.1.1 and before: their calendars join the settings' list (in plan order, each
 * once), the points leave the plan. Whether anything changed.
 */
export function dropCalendarPoints(b: Building): boolean {
  let changed = false;
  const found: string[] = [];
  for (const floor of b.floors ?? []) {
    const items = floor.furniture ?? [];
    const keep = items.filter((m) => {
      if (m.type !== LEGACY_CALENDAR_TYPE) return true;
      const entity = (m as { x_cal_entity?: unknown }).x_cal_entity;
      if (isCalendar(entity)) found.push(entity);
      return false;
    });
    if (keep.length !== items.length) {
      floor.furniture = keep;
      changed = true;
    }
  }
  if (found.length && b.settings) {
    const before = calendarEntities(b.settings.x_calendar);
    const entities = [...new Set([...before, ...found])];
    if (entities.length !== before.length) b.settings.x_calendar = { ...(b.settings.x_calendar ?? {}), entities };
  }
  return changed;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)));

/** How many events the card lists: the house's number, else 5. */
export function countOf(settings: CalendarSettings | null | undefined): number {
  const n = settings?.count ?? DEFAULT_CALENDAR_COUNT;
  return clamp(Number.isFinite(n) ? n : DEFAULT_CALENDAR_COUNT, 1, MAX_CALENDAR_COUNT);
}

export function daysOf(settings: CalendarSettings | null | undefined): number {
  const n = settings?.days ?? DEFAULT_CALENDAR_DAYS;
  return clamp(Number.isFinite(n) ? n : DEFAULT_CALENDAR_DAYS, 1, MAX_CALENDAR_DAYS);
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The REST API's events as CalEvents (broken ones are left out). */
export function eventsOf(raw: readonly CalApiEvent[]): CalEvent[] {
  const out: CalEvent[] = [];
  for (const e of raw) {
    const s = typeof e.start === "string" ? e.start : (e.start?.date ?? e.start?.dateTime);
    const t = typeof e.end === "string" ? e.end : (e.end?.date ?? e.end?.dateTime);
    if (!s) continue;
    const allDay = DAY.test(s);
    const title = String(e.summary ?? "").trim();
    const location = e.location ? String(e.location) : null;
    if (allDay) {
      const endDay = t && DAY.test(t) ? t : null;
      out.push({ title, location, allDay, startDay: s, endDay, start: dayStartUtc(s), end: endDay ? dayStartUtc(endDay) : dayStartUtc(s) + 86400_000 });
      continue;
    }
    const start = Date.parse(s);
    if (Number.isNaN(start)) continue;
    const end = t ? Date.parse(t) : Number.NaN;
    out.push({ title, location, allDay, startDay: null, endDay: null, start, end: Number.isNaN(end) ? start : end });
  }
  return out;
}

/** Midnight UTC of a "YYYY-MM-DD" day: only for ordering and day arithmetic, never shown. */
function dayStartUtc(day: string): number {
  const m = DAY.exec(day)!;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** The day ("YYYY-MM-DD") of a moment in a time zone (the browser's without one). */
export function dayKey(ms: number, tz?: string | null): string {
  const opts: Intl.DateTimeFormatOptions = { year: "numeric", month: "2-digit", day: "2-digit" };
  try {
    return new Intl.DateTimeFormat("en-CA", tz ? { ...opts, timeZone: tz } : opts).format(ms);
  } catch {
    return new Intl.DateTimeFormat("en-CA", opts).format(ms);
  }
}

/** Calendar days from one day to another (both "YYYY-MM-DD"). */
function daysBetween(a: string, b: string): number {
  return Math.round((dayStartUtc(b) - dayStartUtc(a)) / 86400_000);
}

/** Whether an event is not over yet; all-day events last until the end of their last day. */
function notOver(e: CalEvent, now: number, today: string): boolean {
  if (e.allDay) return daysBetween(today, e.endDay ?? e.startDay!) > 0;
  // an event without a length counts until its start
  return e.end > now || e.start >= now;
}

/** Running right now (an all-day event: today is one of its days). */
function running(e: CalEvent, now: number, today: string): boolean {
  if (e.allDay) return daysBetween(e.startDay!, today) >= 0 && notOver(e, now, today);
  return e.start <= now && e.end > now;
}

/** The next `count` events that are not over, running ones first, then by start. */
export function upcoming(events: readonly CalEvent[], now: number, count: number, tz?: string | null): CalEvent[] {
  const today = dayKey(now, tz);
  const startDay = (e: CalEvent) => (e.allDay ? e.startDay! : dayKey(e.start, tz));
  return events
    .filter((e) => notOver(e, now, today))
    .sort((a, b) => {
      const ra = running(a, now, today);
      const rb = running(b, now, today);
      if (ra !== rb) return ra ? -1 : 1;
      const da = startDay(a);
      const db = startDay(b);
      if (da !== db) return da < db ? -1 : 1;
      // on one day: all-day events first, then by time
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
      return a.start - b.start || a.title.localeCompare(b.title);
    })
    .slice(0, count);
}

/** The words of the card (in the language of the house). */
export interface WhenWords {
  now: string;
  today: string;
  tomorrow: string;
  allDay: string;
}

/** "heute", "morgen", "übermorgen", "in 13 Tagen" in the house's language (the words of the settings as a fallback). */
export function relativeDay(ahead: number, lang: string, words: WhenWords): string {
  try {
    return new Intl.RelativeTimeFormat(lang, { numeric: "auto" }).format(ahead, "day");
  } catch {
    return ahead === 0 ? words.today : ahead === 1 ? words.tomorrow : `+${ahead}`;
  }
}

const capitalize = (text: string, lang: string) => (text ? text[0].toLocaleUpperCase(lang) + text.slice(1) : text);

/**
 * Fills an own format: {relative} (heute, morgen, in 13 Tagen), {days} (13), {weekday} / {weekday_long}, {d} / {dd},
 * {m} / {mm} / {month} / {month_long}, {yy} / {yyyy}, {time} and {end} (empty for all-day events), {allday} (the
 * word, only for all-day events). Unknown placeholders stay as written. What an empty placeholder leaves behind
 * (doubled spaces, a comma at the end) is tidied up, and the line starts with a capital.
 */
export function applyFormat(template: string, day: string, ahead: number, time: string, end: string, allDay: boolean, lang: string, words: WhenWords): string {
  const [y, m, d] = day.split("-");
  const at = dayStartUtc(day);
  const part = (o: Intl.DateTimeFormatOptions) => new Date(at).toLocaleDateString(lang, { ...o, timeZone: "UTC" });
  const values: Record<(typeof FORMAT_TOKENS)[number], () => string> = {
    relative: () => relativeDay(ahead, lang, words),
    days: () => String(ahead),
    weekday: () => part({ weekday: "short" }),
    weekday_long: () => part({ weekday: "long" }),
    d: () => String(Number(d)),
    dd: () => d,
    m: () => String(Number(m)),
    mm: () => m,
    month: () => part({ month: "short" }),
    month_long: () => part({ month: "long" }),
    yy: () => y.slice(2),
    yyyy: () => y,
    time: () => time,
    end: () => end,
    allday: () => (allDay ? words.allDay : ""),
  };
  const filled = template.slice(0, MAX_DATE_FORMAT).replace(/\{(\w+)\}/g, (all, key: string) => (Object.prototype.hasOwnProperty.call(values, key) ? values[key as keyof typeof values]() : all));
  const tidy = filled
    .replace(/\s+/g, " ")
    .replace(/\s+([,;])/g, "$1")
    .replace(/^[\s,;·–-]+|[\s,;·–-]+$/g, "");
  return capitalize(tidy, lang);
}

/**
 * When an event is, short. Relative: "Jetzt – 11:00", "Heute 14:00", "Morgen · ganztägig", "Do., 6. Nov. 09:30";
 * with "days" the days are counted ("In 13 Tagen 14:00"), with "date" every day is written as a date ("So., 1. Nov.
 * 14:00"), with "numeric" short ("01.11. 14:00"), with "custom" as the own template says. An event running now
 * always says so.
 */
export function formatWhen(
  e: CalEvent,
  now: number,
  words: WhenWords,
  lang: string,
  tz?: string | null,
  hour12?: { hourCycle?: "h12" | "h23" },
  style: DateStyle = "relative",
  format?: string | null,
): string {
  const today = dayKey(now, tz);
  const opts = (o: Intl.DateTimeFormatOptions): Intl.DateTimeFormatOptions => (tz ? { ...o, timeZone: tz } : o);
  const fmt = (ms: number, o: Intl.DateTimeFormatOptions) => {
    try {
      return new Date(ms).toLocaleString(lang, opts(o));
    } catch {
      return new Date(ms).toLocaleString(undefined, o);
    }
  };
  if (!e.allDay && e.start <= now && e.end > now) return `${words.now} – ${fmt(e.end, { hour: "2-digit", minute: "2-digit", ...hour12 })}`;
  const day = e.allDay ? e.startDay! : dayKey(e.start, tz);
  // an all-day event that started before today runs on
  const ahead = Math.max(0, daysBetween(today, day));
  const shown = ahead === 0 ? today : day;
  const dateOpts: Intl.DateTimeFormatOptions = style === "numeric" ? { day: "2-digit", month: "2-digit" } : { weekday: "short", day: "numeric", month: "short" };
  // the day itself, written from its "YYYY-MM-DD" (a time zone could move it)
  const date = new Date(dayStartUtc(shown)).toLocaleDateString(lang, { ...dateOpts, timeZone: "UTC" });
  const time = e.allDay ? "" : fmt(e.start, { hour: "2-digit", minute: "2-digit", ...hour12 });
  if (style === "custom") {
    const end = e.allDay ? "" : fmt(e.end, { hour: "2-digit", minute: "2-digit", ...hour12 });
    return applyFormat(format?.trim() || DEFAULT_DATE_FORMAT, shown, ahead, time, end, e.allDay, lang, words);
  }
  const days = capitalize(relativeDay(ahead, lang, words), lang);
  const dayWord = style === "days" ? days : style !== "relative" ? date : ahead === 0 ? words.today : ahead === 1 ? words.tomorrow : date;
  if (e.allDay) return (style === "relative" || style === "days") && ahead <= 1 ? `${dayWord} · ${words.allDay}` : dayWord;
  return `${dayWord} ${time}`;
}

/** The card's lines for the calendars' events (all of them together), written as the house's settings say. */
export function calendarLines(
  events: readonly CalEvent[],
  now: number,
  count: number,
  words: WhenWords,
  lang: string,
  tz?: string | null,
  hour12?: { hourCycle?: "h12" | "h23" },
  settings?: CalendarSettings | null,
): CalLine[] {
  const today = dayKey(now, tz);
  const style = settings?.date_style && DATE_STYLES.includes(settings.date_style) ? settings.date_style : "relative";
  return upcoming(events, now, count, tz).map((e) => {
    const isNow = running(e, now, today);
    return {
      when: formatWhen(e, now, words, lang, tz, hour12, style, settings?.date_format),
      title: e.title || "–",
      now: isNow,
      today: isNow || (e.allDay ? e.startDay === today : dayKey(e.start, tz) === today),
      location: settings?.location && e.location?.trim() ? e.location.trim() : null,
      calendar: e.calendar ?? null,
    };
  });
}

/** Events of the next `days` days, by calendar; a calendar that cannot be read is left out. */
export async function fetchEvents(hass: HomeAssistant, calendars: readonly string[], days: number, now = Date.now()): Promise<Map<string, CalEvent[]>> {
  const out = new Map<string, CalEvent[]>();
  const api = (hass as unknown as { callApi?: <T>(method: string, path: string) => Promise<T> }).callApi;
  if (!api) return out;
  const d = new Date(now);
  // from the start of today: an all-day event of today and a meeting that runs now are asked for too
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + days + 1);
  await Promise.all(
    calendars.map(async (id) => {
      try {
        const raw = await api.call(hass, "GET", `calendars/${id}?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`);
        out.set(
          id,
          eventsOf(Array.isArray(raw) ? (raw as CalApiEvent[]) : []).map((e) => ({ ...e, calendar: id })),
        );
      } catch {
        /* a calendar that cannot be read shows nothing */
      }
    }),
  );
  return out;
}
