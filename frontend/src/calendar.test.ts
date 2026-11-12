import assert from "node:assert/strict";
import { test } from "node:test";
import { calendarEntities, calendarLines, countOf, daysOf, dayKey, dropCalendarPoints, eventsOf, formatWhen, upcoming, type CalEvent, type WhenWords } from "./calendar.ts";
import type { Building } from "./model.ts";

const TZ = "Europe/Berlin";
const words: WhenWords = { now: "Jetzt", today: "Heute", tomorrow: "Morgen", allDay: "ganztägig" };
// Sunday, 1 November 2026, 10:00 in Berlin (CET, UTC+1)
const NOW = Date.parse("2026-11-01T09:00:00Z");

const timed = (title: string, start: string, end: string): CalEvent => eventsOf([{ summary: title, start: { dateTime: start }, end: { dateTime: end } }])[0];
const allDay = (title: string, start: string, end: string): CalEvent => eventsOf([{ summary: title, start: { date: start }, end: { date: end } }])[0];

test("events from the REST API: all-day and timed, broken ones left out", () => {
  const out = eventsOf([
    { summary: "Urlaub", start: { date: "2026-11-02" }, end: { date: "2026-11-05" } },
    { summary: " Zahnarzt ", location: "Praxis", start: { dateTime: "2026-11-01T14:00:00+01:00" }, end: { dateTime: "2026-11-01T15:00:00+01:00" } },
    { summary: "kaputt", start: { dateTime: "irgendwann" } },
    { summary: "ohne Start" },
  ]);
  assert.equal(out.length, 2);
  assert.deepEqual([out[0].allDay, out[0].startDay, out[0].endDay], [true, "2026-11-02", "2026-11-05"]);
  assert.deepEqual([out[1].title, out[1].location, out[1].allDay], ["Zahnarzt", "Praxis", false]);
});

test("the day of a moment is the day in the house's time zone", () => {
  // 23:30 UTC on 1 November is already 2 November in Berlin
  assert.equal(dayKey(Date.parse("2026-11-01T23:30:00Z"), TZ), "2026-11-02");
  assert.equal(dayKey(Date.parse("2026-11-01T23:30:00Z"), "UTC"), "2026-11-01");
});

test("upcoming: past events go, running ones first, then by day, all-day before timed on one day", () => {
  const events = [
    timed("vorbei", "2026-11-01T07:00:00+01:00", "2026-11-01T08:00:00+01:00"),
    timed("später", "2026-11-01T18:00:00+01:00", "2026-11-01T19:00:00+01:00"),
    timed("läuft", "2026-11-01T09:30:00+01:00", "2026-11-01T11:00:00+01:00"),
    allDay("morgen ganztägig", "2026-11-02", "2026-11-03"),
    timed("morgen früh", "2026-11-02T08:00:00+01:00", "2026-11-02T09:00:00+01:00"),
    allDay("gestern ganztägig", "2026-10-31", "2026-11-01"),
    allDay("seit gestern", "2026-10-31", "2026-11-03"),
  ];
  assert.deepEqual(
    upcoming(events, NOW, 10, TZ).map((e) => e.title),
    ["seit gestern", "läuft", "später", "morgen ganztägig", "morgen früh"],
  );
  assert.deepEqual(
    upcoming(events, NOW, 2, TZ).map((e) => e.title),
    ["seit gestern", "läuft"],
  );
});

