import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { getBookableDays, getFreeSlots } from './slots.js';
import type { Schedule } from './schedule.js';

const schedule: Schedule = {
  timezone: 'Europe/Minsk',
  openHour: 10,
  closeHour: 14,
  slotStepMinutes: 30,
  daysAhead: 7,
  closedWeekdays: [7],
  minLeadMinutes: 60,
  reminderBeforeMinutes: 120,
};

const minsk = (iso: string): DateTime => DateTime.fromISO(iso, { zone: schedule.timezone });
const times = (slots: DateTime[]): string[] => slots.map((slot) => slot.toFormat('HH:mm'));

// 2026-11-02 is a Monday
const mondayMorning = minsk('2026-11-02T07:00');

test('bookable days skip the closed weekday', () => {
  const days = getBookableDays(mondayMorning, schedule);
  assert.equal(days.length, 6);
  assert.ok(days.every((day) => day.weekday !== 7));
});

test('an empty day offers every slot that fits before closing', () => {
  const slots = getFreeSlots({ day: minsk('2026-11-03'), durationMinutes: 60, busy: [], now: mondayMorning, schedule });
  assert.deepEqual(times(slots), ['10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00']);
});

test('slots overlapping an existing booking are excluded', () => {
  const busy = [{ start: minsk('2026-11-03T11:00'), end: minsk('2026-11-03T12:00') }];
  const slots = getFreeSlots({ day: minsk('2026-11-03'), durationMinutes: 60, busy, now: mondayMorning, schedule });
  assert.deepEqual(times(slots), ['10:00', '12:00', '12:30', '13:00']);
});

test('a slot ending exactly when a booking starts is allowed', () => {
  const busy = [{ start: minsk('2026-11-03T10:30'), end: minsk('2026-11-03T14:00') }];
  const slots = getFreeSlots({ day: minsk('2026-11-03'), durationMinutes: 30, busy, now: mondayMorning, schedule });
  assert.deepEqual(times(slots), ['10:00']);
});

test('slots starting sooner than the minimum lead time are hidden', () => {
  const now = minsk('2026-11-02T11:10');
  const slots = getFreeSlots({ day: minsk('2026-11-02'), durationMinutes: 30, busy: [], now, schedule });
  assert.deepEqual(times(slots), ['12:30', '13:00', '13:30']);
});

test('a service longer than the working day has no slots', () => {
  const slots = getFreeSlots({ day: minsk('2026-11-03'), durationMinutes: 300, busy: [], now: mondayMorning, schedule });
  assert.equal(slots.length, 0);
});
