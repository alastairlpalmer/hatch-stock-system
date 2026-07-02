import React, { useState, useEffect, useCallback } from 'react';
import { useStock } from '../../context/StockContext';
import { vendliveService } from '../../services/vendlive.service';
import api from '../../services/api';
import { formatCurrency, formatDate } from '../../utils/helpers';

export default function AdminVendlive() {
  const { data } = useStock();
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadConfig = useCallback(async () => {
    try {
      const cfg = await vendliveService.getConfig();
      setConfig(cfg);
    } catch (err) {
      console.error('Failed to load VendLive config:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  if (loading) {
    return <div className="text-zinc-500 text-sm py-8 text-center">Loading VendLive configuration...</div>;
  }

  return (
    <div className="space-y-6">
      <ConnectionSettings config={config} onUpdate={loadConfig} setError={setError} />
      <SyncSettings config={config} onUpdate={loadConfig} />
      <StockSyncSettings config={config} onUpdate={loadConfig} />
      <ProductSyncSettings config={config} onUpdate={loadConfig} />
      <WebhookSettings config={config} onUpdate={loadConfig} />
      <QuarantinePanel />
      <MachineMappings locations={data.locations || []} />
      <SyncHistory />
      <StockSyncHistory />
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400 text-sm">{error}</div>
      )}
    </div>
  );
}

// Shared bits ---------------------------------------------------------------

const errMsg = (err) => err.response?.data?.error || err.message;

function Toggle({ label, checked, onChange }) {
  return (
    <div className="flex items-center justify-between bg-zinc-800/50 rounded-lg p-3">
      <span className="text-sm text-zinc-300">{label}</span>
      <button
        onClick={() => onChange(!checked)}
        className={`relative w-10 h-5 rounded-full transition-colors ${checked ? 'bg-emerald-500' : 'bg-zinc-700'}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${checked ? 'translate-x-5' : ''}`} />
      </button>
    </div>
  );
}

function InlineError({ error }) {
  if (!error) return null;
  return <p className="text-sm text-red-400">{error}</p>;
}

// ============ CONNECTION SETTINGS ============

function ConnectionSettings({ config, onUpdate, setError }) {
  const [form, setForm] = useState({
    apiToken: '',
    accountId: config?.accountId || '',
    baseUrl: config?.baseUrl || 'https://vendlive.com/api/2.0',
  });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [saveMsg, setSaveMsg] = useState(null);

  useEffect(() => {
    if (config) {
      setForm(prev => ({
        ...prev,
        accountId: config.accountId || '',
        baseUrl: config.baseUrl || 'https://vendlive.com/api/2.0',
      }));
    }
  }, [config]);

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const payload = { accountId: form.accountId, baseUrl: form.baseUrl };
      if (form.apiToken) payload.apiToken = form.apiToken;
      await vendliveService.updateConfig(payload);
      setSaveMsg('Settings saved');
      setForm(prev => ({ ...prev, apiToken: '' }));
      onUpdate();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await vendliveService.testConnection();
      setTestResult(result);
    } catch (err) {
      setTestResult({ success: false, error: err.response?.data?.error || err.message });
    } finally {
      setTesting(false);
    }
  };

  const isConnected = config?.apiToken;

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-zinc-100">Connection Settings</h3>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
          <span className="text-xs text-zinc-500">{isConnected ? 'Configured' : 'Not Configured'}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm text-zinc-400 mb-1">API Token</label>
          <input
            type="password"
            value={form.apiToken}
            onChange={e => setForm(prev => ({ ...prev, apiToken: e.target.value }))}
            placeholder={config?.apiToken ? '••••••••' : 'Enter API token'}
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-emerald-500"
          />
        </div>
        <div>
          <label className="block text-sm text-zinc-400 mb-1">Account ID</label>
          <input
            type="text"
            value={form.accountId}
            onChange={e => setForm(prev => ({ ...prev, accountId: e.target.value }))}
            placeholder="VendLive account ID"
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-emerald-500"
          />
        </div>
        <div className="md:col-span-2">
          <label className="block text-sm text-zinc-400 mb-1">Base URL</label>
          <input
            type="text"
            value={form.baseUrl}
            onChange={e => setForm(prev => ({ ...prev, baseUrl: e.target.value }))}
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-emerald-500"
          />
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-sm disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
        <button
          onClick={handleTest}
          disabled={testing || !isConnected}
          className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded text-sm disabled:opacity-50"
        >
          {testing ? 'Testing...' : 'Test Connection'}
        </button>
        {saveMsg && <span className="text-sm text-emerald-400">{saveMsg}</span>}
        {testResult && (
          <span className={`text-sm ${testResult.success ? 'text-emerald-400' : 'text-red-400'}`}>
            {testResult.success ? `Connected — ${testResult.machineCount} machines found` : testResult.error}
          </span>
        )}
      </div>
    </div>
  );
}

