/**
 * ARP Table Management Utilities
 * Provides aging and bounds checking for ARP entries
 */

import { Device } from '../types';
import { LIMITS } from './security';

// ARP entry with timestamp for aging
export interface ARPEntry {
  mac: string;
  timestamp: number;
  hitCount: number;
}

// Extended ARP table stored separately from base Device type
const arpTableExtended = new WeakMap<Device, Map<string, ARPEntry>>();

// Default ARP timeout: 4 hours (in ms) - Cisco default
const DEFAULT_ARP_TIMEOUT_MS = 4 * 60 * 60 * 1000;

/**
 * Initialize extended ARP table for a device
 */
export function initializeARPTable(device: Device): void {
  if (!arpTableExtended.has(device)) {
    arpTableExtended.set(device, new Map());
  }
}

/**
 * Learn an ARP entry
 * Implements bounds checking and aging
 */
export function learnARP(
  device: Device,
  ip: string,
  mac: string
): void {
  // Update base arpTable for compatibility
  device.arpTable.set(ip, mac);
  
  // Update extended table with metadata
  let extended = arpTableExtended.get(device);
  if (!extended) {
    extended = new Map();
    arpTableExtended.set(device, extended);
  }
  
  // Check if we need to cleanup before adding
  if (extended.size >= LIMITS.MAX_MAC_ADDRESSES) {
    cleanupAgedEntries(device, DEFAULT_ARP_TIMEOUT_MS);
    
    // If still at limit, remove oldest entry
    if (extended.size >= LIMITS.MAX_MAC_ADDRESSES) {
      removeOldestEntry(device);
    }
  }
  
  const existing = extended.get(ip);
  extended.set(ip, {
    mac,
    timestamp: Date.now(),
    hitCount: existing ? existing.hitCount + 1 : 1,
  });
}

/**
 * Look up ARP entry and update hit count
 */
export function lookupARP(device: Device, ip: string): string | null {
  const extended = arpTableExtended.get(device);
  if (extended) {
    const entry = extended.get(ip);
    if (entry) {
      entry.hitCount++;
      entry.timestamp = Date.now(); // Update last seen
      return entry.mac;
    }
  }
  
  // Fallback to base table
  return device.arpTable.get(ip) || null;
}

/**
 * Get extended ARP entry info
 */
export function getARPEntry(device: Device, ip: string): ARPEntry | null {
  const extended = arpTableExtended.get(device);
  return extended?.get(ip) || null;
}

/**
 * Remove aged ARP entries
 */
export function cleanupAgedEntries(device: Device, maxAgeMs: number = DEFAULT_ARP_TIMEOUT_MS): number {
  const extended = arpTableExtended.get(device);
  if (!extended) return 0;
  
  const now = Date.now();
  let removed = 0;
  
  for (const [ip, entry] of extended) {
    if (now - entry.timestamp > maxAgeMs) {
      extended.delete(ip);
      device.arpTable.delete(ip);
      removed++;
    }
  }
  
  return removed;
}

/**
 * Remove oldest entry (LRU eviction)
 */
function removeOldestEntry(device: Device): void {
  const extended = arpTableExtended.get(device);
  if (!extended || extended.size === 0) return;
  
  let oldestIP: string | null = null;
  let oldestTime = Infinity;
  
  for (const [ip, entry] of extended) {
    if (entry.timestamp < oldestTime) {
      oldestTime = entry.timestamp;
      oldestIP = ip;
    }
  }
  
  if (oldestIP) {
    extended.delete(oldestIP);
    device.arpTable.delete(oldestIP);
  }
}

/**
 * Clear ARP table
 */
export function clearARPTable(device: Device): void {
  device.arpTable.clear();
  arpTableExtended.get(device)?.clear();
}

/**
 * Get ARP table statistics
 */
export function getARPStats(device: Device): {
  total: number;
  oldestEntry: number;
} {
  const extended = arpTableExtended.get(device);
  let oldestEntry = Date.now();
  
  if (extended) {
    for (const entry of extended.values()) {
      if (entry.timestamp < oldestEntry) {
        oldestEntry = entry.timestamp;
      }
    }
  }
  
  return {
    total: device.arpTable.size,
    oldestEntry,
  };
}

/**
 * Start periodic cleanup for ARP tables
 */
export function startARPPeriodicCleanup(
  devices: Device[],
  intervalMs: number = 60000
): NodeJS.Timeout {
  return setInterval(() => {
    for (const device of devices) {
      if (device.type === 'router') {
        cleanupAgedEntries(device, DEFAULT_ARP_TIMEOUT_MS);
      }
    }
  }, intervalMs);
}
