/**
 * MAC Table Management Utilities
 * Provides aging, bounds checking, and efficient lookups
 */

import { Device } from '../types';
import { LIMITS } from './security';

// MAC entry with timestamp for aging
export interface MACEntry {
  interfaceId: string;
  vlan: number;
  timestamp: number;
  hitCount: number;
}

// Extended MAC table stored separately from base Device type
const macTableExtended = new WeakMap<Device, Map<string, MACEntry>>();

// Default aging time: 5 minutes (in ms)
const DEFAULT_AGING_TIME_MS = 300000;

// Cleanup interval reference
let cleanupInterval: NodeJS.Timeout | null = null;

/**
 * Initialize extended MAC table for a device
 */
export function initializeMACTable(device: Device): void {
  if (!macTableExtended.has(device)) {
    macTableExtended.set(device, new Map());
  }
}

/**
 * Learn a MAC address on an interface
 * Implements bounds checking and aging
 */
export function learnMAC(
  device: Device,
  mac: string,
  interfaceId: string,
  vlan: number = 1
): void {
  // Update base macTable for compatibility
  device.macTable.set(mac, interfaceId);
  
  // Update extended table with metadata
  let extended = macTableExtended.get(device);
  if (!extended) {
    extended = new Map();
    macTableExtended.set(device, extended);
  }
  
  // Check if we need to cleanup before adding
  if (extended.size >= LIMITS.MAX_MAC_ADDRESSES) {
    cleanupAgedEntries(device, DEFAULT_AGING_TIME_MS);
    
    // If still at limit, remove oldest entry
    if (extended.size >= LIMITS.MAX_MAC_ADDRESSES) {
      removeOldestEntry(device);
    }
  }
  
  const existing = extended.get(mac);
  extended.set(mac, {
    interfaceId,
    vlan,
    timestamp: Date.now(),
    hitCount: existing ? existing.hitCount + 1 : 1,
  });
}

/**
 * Look up MAC address and update hit count
 */
export function lookupMAC(device: Device, mac: string): string | null {
  const extended = macTableExtended.get(device);
  if (extended) {
    const entry = extended.get(mac);
    if (entry) {
      entry.hitCount++;
      entry.timestamp = Date.now(); // Update last seen
      return entry.interfaceId;
    }
  }
  
  // Fallback to base table
  return device.macTable.get(mac) || null;
}

/**
 * Get extended MAC entry info
 */
export function getMACEntry(device: Device, mac: string): MACEntry | null {
  const extended = macTableExtended.get(device);
  return extended?.get(mac) || null;
}

/**
 * Remove aged MAC entries
 */
export function cleanupAgedEntries(device: Device, maxAgeMs: number): number {
  const extended = macTableExtended.get(device);
  if (!extended) return 0;
  
  const now = Date.now();
  let removed = 0;
  
  for (const [mac, entry] of extended) {
    if (now - entry.timestamp > maxAgeMs) {
      extended.delete(mac);
      device.macTable.delete(mac);
      removed++;
    }
  }
  
  return removed;
}

/**
 * Remove oldest entry (LRU eviction)
 */
function removeOldestEntry(device: Device): void {
  const extended = macTableExtended.get(device);
  if (!extended || extended.size === 0) return;
  
  let oldestMac: string | null = null;
  let oldestTime = Infinity;
  
  for (const [mac, entry] of extended) {
    if (entry.timestamp < oldestTime) {
      oldestTime = entry.timestamp;
      oldestMac = mac;
    }
  }
  
  if (oldestMac) {
    extended.delete(oldestMac);
    device.macTable.delete(oldestMac);
  }
}

/**
 * Clear MAC table
 */
export function clearMACTable(device: Device): void {
  device.macTable.clear();
  macTableExtended.get(device)?.clear();
}

/**
 * Get MAC table statistics
 */
export function getMACStats(device: Device): {
  total: number;
  byVlan: Map<number, number>;
  oldestEntry: number;
} {
  const extended = macTableExtended.get(device);
  const byVlan = new Map<number, number>();
  let oldestEntry = Date.now();
  
  if (extended) {
    for (const entry of extended.values()) {
      byVlan.set(entry.vlan, (byVlan.get(entry.vlan) || 0) + 1);
      if (entry.timestamp < oldestEntry) {
        oldestEntry = entry.timestamp;
      }
    }
  }
  
  return {
    total: device.macTable.size,
    byVlan,
    oldestEntry,
  };
}

/**
 * Start periodic cleanup for all devices
 */
export function startPeriodicCleanup(
  devices: Device[],
  intervalMs: number = 60000
): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
  }
  
  cleanupInterval = setInterval(() => {
    for (const device of devices) {
      if (device.type === 'switch') {
        cleanupAgedEntries(device, DEFAULT_AGING_TIME_MS);
      }
    }
  }, intervalMs);
}

/**
 * Stop periodic cleanup
 */
export function stopPeriodicCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}
