// Just the parts of the Workers runtime the Durable Object uses. (Cloudflare's full types,
// @cloudflare/workers-types, would clash with the browser types the game is checked against.)
interface SqlStorage {
  exec(query: string, ...bindings: unknown[]): { toArray(): Record<string, unknown>[] };
}
interface DurableObjectState {
  storage: { sql: SqlStorage };
}
declare module 'cloudflare:workers' {
  export abstract class DurableObject<Env = unknown> {
    protected ctx: DurableObjectState;
    protected env: Env;
    constructor(ctx: DurableObjectState, env: Env);
  }
}
