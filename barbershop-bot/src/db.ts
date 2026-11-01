import pg from 'pg';

// Bookings may not overlap: the exclusion constraint makes PostgreSQL itself
// reject a second active booking for an overlapping time range, so two clients
// pressing "confirm" at the same moment can't both get the same slot.
const schemaSql = `
CREATE TABLE IF NOT EXISTS services (
  id           SERIAL PRIMARY KEY,
  title        TEXT NOT NULL UNIQUE,
  duration_min INT NOT NULL CHECK (duration_min > 0),
  price_byn    NUMERIC(8, 2) NOT NULL CHECK (price_byn >= 0)
);

CREATE TABLE IF NOT EXISTS clients (
  telegram_id BIGINT PRIMARY KEY,
  name        TEXT NOT NULL,
  phone       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bookings (
  id          SERIAL PRIMARY KEY,
  client_id   BIGINT NOT NULL REFERENCES clients (telegram_id),
  service_id  INT NOT NULL REFERENCES services (id),
  starts_at   TIMESTAMPTZ NOT NULL,
  ends_at     TIMESTAMPTZ NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  reminded    BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CONSTRAINT bookings_no_overlap
    EXCLUDE USING gist (tstzrange(starts_at, ends_at) WITH &&) WHERE (status = 'active')
);

CREATE INDEX IF NOT EXISTS bookings_client_idx ON bookings (client_id, starts_at);

INSERT INTO services (title, duration_min, price_byn) VALUES
  ('Мужская стрижка', 60, 35),
  ('Стрижка машинкой', 30, 20),
  ('Оформление бороды', 30, 20),
  ('Стрижка + борода', 90, 50)
ON CONFLICT (title) DO NOTHING;
`;

export const createPool = (connectionString: string): pg.Pool => new pg.Pool({ connectionString });

export const migrate = async (pool: pg.Pool): Promise<void> => {
  await pool.query(schemaSql);
};