// ============ SYNC SETTINGS ============

function SyncSettings({ config, onUpdate }) {
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [error, setError] = useState(null);

  // Save a partial config update; failures surface inline (not swallowed)
  const saveField = async (payload) => {
    setError(null);
    try {
      await vendliveService.updateConfig(payload);
      onUpdate();
    } catch (err) {
      setError(errMsg(err));
    }
  };

  const handleManualSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const result = await vendliveService.triggerSync();
      setSyncResult(result);
    } catch (err) {
      setSyncResult({ success: false, error: errMsg(err) });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 space-y-4">
      <h3 className="text-lg font-medium text-zinc-100">Sales Sync Settings</h3>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Toggle
          label="Enable Sales Sync"
          checked={!!config?.salesSyncEnabled}
          onChange={v => saveField({ salesSyncEnabled: v })}
        />
        <Toggle
          label="Auto-Create Products"
          checked={!!config?.autoCreateProducts}
          onChange={v => saveField({ autoCreateProducts: v })}
        />
        <div className="flex items-center justify-between bg-zinc-800/50 rounded-lg p-3">
          <span className="text-sm text-zinc-300">Poll Interval</span>
          <select
            value={config?.pollIntervalMin || 15}
            onChange={e => saveField({ pollIntervalMin: parseInt(e.target.value) })}
            className="bg-zinc-700 border border-zinc-600 rounded px-2 py-1 text-sm text-zinc-200"
          >
            <option value={5}>5 min</option>
            <option value={10}>10 min</option>
            <option value={15}>15 min</option>
            <option value={30}>30 min</option>
            <option value={60}>60 min</option>
          </select>
        </div>
      </div>

      <InlineError error={error} />

      {config?.lastPollAt && (
        <p className="text-xs text-zinc-500">
          Last poll: {formatDate(config.lastPollAt, { includeTime: true })}
          {config.lastPollSaleId && ` (sale ID: ${config.lastPollSaleId})`}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={handleManualSync}
          disabled={syncing || !config?.apiToken}
          className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded text-sm disabled:opacity-50"
        >
          {syncing ? 'Syncing...' : 'Sync Now'}
        </button>
        {syncResult && (
          <span className={`text-sm ${syncResult.success !== false ? 'text-emerald-400' : 'text-red-400'}`}>
            {syncResult.success !== false
              ? `${syncResult.created} created, ${syncResult.skipped} skipped, ${syncResult.errored} errors`
              : syncResult.error}
          </span>
        )}
      </div>
    </div>
  );
}

// ============ STOCK SYNC SETTINGS ============

function StockSyncSettings({ config, onUpdate }) {
  const [movementTypes, setMovementTypes] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const raw = config?.restockMovementTypes;
    setMovementTypes(Array.isArray(raw) ? raw.join(', ') : (raw || ''));
  }, [config]);

  const saveField = async (payload) => {
    setError(null);
    try {
      await vendliveService.updateConfig(payload);
      onUpdate();
    } catch (err) {
      setError(errMsg(err));
    }
  };

  const handleSaveMovementTypes = async () => {
    setSaving(true);
    setSaveMsg(null);
    setError(null);
    try {
      await vendliveService.updateConfig({ restockMovementTypes: movementTypes });
      setSaveMsg('Saved');
      setTimeout(() => setSaveMsg(null), 2000);
      onUpdate();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 space-y-4">
      <h3 className="text-lg font-medium text-zinc-100">Stock Sync Settings</h3>
      <p className="text-xs text-zinc-500">
        Pulls live machine stock levels from VendLive into location stock on a schedule.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Toggle
          label="Enable Stock Sync"
          checked={!!config?.stockSyncEnabled}
          onChange={v => saveField({ stockSyncEnabled: v })}
        />
        <Toggle
          label="Auto Shrinkage Calc"
          checked={!!config?.autoShrinkageCalc}
          onChange={v => saveField({ autoShrinkageCalc: v })}
        />
        <div className="flex items-center justify-between bg-zinc-800/50 rounded-lg p-3">
          <span className="text-sm text-zinc-300">Poll Interval</span>
          <select
            value={config?.stockPollIntervalMin || 60}
            onChange={e => saveField({ stockPollIntervalMin: parseInt(e.target.value) })}
            className="bg-zinc-700 border border-zinc-600 rounded px-2 py-1 text-sm text-zinc-200"
          >
            <option value={15}>15 min</option>
            <option value={30}>30 min</option>
            <option value={60}>60 min</option>
            <option value={120}>2 hours</option>
            <option value={240}>4 hours</option>
            <option value={480}>8 hours</option>
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm text-zinc-400 mb-1">Restock Movement Types</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={movementTypes}
            onChange={e => setMovementTypes(e.target.value)}
            placeholder="e.g. Restock, Refill"
            className="flex-1 min-w-0 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-emerald-500"
          />
          <button
            onClick={handleSaveMovementTypes}
            disabled={saving}
            className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-sm disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
        <p className="text-xs text-zinc-600 mt-1">
          VendLive movement types treated as restocks (comma-separated) — increases matching these are not counted as shrinkage.
        </p>
      </div>

      {saveMsg && <p className="text-sm text-emerald-400">{saveMsg}</p>}
      <InlineError error={error} />
    </div>
  );
}

