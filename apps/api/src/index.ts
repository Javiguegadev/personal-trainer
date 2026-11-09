import { serve } from '@hono/node-server';
import { createApp } from './app';

const port = Number(process.env.API_PORT ?? 8787);
const app = createApp({
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
  version: process.env.APP_VERSION ?? '0.0.0',
});

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`API listening on http://localhost:${info.port}`);
});
