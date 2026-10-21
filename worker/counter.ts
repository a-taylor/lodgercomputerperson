// The daily cap: a Durable Object that counts the day's requests to Gemini. Cloudflare runs one
// instance of it for the whole account, and it handles one call at a time, so two requests can't
// both read 299 and both write 300 (which KV, eventually consistent, would allow). Its storage is
// a small SQLite database: one row per UTC day, kept so you can see past days' counts.
import { DurableObject } from 'cloudflare:workers';

export class DailyCounter extends DurableObject {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS days (day TEXT PRIMARY KEY, count INTEGER NOT NULL)');
  }

  /** Counts one request for `day` (YYYY-MM-DD) if the day is under `limit`. False once it's reached. */
  async take(day: string, limit: number): Promise<boolean> {
    const sql = this.ctx.storage.sql;
    const count = Number(sql.exec('SELECT count FROM days WHERE day = ?', day).toArray()[0]?.count ?? 0);
    if (count >= limit) return false;
    sql.exec('INSERT INTO days (day, count) VALUES (?, 1) ON CONFLICT (day) DO UPDATE SET count = count + 1', day);
    return true;
  }
}
