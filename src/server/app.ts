import { Hono } from 'hono';
import { registerAll } from './registry';

export function createApp(): Hono {
  const app = new Hono();
  registerAll(app);
  return app;
}
