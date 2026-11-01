import type { Api } from 'grammy';
import type { Repository } from './repository.js';
import { formatDateTime } from './format.js';
import { shopInfo } from './schedule.js';

const CHECK_INTERVAL_MS = 60_000;

/** Starts a background loop that reminds clients about upcoming visits. Returns a function that stops it. */
export const startReminders = (api: Api, repository: Repository, reminderBeforeMinutes: number): (() => void) => {
  const sendDueReminders = async (): Promise<void> => {
    const bookings = await repository.claimDueReminders(reminderBeforeMinutes);
    for (const booking of bookings) {
      const text = `Напоминаем о записи: ${booking.serviceTitle}, ${formatDateTime(booking.startsAt)}.\n${shopInfo.address}\n\nНе сможете прийти — отмените запись в меню /start.`;
      await api.sendMessage(booking.clientId, text).catch((error) => {
        console.error(`Reminder for booking ${booking.id} failed`, error);
      });
    }
  };

  const timer = setInterval(() => {
    sendDueReminders().catch((error) => console.error('Reminder check failed', error));
  }, CHECK_INTERVAL_MS);

  return () => clearInterval(timer);
};
