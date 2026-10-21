// Stands in for the Workers runtime's `cloudflare:workers` module under Vitest.
export abstract class DurableObject<Env = unknown> {
  constructor(
    protected ctx: DurableObjectState,
    protected env: Env,
  ) {}
}
