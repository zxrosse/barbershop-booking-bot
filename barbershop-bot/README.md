# Barbershop Booking Bot

A Telegram bot that lets clients of a small business book an appointment in a few taps — pick a service, a day and a free time slot — and lets the owner see the day's schedule and get notified about every booking and cancellation.

Built as a portfolio project to show a complete, production-shaped backend: TypeScript, PostgreSQL, Docker, tests.

<p align="center">
  <img src="docs/demo.gif" width="360" alt="A client books a men's haircut for tomorrow at 12:00, shares a phone number, confirms, and the owner gets a notification">
</p>

## What it does

**For clients**
- Choose a service (duration and price shown), a day for the next week and a free time slot
- Share a phone number once with Telegram's native contact button — returning clients skip this step
- See upcoming bookings and cancel them
- Get a reminder 2 hours before the visit

**For the owner**
- Instant notification about every new booking and cancellation
- `/today` — the day's schedule with client names and phone numbers
- Working hours, days off, slot step and lead time are configured in one file (`src/schedule.ts`)

## Stack

TypeScript (strict) · Node.js 22 · [grammY](https://grammy.dev) · PostgreSQL 16 · Luxon · Docker Compose · node:test

## Design decisions worth a look

- **Double booking is impossible at the database level.** Bookings use a PostgreSQL exclusion constraint over `tstzrange(starts_at, ends_at)`, so two clients confirming the same slot at the same moment can't both succeed — one gets a friendly "this time was just taken" and fresh slots. There is a test that fires both requests concurrently.
- **Callback data is never trusted.** Button payloads come from the client and can be stale or forged, so every slot is re-checked against the schedule and the database before it is shown for confirmation and again before it is saved.
- **Reminders are claimed atomically.** A single `UPDATE … RETURNING` marks bookings as reminded, so a reminder is never sent twice even if checks overlap, and nobody gets a "reminder" for a visit booked a minute ago.
- **Time zones are explicit.** Times are stored as `timestamptz` and all slot maths happens in `Europe/Minsk`, independent of the server's time zone.
- **Slot calculation is a pure function** (`src/slots.ts`) with unit tests for edge cases: back-to-back bookings, lead time, closing time, days off.

## Run it

1. Create a bot with [@BotFather](https://t.me/BotFather) and copy the token.
2. `cp .env.example .env` and fill in `BOT_TOKEN` and your Telegram ID in `ADMIN_IDS` (get it from [@userinfobot](https://t.me/userinfobot)).
3. Start everything:

```bash
docker compose up -d --build
```

The schema and demo services are created automatically on first start.

### Without Docker

```bash
npm install
npm run dev        # needs a running PostgreSQL and DATABASE_URL in .env
```

## Tests

```bash
npm test                                                   # unit tests
TEST_DATABASE_URL=postgres://user:pass@localhost:5432/bot_test npm test   # + integration tests on a real database
```

Integration tests cover overlapping and concurrent bookings, cancellation rules, re-runnable migrations and reminder claiming.

## Project structure

```
src/
  index.ts          entry point: config, migrations, bot, reminders, graceful shutdown
  bot.ts            conversation flow and handlers
  keyboards.ts      inline and reply keyboards
  slots.ts          free-slot calculation (pure)
  repository.ts     all SQL queries
  db.ts             connection pool and schema
  reminders.ts      background reminder loop
  schedule.ts       working hours and business info
  format.ts         Russian date and text formatting
```

## Possible next steps

- Several masters, each with their own schedule
- Persistent session storage (sessions are in memory, so an unfinished booking is lost on restart — saved bookings are not)
- An admin panel in React for editing services and working hours

---

Author: Egor Kapyshin