test("when an event is, in words", () => {
  const w = (e: CalEvent) => formatWhen(e, NOW, words, "de", TZ, { hourCycle: "h23" });
  assert.equal(w(timed("x", "2026-11-01T09:30:00+01:00", "2026-11-01T11:00:00+01:00")), "Jetzt – 11:00");
  assert.equal(w(timed("x", "2026-11-01T14:00:00+01:00", "2026-11-01T15:00:00+01:00")), "Heute 14:00");
  assert.equal(w(timed("x", "2026-11-02T08:15:00+01:00", "2026-11-02T09:00:00+01:00")), "Morgen 08:15");
  assert.equal(w(allDay("x", "2026-11-01", "2026-11-02")), "Heute · ganztägig");
  assert.equal(w(allDay("x", "2026-11-02", "2026-11-03")), "Morgen · ganztägig");
  // an all-day event that began before today runs on: today
  assert.equal(w(allDay("x", "2026-10-30", "2026-11-03")), "Heute · ganztägig");
  assert.match(w(allDay("x", "2026-11-05", "2026-11-06")), /^Do\.?, 5\. Nov/);
  assert.match(w(timed("x", "2026-11-05T09:30:00+01:00", "2026-11-05T10:00:00+01:00")), /^Do\.?, 5\. Nov\.? 09:30$/);
});

test("the date instead of the day's word: as a date or short, a running event still says so", () => {
  const w = (e: CalEvent, style: "date" | "numeric") => formatWhen(e, NOW, words, "de", TZ, { hourCycle: "h23" }, style);
  assert.match(w(timed("x", "2026-11-01T14:00:00+01:00", "2026-11-01T15:00:00+01:00"), "date"), /^So\.?, 1\. Nov\.? 14:00$/);
  assert.equal(w(timed("x", "2026-11-02T08:15:00+01:00", "2026-11-02T09:00:00+01:00"), "numeric"), "02.11. 08:15");
  assert.match(w(allDay("x", "2026-11-02", "2026-11-03"), "date"), /^Mo\.?, 2\. Nov\.?$/);
  assert.equal(w(allDay("x", "2026-11-02", "2026-11-03"), "numeric"), "02.11.");
  // an all-day event that began before today: today's date
  assert.equal(w(allDay("x", "2026-10-30", "2026-11-03"), "numeric"), "01.11.");
  assert.equal(w(timed("x", "2026-11-01T09:30:00+01:00", "2026-11-01T11:00:00+01:00"), "numeric"), "Jetzt – 11:00");
});

test("counted days: today and tomorrow, then übermorgen and in so many days", () => {
  const w = (e: CalEvent) => formatWhen(e, NOW, words, "de", TZ, { hourCycle: "h23" }, "days");
  assert.equal(w(timed("x", "2026-11-01T14:00:00+01:00", "2026-11-01T15:00:00+01:00")), "Heute 14:00");
  assert.equal(w(allDay("x", "2026-11-02", "2026-11-03")), "Morgen · ganztägig");
  assert.equal(w(allDay("x", "2026-11-03", "2026-11-04")), "Übermorgen");
  assert.equal(w(timed("x", "2026-11-14T08:15:00+01:00", "2026-11-14T09:00:00+01:00")), "In 13 Tagen 08:15");
  assert.equal(formatWhen(allDay("x", "2026-11-14", "2026-11-15"), NOW, words, "en", TZ, undefined, "days"), "In 13 days");
});

test("an own format: placeholders filled, empty ones tidied away, unknown ones kept", () => {
  const w = (e: CalEvent, format: string | null) => formatWhen(e, NOW, words, "de", TZ, { hourCycle: "h23" }, "custom", format);
  const dentist = timed("x", "2026-11-14T08:15:00+01:00", "2026-11-14T09:00:00+01:00");
  const holiday = allDay("x", "2026-11-14", "2026-11-15");
  assert.equal(w(dentist, null), "In 13 Tagen, 14.11. 08:15");
  assert.equal(w(holiday, null), "In 13 Tagen, 14.11.");
  assert.equal(w(dentist, "{weekday_long}, {d}. {month_long} {yyyy} · {time}–{end}"), "Samstag, 14. November 2026 · 08:15–09:00");
  assert.equal(w(holiday, "{dd}.{mm}.{yy} {time} {allday}"), "14.11.26 ganztägig");
  assert.equal(w(dentist, "noch {days} Tage – {time}"), "Noch 13 Tage – 08:15");
  assert.equal(w(dentist, "{wann} {constructor} {time}"), "{wann} {constructor} 08:15");
  // today and tomorrow in an own format
  assert.match(w(allDay("x", "2026-11-02", "2026-11-03"), "{relative} ({weekday})"), /^Morgen \(Mo\.?\)$/);
});

