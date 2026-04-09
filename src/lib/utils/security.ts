/**
 * Security Utilities
 * Input validation, sanitization, and security helpers
 */

// ============================================================================
// XSS Prevention
// ============================================================================

/**
 * Escape HTML special characters to prevent XSS attacks
 */
export function escapeHTML(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Sanitize user input for safe CLI storage
 * Removes control characters that could break parsing
 */
export function sanitizeInput(str: string): string {
  if (!str) return '';
  // Remove null bytes and control characters (except newlines/tabs)
  return str.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '');
}

// ============================================================================
// Prototype Pollution Prevention
// ============================================================================

const DANGEROUS_KEYS = ['__proto__', 'constructor', 'prototype'];

/**
 * Check if a key is dangerous for prototype pollution
 */
export function isDangerousKey(key: string): boolean {
  return DANGEROUS_KEYS.includes(key);
}

/**
 * Filter dangerous keys from an object
 */
export function filterDangerousKeys<T extends Record<string, any>>(obj: T): T {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!isDangerousKey(key)) {
      result[key] = value;
    }
  }
  return result as T;
}

/**
 * Safe JSON parse that prevents prototype pollution
 */
export function safeJSONParse<T>(json: string, defaultValue: T): T {
  try {
    return JSON.parse(json, (key, value) => {
      if (isDangerousKey(key)) {
        return undefined;
      }
      return value;
    });
  } catch {
    return defaultValue;
  }
}

// ============================================================================
// Input Validation
// ============================================================================

/**
 * Validate IPv4 address format
 */
export function isValidIPv4(ip: string): boolean {
  const pattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  if (!pattern.test(ip)) return false;
  
  const parts = ip.split('.').map(Number);
  return parts.every(p => p >= 0 && p <= 255);
}

/**
 * Validate IPv6 address format (simplified)
 */
export function isValidIPv6(ip: string): boolean {
  // Basic IPv6 validation
  // Supports: full form, compressed (::), and with prefix length
  const ipv6Pattern = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::1$|^::$|^([0-9a-fA-F]{1,4}:){0,6}::([0-9a-fA-F]{1,4}:){0,6}[0-9a-fA-F]{1,4}$/;
  
  // Remove prefix length if present
  const [addr] = ip.split('/');
  return ipv6Pattern.test(addr);
}

/**
 * Validate MAC address format (Cisco notation)
 */
export function isValidMAC(mac: string): boolean {
  // Cisco format: xxxx.xxxx.xxxx
  const ciscoPattern = /^[0-9a-fA-F]{4}\.[0-9a-fA-F]{4}\.[0-9a-fA-F]{4}$/;
  // Standard format: xx:xx:xx:xx:xx:xx or xx-xx-xx-xx-xx-xx
  const standardPattern = /^([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}$/;
  
  return ciscoPattern.test(mac) || standardPattern.test(mac);
}

/**
 * Normalize MAC address to Cisco format (xxxx.xxxx.xxxx)
 */
export function normalizeMAC(mac: string): string | null {
  if (!isValidMAC(mac)) return null;
  
  // Remove separators and convert to lowercase
  const clean = mac.toLowerCase().replace(/[.:-]/g, '');
  
  // Format as xxxx.xxxx.xxxx
  return `${clean.slice(0, 4)}.${clean.slice(4, 8)}.${clean.slice(8, 12)}`;
}

/**
 * Validate VLAN ID
 */
export function isValidVLAN(vlanId: number): boolean {
  return Number.isInteger(vlanId) && vlanId >= 1 && vlanId <= 4094;
}

/**
 * Validate hostname (RFC 1123 compliant)
 */
export function isValidHostname(hostname: string): boolean {
  // Must start with letter or digit, max 63 chars, only alphanumeric and hyphen
  const pattern = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,62}$/;
  return pattern.test(hostname) && !hostname.endsWith('-');
}

/**
 * Validate ACL name/number
 */
export function isValidACLName(name: string): boolean {
  // Named ACL: alphanumeric, max 31 chars
  if (/^[a-zA-Z][a-zA-Z0-9-_]{0,30}$/.test(name)) return true;
  // Numbered ACL: 1-99, 100-199, 1300-1999, 2000-2699
  const num = parseInt(name, 10);
  return (
    (num >= 1 && num <= 99) ||
    (num >= 100 && num <= 199) ||
    (num >= 1300 && num <= 1999) ||
    (num >= 2000 && num <= 2699)
  );
}

/**
 * Validate subnet mask (IPv4)
 */
export function isValidSubnetMask(mask: string): boolean {
  if (!isValidIPv4(mask)) return false;
  
  const parts = mask.split('.').map(Number);
  // Convert to binary string
  const binary = parts.map(p => p.toString(2).padStart(8, '0')).join('');
  
  // Valid mask has all 1s followed by all 0s
  return /^1*0*$/.test(binary);
}

/**
 * Validate port number
 */
export function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

// ============================================================================
// Resource Limits
// ============================================================================

export const LIMITS = {
  MAX_VLANS: 4094,
  MAX_INTERFACES: 256,
  MAX_ROUTES: 10000,
  MAX_ACL_ENTRIES: 1000,
  MAX_MAC_ADDRESSES: 1000,
  MAX_DHCP_POOLS: 100,
  MAX_NAT_TRANSLATIONS: 10000,
  HOSTNAME_MAX_LEN: 63,
  DESCRIPTION_MAX_LEN: 240,
  BANNER_MAX_LEN: 4096,
  CONFIG_LINE_MAX_LEN: 1024,
} as const;

/**
 * Truncate string to maximum length
 */
export function truncate(str: string, maxLen: number): string {
  if (!str || str.length <= maxLen) return str;
  return str.slice(0, maxLen);
}
