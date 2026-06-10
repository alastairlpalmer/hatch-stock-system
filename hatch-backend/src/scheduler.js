import cron from 'node-cron';
import prisma from './utils/db.js';
import { runPollSync } from './services/vendlive-sync.js';
import { runStockPollJob } from './services/vendlive-stock.js';

let salesJobRunning = false;
let stockJobRunning = false;
// The config table has no lastStockPollAt column, so the stock job tracks its
// own last run in memory (fine for a single Railway instance; worst case after
// a restart is one early run).
let lastStockPollAt = 0;

export function startScheduler() {
  // Sales poll — check every minute if it's time to poll
  cron.schedule('* * * * *', async () => {
    if (salesJobRunning) return; // Prevent overlapping runs

    try {
      const config = await prisma.vendliveConfig.findUnique({ where: { id: 'default' } });
      if (!config?.salesSyncEnabled || !config?.apiToken) return;

      const intervalMs = (config.pollIntervalMin || 15) * 60 * 1000;
      const lastPoll = config.lastPollAt ? new Date(config.lastPollAt).getTime() : 0;

      if (Date.now() - lastPoll >= intervalMs) {
        salesJobRunning = true;
        console.log('VendLive poll sync starting...');
        const result = await runPollSync();
        if (result) {
          console.log(`VendLive poll sync complete: ${result.created} created, ${result.skipped} skipped, ${result.errored} errored`);
        }
      }
    } catch (err) {
      console.error('VendLive poll scheduler error:', err.message);
    } finally {
      salesJobRunning = false;
    }
  });

  // Stock movement poll — detects restock events at machines and triggers a
  // stock sync (LocationStock ← VendLive channel levels) when one is found.
  // Honours the stockSyncEnabled / stockPollIntervalMin config fields, which
  // previously did nothing because this job was never scheduled.
  cron.schedule('* * * * *', async () => {
    if (stockJobRunning) return;

    try {
      const config = await prisma.vendliveConfig.findUnique({ where: { id: 'default' } });
      if (!config?.stockSyncEnabled || !config?.apiToken) return;

      const intervalMs = (config.stockPollIntervalMin || 10) * 60 * 1000;
      if (Date.now() - lastStockPollAt < intervalMs) return;

      stockJobRunning = true;
      lastStockPollAt = Date.now();
      const result = await runStockPollJob();
      if (result) {
        console.log(`VendLive stock poll complete: ${result.machinesChecked} machines checked, ${result.syncsTriggered} syncs triggered`);
      }
    } catch (err) {
      console.error('VendLive stock poll scheduler error:', err.message);
    } finally {
      stockJobRunning = false;
    }
  });

  console.log('VendLive schedulers started (sales + stock, checked every minute)');
}
