import cron from 'node-cron';
import prisma from './utils/db.js';
import { runPollSync } from './services/vendlive-sync.js';
import { runStockPollJob, syncProductCatalog, syncAllMachines } from './services/vendlive-stock.js';
import { promoteAllDrafts } from './services/planogram-promote.js';

let salesJobRunning = false;
let stockJobRunning = false;
let productJobRunning = false;
let fridayBaselineRunning = false;
let planogramPromoteRunning = false;
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
        console.log(`VendLive stock poll complete: ${result.machinesChecked} machines checked, ${result.syncsTriggered} syncs triggered (${result.restockSyncs} restock, ${result.driftSyncs} planogram change, ${result.fallbackSyncs} stale fallback)`);
      }
    } catch (err) {
      console.error('VendLive stock poll scheduler error:', err.message);
    } finally {
      stockJobRunning = false;
    }
  });

  // Product catalog poll — proactively pulls the full VendLive product catalog
  // so products exist in our DB before they are ever sold. Honours
  // productSyncEnabled / productSyncIntervalMin (default daily). lastProductSyncAt
  // is persisted on the config so the cadence survives restarts.
  cron.schedule('* * * * *', async () => {
    if (productJobRunning) return;

    try {
      const config = await prisma.vendliveConfig.findUnique({ where: { id: 'default' } });
      if (!config?.productSyncEnabled || !config?.apiToken) return;

      const intervalMs = (config.productSyncIntervalMin || 1440) * 60 * 1000;
      const lastSync = config.lastProductSyncAt ? new Date(config.lastProductSyncAt).getTime() : 0;
      if (Date.now() - lastSync < intervalMs) return;

      productJobRunning = true;
      console.log('VendLive product catalog sync starting...');
      const result = await syncProductCatalog(config);
      await prisma.vendliveConfig.update({
        where: { id: 'default' },
        data: { lastProductSyncAt: new Date() },
      });
      console.log(`VendLive product catalog sync complete: ${result.created} created, ${result.updated} updated`);
    } catch (err) {
      console.error('VendLive product sync scheduler error:', err.message);
    } finally {
      productJobRunning = false;
    }
  });

  // Friday-baseline full stock sync — machines sell Mon–Fri only, so the level
  // captured on Friday evening is frozen until the Monday-morning restock. A
  // guaranteed full sync here gives the weekly ordering engine (and Monday's
  // pick lists) an accurate weekend baseline even when no restock-triggered
  // sync has fired all week.
  cron.schedule('0 20 * * 5', async () => {
    if (fridayBaselineRunning) return;

    try {
      const config = await prisma.vendliveConfig.findUnique({ where: { id: 'default' } });
      if (!config?.stockSyncEnabled || !config?.apiToken) return;

      fridayBaselineRunning = true;
      console.log('[scheduler] friday-baseline: full machine stock sync starting...');
      const result = await syncAllMachines(config);
      console.log(`[scheduler] friday-baseline: complete — ${result?.machinesSynced ?? 0} machines synced, ${result?.machinesErrored ?? 0} errors`);
    } catch (err) {
      console.error('[scheduler] friday-baseline error:', err.message);
    } finally {
      fridayBaselineRunning = false;
    }
  }, { timezone: 'Europe/London' });

  // Monday 05:00 London — auto-promote every next-week draft planogram before
  // restock hours. Opt-in via PLANOGRAM_AUTO_PROMOTE=1 so ops can trust the
  // manual "Go live" flow first.
  if (process.env.PLANOGRAM_AUTO_PROMOTE === '1') {
    cron.schedule('0 5 * * 1', async () => {
      if (planogramPromoteRunning) return;
      planogramPromoteRunning = true;
      try {
        const results = await promoteAllDrafts();
        for (const r of results) {
          if (r.ok) {
            console.log(`[scheduler] planogram promote ${r.locationId}: ${r.result.created} created, ${r.result.closed} closed`);
          } else {
            console.error(`[scheduler] planogram promote ${r.locationId} FAILED: ${r.error}`);
          }
        }
        if (results.length === 0) console.log('[scheduler] planogram promote: no drafts to promote');
      } catch (err) {
        console.error('[scheduler] planogram promote error:', err.message);
      } finally {
        planogramPromoteRunning = false;
      }
    }, { timezone: 'Europe/London' });
  }

  console.log('VendLive schedulers started (sales + stock + products + Friday baseline'
    + (process.env.PLANOGRAM_AUTO_PROMOTE === '1' ? ' + Monday planogram promote)' : ')'));
}
