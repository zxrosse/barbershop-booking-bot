import type { DateTime } from 'luxon';
import type { Booking, Service } from './repository.js';

const ru = (date: DateTime): DateTime => date.setLocale('ru');

export const formatDayButton = (day: DateTime, today: DateTime): string => {
  if (day.hasSame(today, 'day')) return `Сегодня, ${ru(day).toFormat('d MMM')}`;
  if (day.hasSame(today.plus({ days: 1 }), 'day')) return `Завтра, ${ru(day).toFormat('d MMM')}`;
  return ru(day).toFormat('ccc, d MMM');
};

export const formatDateTime = (date: DateTime): string => ru(date).toFormat("d MMMM (cccc) 'в' HH:mm");

export const formatTime = (date: DateTime): string => date.toFormat('HH:mm');

export const formatService = (service: Service): string =>
  `${service.title} — ${service.priceByn} BYN, ${service.durationMinutes} мин`;

export const formatBooking = (booking: Booking): string =>
  `${booking.serviceTitle}\n${formatDateTime(booking.startsAt)}`;

export const formatBookingForAdmin = (booking: Booking): string =>
  [
    `${formatTime(booking.startsAt)}–${formatTime(booking.endsAt)} · ${booking.serviceTitle}`,
    `${booking.clientName}${booking.clientPhone ? `, ${booking.clientPhone}` : ''}`,
  ].join('\n');