test("places show only when the settings ask for them", () => {
  const e = eventsOf([{ summary: "Zahnarzt", location: " Praxis Dr. Weiß ", start: { dateTime: "2026-11-01T14:00:00+01:00" }, end: { dateTime: "2026-11-01T15:00:00+01:00" } }]);
  assert.equal(calendarLines(e, NOW, 5, words, "de", TZ)[0].location, null);
  assert.equal(calendarLines(e, NOW, 5, words, "de", TZ, undefined, { location: true })[0].location, "Praxis Dr. Weiß");
  assert.equal(calendarLines(e, NOW, 5, words, "de", TZ, { hourCycle: "h23" }, { date_style: "numeric" })[0].when, "01.11. 14:00");
});

test("a timed event late at night belongs to its day in the house's time zone", () => {
  // 23:30 in Berlin is 22:30 UTC: still today
  const late = timed("spät", "2026-11-01T23:30:00+01:00", "2026-11-02T00:30:00+01:00");
  assert.equal(formatWhen(late, NOW, words, "de", TZ, { hourCycle: "h23" }), "Heute 23:30");
});

test("lines mark what runs and what is today", () => {
  const lines = calendarLines(
    [timed("läuft", "2026-11-01T09:30:00+01:00", "2026-11-01T11:00:00+01:00"), timed("", "2026-11-03T09:00:00+01:00", "2026-11-03T10:00:00+01:00")],
    NOW,
    5,
    words,
    "de",
    TZ,
  );
  assert.deepEqual(
    lines.map((l) => [l.title, l.now, l.today]),
    [
      ["läuft", true, true],
      ["–", false, false],
    ],
  );
});

test("how many events and days: the house's, then the defaults, within limits", () => {
  assert.equal(countOf({ count: 8 }), 8);
  assert.equal(countOf(null), 5);
  assert.equal(countOf({ count: 0 }), 1);
  assert.equal(countOf({ count: 500 }), 20);
  assert.equal(daysOf(null), 14);
  assert.equal(daysOf({ days: 400 }), 90);
});

test("the chosen calendars: only calendar entities, each once", () => {
  assert.deepEqual(calendarEntities({ entities: ["calendar.familie", "sensor.x", "calendar.familie", "calendar.arbeit"] }), ["calendar.familie", "calendar.arbeit"]);
  assert.deepEqual(calendarEntities(null), []);
});

test("a line knows its calendar (a tap opens it)", () => {
  const e = [{ ...timed("Zahnarzt", "2026-11-01T13:00:00Z", "2026-11-01T14:00:00Z"), calendar: "calendar.familie" }];
  assert.equal(calendarLines(e, NOW, 5, words, "de", TZ)[0].calendar, "calendar.familie");
});

test("the old calendar points are cleaned up: their calendars join the settings, the points leave the plan", () => {
  const item = (id: string, type: string, x_cal_entity?: string | null) => ({ id, type, x: 0, z: 0, rotation: 0, w: 0.4, d: 0.4, h: 1.6, variant: null, x_cal_entity });
  const b = {
    settings: { x_calendar: { count: 3, entities: ["calendar.arbeit"] } },
    floors: [
      { id: "eg", furniture: [item("a", "x_calendar", "calendar.familie"), item("b", "x_calendar", null), item("d", "sofa")] },
      { id: "og", furniture: [item("c", "x_calendar", "calendar.arbeit"), item("e", "x_calendar", "sensor.x")] },
    ],
  } as unknown as Building;
  assert.equal(dropCalendarPoints(b), true);
  assert.deepEqual(
    b.floors.map((f) => f.furniture.map((m) => m.id)),
    [["d"], []],
  );
  assert.deepEqual(b.settings.x_calendar, { count: 3, entities: ["calendar.arbeit", "calendar.familie"] });
  // a clean plan stays as it is
  assert.equal(dropCalendarPoints(b), false);
});
