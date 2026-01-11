import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge Tailwind classes safely
 */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

/**
 * Format currency in GBP
 */
export function formatCurrency(amount, options = {}) {
  const { minimumFractionDigits = 2, maximumFractionDigits = 2 } = options;
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(amount);
}

/**
 * Format date in UK format
 */
export function formatDate(date, options = {}) {
  const { includeTime = false, relative = false } = options;
  const d = new Date(date);
  
  if (relative) {
    const now = new Date();
    const diff = now - d;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
  }
  
  const dateStr = d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  
  if (includeTime) {
    const timeStr = d.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
    });
    return `${dateStr} ${timeStr}`;
  }
  
  return dateStr;
}

/**
 * Generate unique ID
 */
export function generateId(prefix = '') {
  return `${prefix}${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Generate SKU from product name
 */
export function generateSku(name, category = '') {
  const cleanName = name.replace(/[^a-zA-Z0-9]/g, '').substring(0, 8).toUpperCase();
  const catPrefix = category.substring(0, 3).toUpperCase() || 'PRD';
  const timestamp = Date.now().toString().slice(-4);
  return `${catPrefix}-${cleanName}-${timestamp}`;
}

/**
 * Parse CSV line handling quoted fields
 */
export function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Calculate stock status based on thresholds
 */
export function getStockStatus(current, min, max) {
  if (!min && !max) return { status: 'unknown', color: 'zinc' };
  if (current <= 0) return { status: 'out', color: 'red', label: 'Out of Stock' };
  if (min && current <= min) return { status: 'low', color: 'red', label: 'Low' };
  if (min && current <= min * 1.5) return { status: 'warning', color: 'yellow', label: 'Warning' };
  if (max && current >= max) return { status: 'full', color: 'emerald', label: 'Full' };
  return { status: 'ok', color: 'zinc', label: 'OK' };
}

/**
 * Calculate expiry status
 */
export function getExpiryStatus(expiryDate) {
  if (!expiryDate) return null;
  
  const now = new Date();
  const expiry = new Date(expiryDate);
  const daysUntil = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
  
  if (daysUntil < 0) {
    return { status: 'expired', label: 'Expired', days: daysUntil, color: 'red' };
  }
  if (daysUntil <= 7) {
    return { status: 'critical', label: `${daysUntil}d`, days: daysUntil, color: 'red' };
  }
  if (daysUntil <= 30) {
    return { status: 'warning', label: `${daysUntil}d`, days: daysUntil, color: 'yellow' };
  }
  return { status: 'ok', label: `${daysUntil}d`, days: daysUntil, color: 'emerald' };
}

/**
 * Debounce function
 */
export function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Deep clone object
 */
export function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Check if objects are equal (shallow)
 */
export function shallowEqual(obj1, obj2) {
  const keys1 = Object.keys(obj1);
  const keys2 = Object.keys(obj2);
  
  if (keys1.length !== keys2.length) return false;
  
  return keys1.every(key => obj1[key] === obj2[key]);
}

/**
 * Group array by key
 */
export function groupBy(array, key) {
  return array.reduce((groups, item) => {
    const group = item[key];
    groups[group] = groups[group] || [];
    groups[group].push(item);
    return groups;
  }, {});
}

/**
 * Sort array by key
 */
export function sortBy(array, key, order = 'asc') {
  return [...array].sort((a, b) => {
    const aVal = a[key];
    const bVal = b[key];
    
    if (aVal < bVal) return order === 'asc' ? -1 : 1;
    if (aVal > bVal) return order === 'asc' ? 1 : -1;
    return 0;
  });
}

/**
 * Filter products by search term
 */
export function searchProducts(products, searchTerm) {
  if (!searchTerm) return products;
  
  const term = searchTerm.toLowerCase();
  return products.filter(p => 
    p.name?.toLowerCase().includes(term) ||
    p.sku?.toLowerCase().includes(term) ||
    p.category?.toLowerCase().includes(term)
  );
}
