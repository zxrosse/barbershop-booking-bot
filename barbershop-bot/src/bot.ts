import { Bot, GrammyError, session, type Context, type SessionFlavor, type InlineKeyboard } from 'grammy';
import { DateTime } from 'luxon';
import type { Repository, Service } from './repository.js';
import { SlotTakenError } from './repository.js';
import { getBookableDays, getFreeSlots } from './slots.js';
import type { Schedule } from './schedule.js';
import { shopInfo } from './schedule.js';
import { formatBooking, formatBookingForAdmin, formatDateTime, formatService } from './format.js';
import {
  CANCEL_TEXT,
  DAY_FORMAT,
  TIME_FORMAT,
  backToMenuKeyboard,
  confirmKeyboard,
  daysKeyboard,
  mainMenuKeyboard,
  myBookingsKeyboard,
  requestContactKeyboard,
  servicesKeyboard,
  slotsKeyboard,
} from './keyboards.js';

type Draft = { serviceId: number; startsAt: string };
type SessionData = { draft?: Draft };
export type BotContext = Context & SessionFlavor<SessionData>;

type BotDeps = {
  token: string;
  repository: Repository;
  schedule: Schedule;
  adminIds: number[];
};

const isMessageNotModified = (error: unknown): boolean =>
  error instanceof GrammyError && error.description.includes('message is not modified');

