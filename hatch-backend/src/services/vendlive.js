import axios from 'axios';
import { decrypt } from '../utils/encryption.js';

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

/**
 * Create an authenticated axios client for VendLive API calls.
 */
function createClient(config) {
  const token = config.apiToken ? decrypt(config.apiToken) : null;
  if (!token) {
    throw new Error('VendLive API token is not configured');
  }

  return axios.create({
    baseURL: config.baseUrl || 'https://vendlive.com/api/2.0',
    headers: {
      'Authorization': `Token ${token}`,
      'Content-Type': 'application/json',
    },
    timeout: 30000,
  });
}

/**
 * Make a request with exponential backoff on 429 rate limit errors.
 */
async function requestWithRetry(client, method, url, options = {}) {
  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await client[method](url, options);
      return response.data;
    } catch (err) {
      lastError = err;
      if (err.response?.status === 429 && attempt < MAX_RETRIES) {
        const retryAfter = parseInt(err.response.headers['retry-after']) || 0;
        const backoff = Math.max(retryAfter * 1000, INITIAL_BACKOFF_MS * Math.pow(2, attempt));
        console.log(`VendLive rate limited. Retrying in ${backoff}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await new Promise(resolve => setTimeout(resolve, backoff));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

/**
 * Test the VendLive API connection by fetching machines.
 */
export async function testConnection(config) {
  try {
    const client = createClient(config);
    const data = await requestWithRetry(client, 'get', '/machines/');
    const machines = data?.results || data || [];
    return { success: true, machineCount: Array.isArray(machines) ? machines.length : 0 };
  } catch (err) {
    const message = err.response?.data?.detail || err.message || 'Connection failed';
    return { success: false, error: message };
  }
}

/**
 * Fetch the list of machines from VendLive.
 */
export async function getMachines(config) {
  const client = createClient(config);
  const data = await requestWithRetry(client, 'get', '/machines/');
  return data?.results || data || [];
}

/**
 * Fetch order sales with pagination support.
 * Returns all results across pages.
 */
export async function getOrderSales(config, { startId, startDate, endDate, pageSize } = {}) {
  const client = createClient(config);

  // Build query params - only include if explicitly provided
  const params = new URLSearchParams();
  if (config.accountId) params.set('accountId', config.accountId);
  if (pageSize) params.set('pageSize', String(pageSize));
  if (startId) params.set('startId', String(startId));
  if (startDate) params.set('startDate', startDate);
  if (endDate) params.set('endDate', endDate);

  let allResults = [];
  const queryString = params.toString();
  let url = queryString ? `/order-sales/?${queryString}` : '/order-sales/';
  let pageCount = 0;
  const MAX_PAGES = 100; // Safety limit

  console.log(`VendLive polling: starting fetch from ${url}`);

  while (url && pageCount < MAX_PAGES) {
    try {
      console.log(`VendLive polling: fetching page ${pageCount + 1} from ${url}`);
      const data = await requestWithRetry(client, 'get', url);
      const results = data?.results || data?.data || [];
      console.log(`VendLive polling: page ${pageCount + 1} returned ${results.length} results (total so far: ${allResults.length + results.length})`);
      if (Array.isArray(results)) {
        allResults = allResults.concat(results);
      }
      // Use the next URL as-is — axios ignores baseURL for absolute URLs
      url = data?.next || null;
      pageCount++;
    } catch (err) {
      console.error(`VendLive polling: error on page ${pageCount + 1}: ${err.response?.status} ${err.message}`);
      console.error(`VendLive polling: URL was: ${url}`);
      throw err;
    }
  }

  console.log(`VendLive polling: complete. ${allResults.length} total results across ${pageCount} pages`);
  return { results: allResults, pageCount };
}

/**
 * Fetch stock movements for a machine with pagination support.
 * Returns all results across pages.
 */
export async function getStockMovements(config, { machineId, startDate, endDate, pageSize, singlePage = false } = {}) {
  const client = createClient(config);

  const params = new URLSearchParams();
  if (machineId) params.set('machineId', String(machineId));
  if (startDate) params.set('startDate', startDate);
  if (endDate) params.set('endDate', endDate);
  if (pageSize) params.set('pageSize', String(pageSize));

  const queryString = params.toString();
  let url = queryString ? `/stock-movements/?${queryString}` : '/stock-movements/';

  console.log(`VendLive stock: fetching movements from ${url}`);

  // Single page mode for discovery/proxy endpoints
  if (singlePage) {
    const data = await requestWithRetry(client, 'get', url);
    return data;
  }

  // Full pagination mode for sync
  let allResults = [];
  let pageCount = 0;
  const MAX_PAGES = 50;

  while (url && pageCount < MAX_PAGES) {
    const data = await requestWithRetry(client, 'get', url);
    const results = data?.results || data?.data || [];
    if (Array.isArray(results)) {
      allResults = allResults.concat(results);
    }
    url = data?.next || null;
    pageCount++;
  }

  console.log(`VendLive stock: fetched ${allResults.length} movements across ${pageCount} pages`);
  return { results: allResults, pageCount };
}

/**
 * Fetch all channel data (planogram + stock levels) for a machine.
 * Handles pagination to get all channels.
 */
export async function getChannels(config, { machineId } = {}) {
  const client = createClient(config);

  const params = new URLSearchParams();
  if (machineId) params.set('machineId', String(machineId));

  const queryString = params.toString();
  let url = queryString ? `/channels/?${queryString}` : '/channels/';
  let allResults = [];
  let pageCount = 0;
  const MAX_PAGES = 20;

  console.log(`VendLive stock: fetching channels from ${url}`);

  while (url && pageCount < MAX_PAGES) {
    const data = await requestWithRetry(client, 'get', url);
    const results = data?.results || data?.data || [];
    if (Array.isArray(results)) {
      allResults = allResults.concat(results);
    }
    // Use next URL as-is (axios ignores baseURL for absolute URLs)
    url = data?.next || null;
    pageCount++;
  }

  console.log(`VendLive stock: fetched ${allResults.length} channels across ${pageCount} pages`);
  return allResults;
}

/**
 * Fetch stock report with optional predictions.
 */
export async function getStockReport(config, { machineId, predictions, restockDay } = {}) {
  const client = createClient(config);

  const params = new URLSearchParams();
  if (machineId) params.set('machineId', String(machineId));
  if (predictions) params.set('predictions', 'true');
  if (restockDay) params.set('restockDay', restockDay);

  const queryString = params.toString();
  const url = queryString ? `/stock-report/?${queryString}` : '/stock-report/';

  console.log(`VendLive stock: fetching stock report from ${url}`);
  const data = await requestWithRetry(client, 'get', url);

  return data;
}
