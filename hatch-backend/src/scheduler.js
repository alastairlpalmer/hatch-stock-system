import cron from 'node-cron';
import prisma from './utils/db.js';
import { runPollSync } from './services/vendlive-sync.js';

let isRunning = false;

export function startScheduler() {
  // Check every minute if it's time to poll
  cron.schedule('* * * * *', async () => {
    if (isRunning) return; // Prevent overlapping runs

    try {
      const config = await prisma.vendliveConfig.findUnique({ where: { id: 'default' } });
      if (!config?.salesSyncEnabled || !config?.apiToken) return;

      const intervalMs = (config.pollIntervalMin || 15) * 60 * 1000;
      const lastPoll = config.lastPollAt ? new Date(config.lastPollAt).getTime() : 0;

      if (Date.now() - lastPoll >= intervalMs) {
        isRunning = true;
        console.log('VendLive poll sync starting...');
        const result = await runPollSync();
        if (result) {
          console.log(`VendLive poll sync complete: ${result.created} created, ${result.skipped} skipped, ${result.errored} errored`);
        }
      }
    } catch (err) {
      console.error('VendLive poll scheduler error:', err.message);
    } finally {
      isRunning = false;
    }
  });

  console.log('VendLive poll scheduler started (checks every minute)');
}
