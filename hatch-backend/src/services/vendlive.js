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
      'Authorization': `${token}`,
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
export async function getOrderSales(config, { startId, startDate, endDate, pageSize = 100 } = {}) {
  const client = createClient(config);

  const params = new URLSearchParams();
  if (config.accountId) params.set('accountId', config.accountId);
  if (pageSize) params.set('pageSize', String(pageSize));
  if (startId) params.set('startId', String(startId));
  if (startDate) params.set('startDate', startDate);
  if (endDate) params.set('endDate', endDate);

  let allResults = [];
  const queryString = params.toString();
  let url = `/order-sales/${queryString ? '?' + queryString : ''}`;
  let pageCount = 0;
  const MAX_PAGES = 100; // Safety limit

  while (url && pageCount < MAX_PAGES) {
    const data = await requestWithRetry(client, 'get', url);
    const results = data?.results || data?.data || [];
    if (Array.isArray(results)) {
      allResults = allResults.concat(results);
    }
    url = data?.next || data?.links?.next || null;
    // If next is a full URL, extract the path
    if (url && url.startsWith('http')) {
      try {
        const parsed = new URL(url);
        url = parsed.pathname + parsed.search;
      } catch {
        // If URL parsing fails, use as-is
      }
    }
    pageCount++;
  }

  return { results: allResults, pageCount };
}
