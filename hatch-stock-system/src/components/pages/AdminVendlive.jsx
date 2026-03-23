import React, { useState, useEffect, useCallback } from 'react';
import { useStock } from '../../context/StockContext';
import { vendliveService } from '../../services/vendlive.service';
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
      <MachineMappings locations={data.locations || []} />
      <SyncHistory />
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400 text-sm">{error}</div>
      )}
    </div>
  );
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
  const [copied, setCopied] = useState(false);

  const handleToggleSync = async (enabled) => {
    try {
      await vendliveService.updateConfig({ salesSyncEnabled: enabled });
      onUpdate();
    } catch (err) {
      console.error('Failed to toggle sync:', err);
    }
  };

  const handleToggleAutoCreate = async (enabled) => {
    try {
      await vendliveService.updateConfig({ autoCreateProducts: enabled });
      onUpdate();
    } catch (err) {
      console.error('Failed to toggle auto-create:', err);
    }
  };

  const handlePollInterval = async (interval) => {
    try {
      await vendliveService.updateConfig({ pollIntervalMin: parseInt(interval) });
      onUpdate();
    } catch (err) {
      console.error('Failed to update poll interval:', err);
    }
  };

  const handleManualSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const result = await vendliveService.triggerSync();
      setSyncResult(result);
    } catch (err) {
      setSyncResult({ success: false, error: err.response?.data?.error || err.message });
    } finally {
      setSyncing(false);
    }
  };

  const webhookUrl = `${window.location.origin.replace(/:\d+$/, ':8000')}/api/vendlive/webhook/sales`;

  const handleCopy = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 space-y-4">
      <h3 className="text-lg font-medium text-zinc-100">Sales Sync Settings</h3>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="flex items-center justify-between bg-zinc-800/50 rounded-lg p-3">
          <span className="text-sm text-zinc-300">Enable Sales Sync</span>
          <button
            onClick={() => handleToggleSync(!config?.salesSyncEnabled)}
            className={`relative w-10 h-5 rounded-full transition-colors ${
              config?.salesSyncEnabled ? 'bg-emerald-500' : 'bg-zinc-700'
            }`}
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
              config?.salesSyncEnabled ? 'translate-x-5' : ''
            }`} />
          </button>
        </div>

        <div className="flex items-center justify-between bg-zinc-800/50 rounded-lg p-3">
          <span className="text-sm text-zinc-300">Auto-Create Products</span>
          <button
            onClick={() => handleToggleAutoCreate(!config?.autoCreateProducts)}
            className={`relative w-10 h-5 rounded-full transition-colors ${
              config?.autoCreateProducts ? 'bg-emerald-500' : 'bg-zinc-700'
            }`}
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
              config?.autoCreateProducts ? 'translate-x-5' : ''
            }`} />
          </button>
        </div>

        <div className="flex items-center justify-between bg-zinc-800/50 rounded-lg p-3">
          <span className="text-sm text-zinc-300">Poll Interval</span>
          <select
            value={config?.pollIntervalMin || 15}
            onChange={e => handlePollInterval(e.target.value)}
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

      <div className="space-y-3">
        <div>
          <label className="block text-sm text-zinc-400 mb-1">Webhook URL (register in VendLive)</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={webhookUrl}
              readOnly
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-400"
            />
            <button
              onClick={handleCopy}
              className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded text-sm"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>

        {config?.lastPollAt && (
          <p className="text-xs text-zinc-500">
            Last poll: {formatDate(config.lastPollAt, { includeTime: true })}
            {config.lastPollSaleId && ` (sale ID: ${config.lastPollSaleId})`}
          </p>
        )}
      </div>

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

  const handleMappingChange = async (vendliveMachineId, machineName, locationId) => {
    try {
      await vendliveService.updateMachineMapping(vendliveMachineId, {
        machineName,
        locationId: locationId || null,
      });
      loadMappings();
    } catch (err) {
      console.error('Failed to update mapping:', err);
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
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Machine ID</th>
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Machine Name</th>
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Hatch Location</th>
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {mappings.map(mapping => (
                <tr key={mapping.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                  <td className="px-4 py-3 text-zinc-400">{mapping.vendliveMachineId}</td>
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
