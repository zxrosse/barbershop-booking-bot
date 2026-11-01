import { DateTime } from 'luxon';
import type { Schedule } from './schedule.js';

export type BusyInterval = { start: DateTime; end: DateTime };

type FreeSlotsInput = {
  day: DateTime;
  durationMinutes: number;
  busy: BusyInterval[];
  now: DateTime;
  schedule: Schedule;
};

export const getBookableDays = (now: DateTime, schedule: Schedule): DateTime[] => {
  const today = now.setZone(schedule.timezone).startOf('day');
  const days: DateTime[] = [];

  for (let offset = 0; offset < schedule.daysAhead; offset++) {
    const day = today.plus({ days: offset });
    if (!schedule.closedWeekdays.includes(day.weekday)) days.push(day);
  }

  return days;
};

const overlaps = (start: DateTime, end: DateTime, busy: BusyInterval): boolean =>
  start < busy.end && end > busy.start;

export const getFreeSlots = ({ day, durationMinutes, busy, now, schedule }: FreeSlotsInput): DateTime[] => {
  const dayStart = day.setZone(schedule.timezone).startOf('day');
  const opening = dayStart.set({ hour: schedule.openHour });
  const closing = dayStart.set({ hour: schedule.closeHour });
  const earliestStart = now.plus({ minutes: schedule.minLeadMinutes });
  const slots: DateTime[] = [];

  for (
    let start = opening;
    start.plus({ minutes: durationMinutes }) <= closing;
    start = start.plus({ minutes: schedule.slotStepMinutes })
  ) {
    const end = start.plus({ minutes: durationMinutes });
    if (start < earliestStart) continue;
    if (busy.some((interval) => overlaps(start, end, interval))) continue;
    slots.push(start);
  }

  return slots;
};
