import { InlineKeyboard, Keyboard } from 'grammy';
import type { DateTime } from 'luxon';
import type { Booking, Service } from './repository.js';
import { formatDayButton, formatService, formatTime } from './format.js';

export const DAY_FORMAT = 'yyyyMMdd';
export const TIME_FORMAT = 'HHmm';
export const CANCEL_TEXT = 'Отмена';

const SLOTS_PER_ROW = 4;

export const mainMenuKeyboard = (): InlineKeyboard =>
  new InlineKeyboard()
    .text('Записаться', 'book')
    .row()
    .text('Мои записи', 'my')
    .text('Контакты', 'info');

export const servicesKeyboard = (services: Service[]): InlineKeyboard => {
  const keyboard = new InlineKeyboard();
  for (const service of services) keyboard.text(formatService(service), `svc:${service.id}`).row();
  return keyboard.text('« Меню', 'menu');
};

const chunk = <T>(items: T[], size: number): T[][] => {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
};

export const daysKeyboard = (serviceId: number, days: DateTime[], today: DateTime): InlineKeyboard => {
  const buttons = days.map((day) =>
    InlineKeyboard.text(formatDayButton(day, today), `day:${serviceId}:${day.toFormat(DAY_FORMAT)}`),
  );
  return InlineKeyboard.from([...chunk(buttons, 2), [InlineKeyboard.text('« Услуги', 'book')]]);
};

export const slotsKeyboard = (serviceId: number, day: DateTime, slots: DateTime[]): InlineKeyboard => {
  const dayKey = day.toFormat(DAY_FORMAT);
  const buttons = slots.map((slot) =>
    InlineKeyboard.text(formatTime(slot), `slot:${serviceId}:${dayKey}:${slot.toFormat(TIME_FORMAT)}`),
  );
  return InlineKeyboard.from([...chunk(buttons, SLOTS_PER_ROW), [InlineKeyboard.text('« Другой день', `svc:${serviceId}`)]]);
};

export const confirmKeyboard = (serviceId: number): InlineKeyboard =>
  new InlineKeyboard().text('Подтвердить', 'confirm').row().text('Выбрать другое время', `svc:${serviceId}`);

export const myBookingsKeyboard = (bookings: Booking[]): InlineKeyboard => {
  const keyboard = new InlineKeyboard();
  for (const booking of bookings) {
    keyboard.text(`Отменить: ${booking.startsAt.setLocale('ru').toFormat('d MMM, HH:mm')}`, `cancel:${booking.id}`).row();
  }
  return keyboard.text('« Меню', 'menu');
};

export const backToMenuKeyboard = (): InlineKeyboard => new InlineKeyboard().text('« Меню', 'menu');

export const requestContactKeyboard = (): Keyboard =>
  new Keyboard().requestContact('Отправить номер телефона').row().text(CANCEL_TEXT).resized().oneTime();