// ============ PRODUCT CATALOG SYNC SETTINGS ============

function ProductSyncSettings({ config, onUpdate }) {
  const [error, setError] = useState(null);

  const saveField = async (payload) => {
    setError(null);
    try {
      await vendliveService.updateConfig(payload);
      onUpdate();
    } catch (err) {
      setError(errMsg(err));
    }
  };

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 space-y-4">
      <h3 className="text-lg font-medium text-zinc-100">Product Catalog Sync</h3>
      <p className="text-xs text-zinc-500">
        Periodically imports the full VendLive product catalog so products exist before they are first sold.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Toggle
          label="Enable Product Sync"
          checked={!!config?.productSyncEnabled}
          onChange={v => saveField({ productSyncEnabled: v })}
        />
        <div className="flex items-center justify-between bg-zinc-800/50 rounded-lg p-3">
          <span className="text-sm text-zinc-300">Sync Every</span>
          <select
            value={config?.productSyncIntervalMin || 1440}
            onChange={e => saveField({ productSyncIntervalMin: parseInt(e.target.value) })}
            className="bg-zinc-700 border border-zinc-600 rounded px-2 py-1 text-sm text-zinc-200"
          >
            <option value={60}>1 hour</option>
            <option value={180}>3 hours</option>
            <option value={360}>6 hours</option>
            <option value={720}>12 hours</option>
            <option value={1440}>24 hours</option>
          </select>
        </div>
      </div>

      <p className="text-xs text-zinc-500">
        Last product sync: {config?.lastProductSyncAt
          ? formatDate(config.lastProductSyncAt, { includeTime: true })
          : 'never'}
      </p>

      <InlineError error={error} />
    </div>
  );
}

// ============ WEBHOOK SETTINGS ============

