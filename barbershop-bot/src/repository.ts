import type pg from 'pg';
import { DateTime } from 'luxon';
import type { BusyInterval } from './slots.js';

export type Service = {
  id: number;
  title: string;
  durationMinutes: number;
  priceByn: number;
};

export type Booking = {
  id: number;
  clientId: number;
  clientName: string;
  clientPhone: string | null;
  serviceTitle: string;
  startsAt: DateTime;
  endsAt: DateTime;
};

export class SlotTakenError extends Error {
  constructor() {
    super('This time slot has just been taken');
    this.name = 'SlotTakenError';
  }
}

const EXCLUSION_VIOLATION = '23P01';

type BookingRow = {
  id: number;
  client_id: string;
  client_name: string;
  client_phone: string | null;
  service_title: string;
  starts_at: Date;
  ends_at: Date;
};

const bookingSelect = `
  SELECT b.id, b.client_id, c.name AS client_name, c.phone AS client_phone,
         s.title AS service_title, b.starts_at, b.ends_at
  FROM bookings b
  JOIN clients c ON c.telegram_id = b.client_id
  JOIN services s ON s.id = b.service_id`;

const toBooking = (row: BookingRow, timezone: string): Booking => ({
  id: row.id,
  clientId: Number(row.client_id),
  clientName: row.client_name,
  clientPhone: row.client_phone,
  serviceTitle: row.service_title,
  startsAt: DateTime.fromJSDate(row.starts_at).setZone(timezone),
  endsAt: DateTime.fromJSDate(row.ends_at).setZone(timezone),
});

export const createRepository = (pool: pg.Pool, timezone: string) => {
  const listServices = async (): Promise<Service[]> => {
    const { rows } = await pool.query<{ id: number; title: string; duration_min: number; price_byn: string }>(
      'SELECT id, title, duration_min, price_byn FROM services ORDER BY id',
    );
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      durationMinutes: row.duration_min,
      priceByn: Number(row.price_byn),
    }));
  };

  const findService = async (id: number): Promise<Service | undefined> =>
    (await listServices()).find((service) => service.id === id);

  const findBusyIntervals = async (from: DateTime, to: DateTime): Promise<BusyInterval[]> => {
    const { rows } = await pool.query<{ starts_at: Date; ends_at: Date }>(
      `SELECT starts_at, ends_at FROM bookings
       WHERE status = 'active' AND starts_at < $2 AND ends_at > $1`,
      [from.toJSDate(), to.toJSDate()],
    );
    return rows.map((row) => ({
      start: DateTime.fromJSDate(row.starts_at).setZone(timezone),
      end: DateTime.fromJSDate(row.ends_at).setZone(timezone),
    }));
  };

  const findClientPhone = async (telegramId: number): Promise<string | null> => {
    const { rows } = await pool.query<{ phone: string | null }>(
      'SELECT phone FROM clients WHERE telegram_id = $1',
      [telegramId],
    );
    return rows[0]?.phone ?? null;
  };

  const saveClient = async (telegramId: number, name: string, phone: string): Promise<void> => {
    await pool.query(
      `INSERT INTO clients (telegram_id, name, phone) VALUES ($1, $2, $3)
       ON CONFLICT (telegram_id) DO UPDATE SET name = EXCLUDED.name, phone = EXCLUDED.phone`,
      [telegramId, name, phone],
    );
  };

  const createBooking = async (
    clientId: number,
    service: Service,
    startsAt: DateTime,
  ): Promise<number> => {
    const endsAt = startsAt.plus({ minutes: service.durationMinutes });
    try {
      const { rows } = await pool.query<{ id: number }>(
        `INSERT INTO bookings (client_id, service_id, starts_at, ends_at)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [clientId, service.id, startsAt.toJSDate(), endsAt.toJSDate()],
      );
      const created = rows[0];
      if (!created) throw new Error('Booking insert returned no id');
      return created.id;
    } catch (error) {
      if ((error as { code?: string }).code === EXCLUSION_VIOLATION) throw new SlotTakenError();
      throw error;
    }
  };

  const findBooking = async (id: number): Promise<Booking | undefined> => {
    const { rows } = await pool.query<BookingRow>(`${bookingSelect} WHERE b.id = $1`, [id]);
    const row = rows[0];
    return row ? toBooking(row, timezone) : undefined;
  };

  const listUpcomingForClient = async (clientId: number): Promise<Booking[]> => {
    const { rows } = await pool.query<BookingRow>(
      `${bookingSelect}
       WHERE b.client_id = $1 AND b.status = 'active' AND b.starts_at > now()
       ORDER BY b.starts_at`,
      [clientId],
    );
    return rows.map((row) => toBooking(row, timezone));
  };

  const listActiveBetween = async (from: DateTime, to: DateTime): Promise<Booking[]> => {
    const { rows } = await pool.query<BookingRow>(
      `${bookingSelect}
       WHERE b.status = 'active' AND b.starts_at >= $1 AND b.starts_at < $2
       ORDER BY b.starts_at`,
      [from.toJSDate(), to.toJSDate()],
    );
    return rows.map((row) => toBooking(row, timezone));
  };

  /** Cancels only the client's own future booking; returns it, or undefined if there was nothing to cancel. */
  const cancelBooking = async (bookingId: number, clientId: number): Promise<Booking | undefined> => {
    const { rowCount } = await pool.query(
      `UPDATE bookings SET status = 'cancelled'
       WHERE id = $1 AND client_id = $2 AND status = 'active' AND starts_at > now()`,
      [bookingId, clientId],
    );
    return rowCount ? findBooking(bookingId) : undefined;
  };

  /** Atomically claims bookings that need a reminder, so a reminder is never sent twice. */
  const claimDueReminders = async (withinMinutes: number): Promise<Booking[]> => {
    const { rows } = await pool.query<BookingRow>(
      `WITH due AS (
         UPDATE bookings SET reminded = true
         WHERE status = 'active' AND reminded = false
           AND starts_at > now() AND starts_at <= now() + make_interval(mins => $1)
           -- no point reminding about a visit booked just a moment ago
           AND created_at < starts_at - make_interval(mins => $1)
         RETURNING id
       )
       ${bookingSelect} WHERE b.id IN (SELECT id FROM due) ORDER BY b.starts_at`,
      [withinMinutes],
    );
    return rows.map((row) => toBooking(row, timezone));
  };

  return {
    listServices,
    findService,
    findBusyIntervals,
    findClientPhone,
    saveClient,
    createBooking,
    findBooking,
    listUpcomingForClient,
    listActiveBetween,
    cancelBooking,
    claimDueReminders,
  };
};

export type Repository = ReturnType<typeof createRepository>;
