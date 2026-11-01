import { loadConfig } from './config.js';
import { createPool, migrate } from './db.js';
import { createRepository } from './repository.js';
import { schedule } from './schedule.js';
import { createBot } from './bot.js';
import { startReminders } from './reminders.js';

const main = async (): Promise<void> => {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);
  await migrate(pool);

  const repository = createRepository(pool, schedule.timezone);
  const bot = createBot({ token: config.botToken, repository, schedule, adminIds: config.adminIds });

  await bot.api.setMyCommands([{ command: 'start', description: 'Главное меню' }]);
  const stopReminders = startReminders(bot.api, repository, schedule.reminderBeforeMinutes);

  const shutdown = async (): Promise<void> => {
    stopReminders();
    await bot.stop();
    await pool.end();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  await bot.start({ onStart: (info) => console.log(`Bot @${info.username} is running`) });
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
