import { DEMO_CLEAR_INTERVAL, MODE } from './env.ts';
import { KV } from './storage.ts';

if (MODE === 'demo') {
  Deno.cron(
    'Clear KV',
    { minute: { every: DEMO_CLEAR_INTERVAL } },
    async () => {
      for await (const e of KV.list({ prefix: [] })) {
        await KV.delete(e.key);
      }
    },
  );
}
