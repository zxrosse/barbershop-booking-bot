import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { createPool, migrate } from './db.js';
import { SlotTakenError, createRepository } from './repository.js';

// Integration tests against a real PostgreSQL. Run with:
//   TEST_DATABASE_URL=postgres://user:pass@localhost:5432/bot_test npm test
const databaseUrl = process.env.TEST_DATABASE_URL;
const skip = databaseUrl ? false : 'TEST_DATABASE_URL is not set';

const timezone = 'Europe/Minsk';
const pool = databaseUrl ? createPool(databaseUrl) : undefined;
const repository = pool ? createRepository(pool, timezone) : undefined;
const clientA = 1001;
const clientB = 1002;
const tomorrowAt = (hour: number, minute = 0): DateTime =>
  DateTime.now().setZone(timezone).plus({ days: 1 }).startOf('day').set({ hour, minute });

before(async () => {
  if (!pool || !repository) return;
  await pool.query('DROP TABLE IF EXISTS bookings, clients, services');
  await migrate(pool);
  await migrate(pool); // migrations must be safe to re-run on every start
  await repository.saveClient(clientA, 'Анна', '+375290000001');
  await repository.saveClient(clientB, 'Борис', '+375290000002');
});

after(async () => {
  await pool?.end();
});

const getService = async (title: string) => {
  const service = (await repository!.listServices()).find((item) => item.title === title);
  assert.ok(service, `service ${title} is seeded`);
  return service;
};

test('services are seeded once', { skip }, async () => {
  const services = await repository!.listServices();
  assert.equal(services.length, 4);
});

test('the database rejects an overlapping booking', { skip }, async () => {
  const haircut = await getService('Мужская стрижка'); // 60 min
  const beard = await getService('Оформление бороды'); // 30 min

  await repository!.createBooking(clientA, haircut, tomorrowAt(11));
  await assert.rejects(repository!.createBooking(clientB, beard, tomorrowAt(11, 30)), SlotTakenError);

  // Back-to-back is fine
  const nextId = await repository!.createBooking(clientB, beard, tomorrowAt(12));
  assert.ok(nextId > 0);
});

test('two simultaneous confirmations for one slot: exactly one wins', { skip }, async () => {
  const beard = await getService('Оформление бороды');
  const results = await Promise.allSettled([
    repository!.createBooking(clientA, beard, tomorrowAt(15)),
    repository!.createBooking(clientB, beard, tomorrowAt(15)),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = results.find((result) => result.status === 'rejected');
  assert.ok(rejected?.status === 'rejected' && rejected.reason instanceof SlotTakenError);
});

test('busy intervals reflect active bookings of the day', { skip }, async () => {
  const day = tomorrowAt(0);
  const busy = await repository!.findBusyIntervals(day.startOf('day'), day.endOf('day'));
  const starts = busy.map((interval) => interval.start.toFormat('HH:mm')).sort();
  assert.deepEqual(starts, ['11:00', '12:00', '15:00']);
});

test('a client can cancel only their own booking, and the slot frees up', { skip }, async () => {
  const [booking] = await repository!.listUpcomingForClient(clientA);
  assert.ok(booking);

  assert.equal(await repository!.cancelBooking(booking.id, clientB), undefined);
  const cancelled = await repository!.cancelBooking(booking.id, clientA);
  assert.equal(cancelled?.id, booking.id);
  assert.equal(await repository!.cancelBooking(booking.id, clientA), undefined);

  const haircut = await getService('Мужская стрижка');
  const rebookedId = await repository!.createBooking(clientB, haircut, booking.startsAt);
  assert.ok(rebookedId > 0);
});

test('reminders are claimed once and skip bookings made inside the reminder window', { skip }, async () => {
  const beard = await getService('Оформление бороды');
  const soon = DateTime.now().setZone(timezone).plus({ minutes: 90 }).startOf('minute');
  const earlyId = await repository!.createBooking(clientA, beard, soon);
  const lateId = await repository!.createBooking(clientB, beard, soon.plus({ minutes: 30 }));

  // Pretend the first booking was made yesterday; the second one was made just now.
  await pool!.query(`UPDATE bookings SET created_at = now() - interval '1 day' WHERE id = $1`, [earlyId]);

  const firstRun = await repository!.claimDueReminders(120);
  assert.deepEqual(firstRun.map((booking) => booking.id), [earlyId]);
  assert.ok(!firstRun.some((booking) => booking.id === lateId));
  assert.deepEqual(await repository!.claimDueReminders(120), []);
});
