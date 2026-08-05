import { Pool } from "pg";

const lockPool = new Pool({
  connectionString: process.env.DATABASE_URL_APP ?? process.env.DATABASE_URL,
  max: 10,
  keepAlive: true,
});

function hashStringToIntPair(str: string): [number, number] {
  let h1 = 0xdeadbeef ^ 0x9e3779b9;
  let h2 = 0x41c6ce57 ^ 0x85ebca6b;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761) | 0;
    h2 = Math.imul(h2 ^ ch, 1597334677) | 0;
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) | 0;
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909) | 0;
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) | 0;
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909) | 0;
  return [h1, h2];
}

export type CronLockHandle = {
  release: () => Promise<void>;
};

export async function acquireCronLock(cronName: string): Promise<CronLockHandle | null> {
  const [key1, key2] = hashStringToIntPair(`cron:${cronName}`);
  const client = await lockPool.connect();

  try {
    const res = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1::int, $2::int) AS locked",
      [key1, key2],
    );
    const acquired = res.rows[0]?.locked === true;

    if (!acquired) {
      client.release();
      return null;
    }

    return {
      release: async () => {
        try {
          await client.query("SELECT pg_advisory_unlock($1::int, $2::int)", [key1, key2]);
        } finally {
          client.release();
        }
      },
    };
  } catch (err) {
    client.release();
    console.error(`[cron-lock] falha ao tentar adquirir lock para "${cronName}"`, err);
    throw err;
  }
}