function WebhookSettings({ config, onUpdate }) {
  const [secret, setSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  // GET /config returns the secret masked ('***') when one exists — never the
  // real value. Treat any truthy value as "set".
  const secretIsSet = !!config?.webhookSecret;

  // Derive the backend origin from the axios base URL (stripping a trailing
  // '/api'). If the base URL is relative, fall back to the current origin.
  const apiBase = (api.defaults.baseURL || '').replace(/\/api\/?$/, '');
  const backendOrigin = /^https?:\/\//i.test(apiBase) ? apiBase : window.location.origin;
  const webhookUrl = `${backendOrigin}/api/vendlive/webhook/sales`;

  const handleCopy = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveSecret = async () => {
    if (!secret) return;
    setSaving(true);
    setSaveMsg(null);
    setError(null);
    try {
      await vendliveService.updateConfig({ webhookSecret: secret });
      setSaveMsg('Webhook secret saved');
      setSecret('');
      onUpdate();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-zinc-100">Webhook</h3>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${secretIsSet ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
          <span className="text-xs text-zinc-500">{secretIsSet ? 'Secret set' : 'No secret'}</span>
        </div>
      </div>

      <div>
        <label className="block text-sm text-zinc-400 mb-1">Webhook URL (register in VendLive)</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={webhookUrl}
            readOnly
            className="flex-1 min-w-0 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-400"
          />
          <button
            onClick={handleCopy}
            className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded text-sm"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>

      <div>
        <label className="block text-sm text-zinc-400 mb-1">Webhook Secret</label>
        <div className="flex gap-2">
          <input
            type="password"
            value={secret}
            onChange={e => setSecret(e.target.value)}
            placeholder={secretIsSet ? '•••• set' : 'Enter webhook secret'}
            className="flex-1 min-w-0 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-emerald-500"
          />
          <button
            onClick={handleSaveSecret}
            disabled={saving || !secret}
            className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-sm disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
        <p className="text-xs text-zinc-600 mt-1">
          Used to verify webhook signatures — unsigned requests are rejected. Write-only: the current value is never shown.
        </p>
      </div>

      {saveMsg && <p className="text-sm text-emerald-400">{saveMsg}</p>}
      <InlineError error={error} />
    </div>
  );
}

// ============ QUARANTINED SALES ============

function QuarantinePanel() {
  const [items, setItems] = useState([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [replaying, setReplaying] = useState(false);
  const [replayResult, setReplayResult] = useState(null);
  // Two-tap discard: first tap arms the confirmation for this row
  const [confirmDiscardId, setConfirmDiscardId] = useState(null);

  const loadQuarantine = useCallback(async () => {
    try {
      const data = await vendliveService.getQuarantine(100);
      const rows = data.rows || data.items || [];
      setItems(rows);
      setCount(data.unresolved ?? data.count ?? rows.length);
      setError(null);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadQuarantine(); }, [loadQuarantine]);

  const handleReplay = async () => {
    setReplaying(true);
    setReplayResult(null);
    setError(null);
    try {
      const result = await vendliveService.replayQuarantine();
      setReplayResult(result);
      loadQuarantine();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setReplaying(false);
    }
  };

  const handleDiscard = async (id) => {
    setConfirmDiscardId(null);
    setError(null);
    try {
      await vendliveService.deleteQuarantineItem(id);
      loadQuarantine();
    } catch (err) {
      setError(errMsg(err));
    }
  };

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-medium text-zinc-100">Quarantined Sales</h3>
          {count > 0 && (
            <span className="text-xs px-2 py-0.5 rounded bg-amber-500/20 text-amber-400">{count} unresolved</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {replayResult && (
            <span className="text-xs text-emerald-400">
              {replayResult.replayed} replayed, {replayResult.stillUnknown} still unknown, {replayResult.alreadyExisted} already existed
            </span>
          )}
          <button
            onClick={handleReplay}
            disabled={replaying || items.length === 0}
            className="px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded text-sm disabled:opacity-50"
          >
            {replaying ? 'Replaying...' : 'Replay now'}
          </button>
        </div>
      </div>

      <p className="text-xs text-zinc-500">
        Sales that arrived for unknown products. Add the missing products (or run a product sync), then replay.
      </p>

      <InlineError error={error} />

      {loading ? (
        <div className="text-zinc-500 text-sm py-4 text-center">Loading quarantined sales...</div>
      ) : items.length === 0 ? (
        <div className="text-zinc-500 text-sm py-4 text-center">No quarantined sales</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Product</th>
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">SKU</th>
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Machine</th>
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">When</th>
                <th className="text-right px-4 py-3 text-zinc-500 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={item.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                  <td className="px-4 py-3 text-zinc-200">{item.productName || '—'}</td>
                  <td className="px-4 py-3 text-emerald-400 font-mono text-xs">{item.sku || '—'}</td>
                  <td className="px-4 py-3 text-zinc-400">{item.machineName || '—'}</td>
                  <td className="px-4 py-3 text-zinc-400">
                    {formatDate(item.timestamp || item.createdAt, { includeTime: true })}
                  </td>
                  <td className="text-right px-4 py-3 whitespace-nowrap">
                    {confirmDiscardId === item.id ? (
                      <>
                        <button onClick={() => handleDiscard(item.id)} className="text-red-400 hover:text-red-300 font-medium mr-3">Confirm discard?</button>
                        <button onClick={() => setConfirmDiscardId(null)} className="text-zinc-500 hover:text-white">Cancel</button>
                      </>
                    ) : (
                      <button onClick={() => setConfirmDiscardId(item.id)} className="text-zinc-500 hover:text-red-400">Discard</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ============ MACHINE MAPPINGS ============

function MachineMappings({ locations }) {
  const [mappings, setMappings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detecting, setDetecting] = useState(false);
  const [detectResult, setDetectResult] = useState(null);

  const loadMappings = useCallback(async () => {
    try {
      const data = await vendliveService.getMachineMappings();
      setMappings(data);
    } catch (err) {
      console.error('Failed to load mappings:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadMappings(); }, [loadMappings]);

  const handleAutoDetect = async () => {
    setDetecting(true);
    setDetectResult(null);
    try {
      const result = await vendliveService.autoDetectMachines();
      setDetectResult(result);
      loadMappings();
    } catch (err) {
      setDetectResult({ error: err.response?.data?.error || err.message });
    } finally {
      setDetecting(false);
    }
  };

  const [mapError, setMapError] = useState(null);

  const handleMappingChange = async (vendliveMachineId, machineName, locationId) => {
    setMapError(null);
    try {
      await vendliveService.updateMachineMapping(vendliveMachineId, {
        machineName,
        locationId: locationId || null,
      });
      loadMappings();
    } catch (err) {
      setMapError(errMsg(err));
    }
  };

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-zinc-100">Machine Mapping</h3>
        <div className="flex items-center gap-3">
          {detectResult && !detectResult.error && (
            <span className="text-xs text-emerald-400">{detectResult.created} new, {detectResult.existing} existing</span>
          )}
          {detectResult?.error && (
            <span className="text-xs text-red-400">{detectResult.error}</span>
          )}
          <button
            onClick={handleAutoDetect}
            disabled={detecting}
            className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded text-sm disabled:opacity-50"
          >
            {detecting ? 'Loading...' : 'Load from VendLive'}
          </button>
        </div>
      </div>

      <InlineError error={mapError} />

      {loading ? (
        <div className="text-zinc-500 text-sm py-4 text-center">Loading mappings...</div>
      ) : mappings.length === 0 ? (
        <div className="text-zinc-500 text-sm py-4 text-center">
          No machines found. Click "Load from VendLive" to detect machines.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Machine IDs</th>
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Machine Name</th>
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Hatch Location</th>
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {mappings.map(mapping => (
                <tr key={mapping.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                  <td className="px-4 py-3">
                    {/* Two VendLive ids per machine: the machines API id and the id used in sales payloads */}
                    <div className="text-xs text-zinc-400 font-mono">
                      <span className="text-zinc-600 font-sans">machines&nbsp;</span>{mapping.vendliveMachineId}
                    </div>
                    <div className="text-xs text-zinc-400 font-mono mt-0.5">
                      <span className="text-zinc-600 font-sans">sales&nbsp;</span>{mapping.salesMachineId ?? '—'}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-zinc-200">{mapping.machineName}</td>
                  <td className="px-4 py-3">
                    <select
                      value={mapping.locationId || ''}
                      onChange={e => handleMappingChange(mapping.vendliveMachineId, mapping.machineName, e.target.value)}
                      className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-200 w-full max-w-xs"
                    >
                      <option value="">— Select location —</option>
                      {locations.map(loc => (
                        <option key={loc.id} value={loc.id}>{loc.name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    {mapping.locationId ? (
                      <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400">Mapped</span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-400">Unmapped</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ============ SYNC HISTORY ============

function SyncHistory() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadLogs = async () => {
      try {
        const data = await vendliveService.getSyncLogs();
        setLogs(data);
      } catch (err) {
        console.error('Failed to load sync logs:', err);
      } finally {
        setLoading(false);
      }
    };
    loadLogs();
  }, []);

  const [expandedId, setExpandedId] = useState(null);

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 space-y-4">
      <h3 className="text-lg font-medium text-zinc-100">Sync History</h3>

      {loading ? (
        <div className="text-zinc-500 text-sm py-4 text-center">Loading sync history...</div>
      ) : logs.length === 0 ? (
        <div className="text-zinc-500 text-sm py-4 text-center">No sync activity yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Timestamp</th>
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Type</th>
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Status</th>
                <th className="text-right px-4 py-3 text-zinc-500 font-medium">Created</th>
                <th className="text-right px-4 py-3 text-zinc-500 font-medium">Skipped</th>
                <th className="text-right px-4 py-3 text-zinc-500 font-medium">Errors</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => (
                <React.Fragment key={log.id}>
                  <tr
                    className={`border-b border-zinc-800/50 hover:bg-zinc-800/30 ${log.errorMessage ? 'cursor-pointer' : ''}`}
                    onClick={() => log.errorMessage && setExpandedId(expandedId === log.id ? null : log.id)}
                  >
                    <td className="px-4 py-3 text-zinc-400">
                      {formatDate(log.createdAt, { includeTime: true })}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        log.syncType === 'webhook' ? 'bg-teal-500/20 text-teal-400' :
                        log.syncType === 'poll' ? 'bg-blue-500/20 text-blue-400' :
                        'bg-purple-500/20 text-purple-400'
                      }`}>
                        {log.syncType}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        log.status === 'success' ? 'bg-emerald-500/20 text-emerald-400' :
                        log.status === 'error' ? 'bg-red-500/20 text-red-400' :
                        'bg-yellow-500/20 text-yellow-400'
                      }`}>
                        {log.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-zinc-200">{log.salesCreated}</td>
                    <td className="px-4 py-3 text-right text-zinc-400">{log.salesSkipped}</td>
                    <td className="px-4 py-3 text-right text-red-400">{log.salesErrored}</td>
                  </tr>
                  {expandedId === log.id && log.errorMessage && (
                    <tr>
                      <td colSpan={6} className="px-4 py-2 bg-zinc-800/30">
                        <p className="text-xs text-red-400 font-mono">{log.errorMessage}</p>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ============ STOCK SYNC HISTORY ============

function StockSyncHistory() {
  const [syncs, setSyncs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await vendliveService.getStockSyncs(20);
        setSyncs(data.syncs || []);
      } catch (err) {
        setError(errMsg(err));
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 space-y-4">
      <h3 className="text-lg font-medium text-zinc-100">Stock Sync History</h3>

      <InlineError error={error} />

      {loading ? (
        <div className="text-zinc-500 text-sm py-4 text-center">Loading stock syncs...</div>
      ) : syncs.length === 0 ? (
        <div className="text-zinc-500 text-sm py-4 text-center">No stock syncs yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Machine</th>
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Type</th>
                <th className="text-right px-4 py-3 text-zinc-500 font-medium">Products Updated</th>
                <th className="text-right px-4 py-3 text-zinc-500 font-medium">Variance</th>
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">When</th>
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {syncs.map(sync => (
                <React.Fragment key={sync.id}>
                  <tr
                    className={`border-b border-zinc-800/50 hover:bg-zinc-800/30 ${sync.errorMessage ? 'cursor-pointer' : ''}`}
                    onClick={() => sync.errorMessage && setExpandedId(expandedId === sync.id ? null : sync.id)}
                  >
                    <td className="px-4 py-3 text-zinc-200">
                      {sync.locationName || <span className="text-zinc-500">Unmapped</span>}
                      <span className="text-zinc-600 text-xs ml-2 font-mono">#{sync.vendliveMachineId}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs px-2 py-0.5 rounded bg-blue-500/20 text-blue-400">{sync.syncType}</span>
                    </td>
                    <td className="px-4 py-3 text-right text-zinc-200">{sync.productsUpdated ?? 0}</td>
                    <td className="px-4 py-3 text-right">
                      {sync.totalVariance ? (
                        <span className="text-amber-400">
                          {sync.totalVariance > 0 ? '+' : ''}{sync.totalVariance}
                          {sync.varianceCost != null && (
                            <span className="text-zinc-500 text-xs ml-1">({formatCurrency(sync.varianceCost)})</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-zinc-500">0</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-zinc-400">{formatDate(sync.createdAt, { includeTime: true })}</td>
                    <td className="px-4 py-3">
                      {sync.status === 'error' || sync.errorMessage ? (
                        <span className="text-xs px-2 py-0.5 rounded bg-red-500/20 text-red-400">error</span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400">{sync.status || 'success'}</span>
                      )}
                    </td>
                  </tr>
                  {expandedId === sync.id && sync.errorMessage && (
                    <tr>
                      <td colSpan={6} className="px-4 py-2 bg-zinc-800/30">
                        <p className="text-xs text-red-400 font-mono">{sync.errorMessage}</p>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
