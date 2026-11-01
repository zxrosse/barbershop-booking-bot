import 'dotenv/config';

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Environment variable ${name} is not set. See .env.example.`);
  return value;
};

const parseAdminIds = (raw: string | undefined): number[] =>
  (raw ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    .map(Number)
    .filter(Number.isInteger);

export const loadConfig = () => ({
  botToken: requireEnv('BOT_TOKEN'),
  databaseUrl: requireEnv('DATABASE_URL'),
  adminIds: parseAdminIds(process.env.ADMIN_IDS),
});