export const createBot = ({ token, repository, schedule, adminIds }: BotDeps): Bot<BotContext> => {
  const bot = new Bot<BotContext>(token);
  bot.use(session({ initial: (): SessionData => ({}) }));

  const now = (): DateTime => DateTime.now().setZone(schedule.timezone);

  /** Edits the message the button belongs to; sends a new one when there is nothing to edit. */
  const show = async (ctx: BotContext, text: string, keyboard: InlineKeyboard): Promise<void> => {
    if (!ctx.callbackQuery?.message) {
      await ctx.reply(text, { reply_markup: keyboard });
      return;
    }
    try {
      await ctx.editMessageText(text, { reply_markup: keyboard });
    } catch (error) {
      if (!isMessageNotModified(error)) throw error;
    }
  };

  const notifyAdmins = async (text: string): Promise<void> => {
    await Promise.all(
      adminIds.map((adminId) =>
        bot.api.sendMessage(adminId, text).catch((error) => console.error(`Admin ${adminId} notification failed`, error)),
      ),
    );
  };

  const parseDay = (dayKey: string): DateTime | undefined => {
    const day = DateTime.fromFormat(dayKey, DAY_FORMAT, { zone: schedule.timezone });
    const isBookable = getBookableDays(now(), schedule).some((bookable) => bookable.hasSame(day, 'day'));
    return day.isValid && isBookable ? day : undefined;
  };

  const loadFreeSlots = async (service: Service, day: DateTime): Promise<DateTime[]> => {
    const busy = await repository.findBusyIntervals(day.startOf('day'), day.endOf('day'));
    return getFreeSlots({ day, durationMinutes: service.durationMinutes, busy, now: now(), schedule });
  };

  /** Re-checks a slot against the schedule and the database: callback data comes from the client and may be stale or forged. */
  const isSlotStillFree = async (service: Service, startsAt: DateTime): Promise<boolean> => {
    const freeSlots = await loadFreeSlots(service, startsAt.startOf('day'));
    return freeSlots.some((slot) => slot.equals(startsAt));
  };

  const showMainMenu = (ctx: BotContext): Promise<void> =>
    show(ctx, `Здравствуйте! Это бот записи в ${shopInfo.name}.\nЧто хотите сделать?`, mainMenuKeyboard());

  const showServices = async (ctx: BotContext): Promise<void> => {
    const services = await repository.listServices();
    await show(ctx, 'Выберите услугу:', servicesKeyboard(services));
  };

  const showDays = async (ctx: BotContext, service: Service): Promise<void> => {
    const days = getBookableDays(now(), schedule);
    await show(ctx, `${formatService(service)}\n\nВыберите день:`, daysKeyboard(service.id, days, now()));
  };

  const showSlots = async (ctx: BotContext, service: Service, day: DateTime, notice = ''): Promise<void> => {
    const slots = await loadFreeSlots(service, day);
    const header = `${notice}${service.title}, ${day.setLocale('ru').toFormat('d MMMM')}`;
    if (slots.length === 0) {
      await show(ctx, `${header}\n\nНа этот день свободного времени нет.`, slotsKeyboard(service.id, day, []));
      return;
    }
    await show(ctx, `${header}\n\nВыберите время:`, slotsKeyboard(service.id, day, slots));
  };

  const showConfirmation = async (ctx: BotContext, service: Service, startsAt: DateTime): Promise<void> => {
    const text = `Проверьте запись:\n\n${formatService(service)}\n${formatDateTime(startsAt)}\n\nВсё верно?`;
    await show(ctx, text, confirmKeyboard(service.id));
  };

  const draftOf = async (ctx: BotContext): Promise<{ service: Service; startsAt: DateTime } | undefined> => {
    const { draft } = ctx.session;
    if (!draft) return undefined;
    const service = await repository.findService(draft.serviceId);
    if (!service) return undefined;
    return { service, startsAt: DateTime.fromISO(draft.startsAt, { zone: schedule.timezone }) };
  };

  bot.command('start', (ctx) => showMainMenu(ctx));

  bot.command('today', async (ctx) => {
    if (!ctx.from || !adminIds.includes(ctx.from.id)) return;
    const today = now().startOf('day');
    const bookings = await repository.listActiveBetween(today, today.plus({ days: 1 }));
    const text = bookings.length
      ? bookings.map(formatBookingForAdmin).join('\n\n')
      : 'На сегодня записей нет.';
    await ctx.reply(`Записи на ${today.setLocale('ru').toFormat('d MMMM')}:\n\n${text}`);
  });

  bot.callbackQuery('menu', async (ctx) => {
    await ctx.answerCallbackQuery();
    await showMainMenu(ctx);
  });

  bot.callbackQuery('book', async (ctx) => {
    await ctx.answerCallbackQuery();
    await showServices(ctx);
  });

  bot.callbackQuery(/^svc:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const service = await repository.findService(Number(ctx.match[1]));
    if (!service) return showServices(ctx);
    await showDays(ctx, service);
  });

  bot.callbackQuery(/^day:(\d+):(\d{8})$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const service = await repository.findService(Number(ctx.match[1]));
    const day = parseDay(ctx.match[2] ?? '');
    if (!service) return showServices(ctx);
    if (!day) return showDays(ctx, service);
    await showSlots(ctx, service, day);
  });

  bot.callbackQuery(/^slot:(\d+):(\d{8}):(\d{4})$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const service = await repository.findService(Number(ctx.match[1]));
    if (!service) return showServices(ctx);

    const day = parseDay(ctx.match[2] ?? '');
    if (!day) return showDays(ctx, service);
    const time = DateTime.fromFormat(ctx.match[3] ?? '', TIME_FORMAT);
    const startsAt = day.set({ hour: time.hour, minute: time.minute });

    if (!time.isValid || !(await isSlotStillFree(service, startsAt))) {
      return showSlots(ctx, service, day, 'Это время уже недоступно.\n');
    }

    ctx.session.draft = { serviceId: service.id, startsAt: startsAt.toISO() ?? '' };
    const knownPhone = await repository.findClientPhone(ctx.from.id);
    if (knownPhone) return showConfirmation(ctx, service, startsAt);

    await ctx.reply('Чтобы мастер мог связаться с вами, поделитесь номером телефона — кнопка внизу экрана.', {
      reply_markup: requestContactKeyboard(),
    });
  });

  bot.on('message:contact', async (ctx) => {
    const { contact } = ctx.message;
    if (contact.user_id !== ctx.from.id) {
      await ctx.reply('Пожалуйста, отправьте свой номер кнопкой внизу экрана.', {
        reply_markup: requestContactKeyboard(),
      });
      return;
    }

    const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ');
    await repository.saveClient(ctx.from.id, name, contact.phone_number);
    await ctx.reply('Спасибо, номер сохранён.', { reply_markup: { remove_keyboard: true } });

    const draft = await draftOf(ctx);
    if (draft) await showConfirmation(ctx, draft.service, draft.startsAt);
    else await showMainMenu(ctx);
  });

  bot.hears(CANCEL_TEXT, async (ctx) => {
    ctx.session.draft = undefined;
    await ctx.reply('Запись отменена.', { reply_markup: { remove_keyboard: true } });
    await showMainMenu(ctx);
  });

  bot.callbackQuery('confirm', async (ctx) => {
    await ctx.answerCallbackQuery();
    const draft = await draftOf(ctx);
    if (!draft) return showServices(ctx);
    const { service, startsAt } = draft;

    if (!(await isSlotStillFree(service, startsAt))) {
      return showSlots(ctx, service, startsAt.startOf('day'), 'Это время уже заняли, выберите другое.\n');
    }

    try {
      const bookingId = await repository.createBooking(ctx.from.id, service, startsAt);
      ctx.session.draft = undefined;
      await show(
        ctx,
        `Готово, вы записаны!\n\n${formatService(service)}\n${formatDateTime(startsAt)}\n\n${shopInfo.address}`,
        backToMenuKeyboard(),
      );

      const booking = await repository.findBooking(bookingId);
      if (booking) await notifyAdmins(`Новая запись\n\n${formatDateTime(booking.startsAt)}\n${formatBookingForAdmin(booking)}`);
    } catch (error) {
      if (!(error instanceof SlotTakenError)) throw error;
      await showSlots(ctx, service, startsAt.startOf('day'), 'Это время только что заняли, выберите другое.\n');
    }
  });

  const showMyBookings = async (ctx: BotContext, clientId: number): Promise<void> => {
    const bookings = await repository.listUpcomingForClient(clientId);
    if (bookings.length === 0) return show(ctx, 'У вас нет предстоящих записей.', mainMenuKeyboard());
    const text = bookings.map((booking, index) => `${index + 1}. ${formatBooking(booking)}`).join('\n\n');
    await show(ctx, `Ваши записи:\n\n${text}`, myBookingsKeyboard(bookings));
  };

  bot.callbackQuery('my', async (ctx) => {
    await ctx.answerCallbackQuery();
    await showMyBookings(ctx, ctx.from.id);
  });

  bot.callbackQuery(/^cancel:(\d+)$/, async (ctx) => {
    const cancelled = await repository.cancelBooking(Number(ctx.match[1]), ctx.from.id);
    await ctx.answerCallbackQuery(cancelled ? 'Запись отменена' : 'Эту запись уже нельзя отменить');
    if (cancelled) await notifyAdmins(`Отмена записи\n\n${formatDateTime(cancelled.startsAt)}\n${formatBookingForAdmin(cancelled)}`);
    await showMyBookings(ctx, ctx.from.id);
  });

  bot.callbackQuery('info', async (ctx) => {
    await ctx.answerCallbackQuery();
    const text = `${shopInfo.name}\n\n${shopInfo.address}\n${shopInfo.phone}\n${shopInfo.hours}`;
    await show(ctx, text, backToMenuKeyboard());
  });

  // Buttons from old messages whose data no handler recognises.
  bot.on('callback_query:data', (ctx) => ctx.answerCallbackQuery('Кнопка устарела, откройте меню: /start'));

  bot.catch(({ error, ctx }) => {
    console.error(`Error while handling update ${ctx.update.update_id}:`, error);
  });

  return bot;
};
