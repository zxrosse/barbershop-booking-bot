export type Schedule = {
  timezone: string;
  openHour: number;
  closeHour: number;
  slotStepMinutes: number;
  daysAhead: number;
  /** Luxon weekday numbers: 1 = Monday … 7 = Sunday */
  closedWeekdays: number[];
  /** Clients can't book a slot that starts sooner than this */
  minLeadMinutes: number;
  reminderBeforeMinutes: number;
};

export const schedule: Schedule = {
  timezone: 'Europe/Minsk',
  openHour: 10,
  closeHour: 20,
  slotStepMinutes: 30,
  daysAhead: 7,
  closedWeekdays: [7],
  minLeadMinutes: 60,
  reminderBeforeMinutes: 120,
};

export const shopInfo = {
  name: 'Barber Demo',
  address: 'Минск, ул. Примерная, 1',
  phone: '+375 29 000-00-00',
  hours: 'Пн–Сб 10:00–20:00, воскресенье — выходной',
};
