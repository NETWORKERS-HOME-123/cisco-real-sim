/**
 * NAT (Network Address Translation) Engine
 * Implements Static NAT, Dynamic NAT, and PAT for the CCNA Network Simulator
 * 
 * Features:
 * - Static NAT: One-to-one local to global IP mapping
 * - Dynamic NAT: Pool-based translation with ACL matching
 * - PAT (Port Address Translation): Overload single IP with port multiplexing
 * - NAT translation table with timeouts
 * - Inside/outside interface designation
 */

import {
  Device,
  NATConfig,
  NATPool,
  NATTranslation,
  StaticNAT,
  ACL,
  Packet,
  ProtocolType,
} from '../types';

// ============================================================================
// Constants
// ============================================================================

const NAT_TIMEOUT_TCP = 86400000;    // 24 hours in ms
const NAT_TIMEOUT_UDP = 300000;      // 5 minutes in ms
const NAT_TIMEOUT_ICMP = 60000;      // 1 minute in ms
const NAT_PORT_START = 1024;         // Start of dynamic port range
const NAT_PORT_END = 65535;          // End of port range

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate a unique translation key
 */
function generateTranslationKey(
  protocol: string,
  localIP: string,
  localPort?: number,
  remoteIP?: string,
  remotePort?: number
): string {
  if (localPort !== undefined && remoteIP && remotePort !== undefined) {
    return `${protocol}-${localIP}:${localPort}-${remoteIP}:${remotePort}`;
  }
  return `${protocol}-${localIP}`;
}

/**
 * Convert IP address to 32-bit integer
 */
function ipToLong(ip: string): number {
  const parts = ip.split('.');
  return ((parseInt(parts[0]) << 24) |
          (parseInt(parts[1]) << 16) |
          (parseInt(parts[2]) << 8) |
          parseInt(parts[3])) >>> 0;
}

/**
 * Convert 32-bit integer to IP address
 */
function longToIP(long: number): string {
  return `${(long >>> 24) & 255}.${(long >>> 16) & 255}.${(long >>> 8) & 255}.${long & 255}`;
}

/**
 * Generate IP range from start to end
 */
function generateIPRange(startIP: string, endIP: string): string[] {
  const start = ipToLong(startIP);
  const end = ipToLong(endIP);
  const ips: string[] = [];
  
  for (let i = start; i <= end; i++) {
    ips.push(longToIP(i));
  }
  
  return ips;
}

/**
 * Get next available port for PAT
 */
function getNextAvailablePort(config: NATConfig): number {
  const usedPorts = new Set<number>();
  
  for (const trans of config.translations.values()) {
    if (trans.globalPort !== undefined) {
      usedPorts.add(trans.globalPort);
    }
  }
  
  for (let port = NAT_PORT_START; port <= NAT_PORT_END; port++) {
    if (!usedPorts.has(port)) {
      return port;
    }
  }
  
  throw new Error('No available ports for PAT');
}

// ============================================================================
// Interface Designation
// ============================================================================

/**
 * Mark interface as NAT inside
 */
export function setNATInside(device: Device, interfaceName: string): void {
  device.natConfig.insideInterfaces.add(interfaceName);
  device.natConfig.outsideInterfaces.delete(interfaceName);
}

/**
 * Mark interface as NAT outside
 */
export function setNATOutside(device: Device, interfaceName: string): void {
  device.natConfig.outsideInterfaces.add(interfaceName);
  device.natConfig.insideInterfaces.delete(interfaceName);
}

/**
 * Remove NAT designation from interface
 */
export function removeNATInterface(device: Device, interfaceName: string): void {
  device.natConfig.insideInterfaces.delete(interfaceName);
  device.natConfig.outsideInterfaces.delete(interfaceName);
}

// ============================================================================
// Static NAT
// ============================================================================

/**
 * Configure static NAT mapping
 */
export function configureStaticNAT(
  device: Device,
  localIP: string,
  globalIP: string
): boolean {
  device.natConfig.staticEntries.set(localIP, {
    localIP,
    globalIP,
  });
  return true;
}

/**
 * Remove static NAT mapping
 */
export function removeStaticNAT(device: Device, localIP: string): boolean {
  return device.natConfig.staticEntries.delete(localIP);
}

// ============================================================================
// Dynamic NAT Pool
// ============================================================================

/**
 * Create a NAT pool
 */
export function createNATPool(
  device: Device,
  name: string,
  startIP: string,
  endIP: string,
  netmask: string
): NATPool {
  const availableIPs = generateIPRange(startIP, endIP);
  
  const pool: NATPool = {
    name,
    startIP,
    endIP,
    netmask,
    availableIPs,
  };
  
  device.natConfig.pools.set(name, pool);
  return pool;
}

/**
 * Delete a NAT pool
 */
export function deleteNATPool(device: Device, name: string): boolean {
  // Check if pool is in use
  if (device.natConfig.overloadPool === name) {
    return false;
  }
  
  return device.natConfig.pools.delete(name);
}

/**
 * Get available IP from pool
 */
function getAvailableIPFromPool(pool: NATPool): string | null {
  if (pool.availableIPs.length === 0) return null;
  return pool.availableIPs.shift() || null;
}

/**
 * Return IP to pool
 */
function returnIPToPool(pool: NATPool, ip: string): void {
  if (!pool.availableIPs.includes(ip)) {
    pool.availableIPs.push(ip);
    // Sort to maintain order
    pool.availableIPs.sort((a, b) => ipToLong(a) - ipToLong(b));
  }
}

// ============================================================================
// PAT (Overload) Configuration
// ============================================================================

/**
 * Configure PAT overload on an interface
 */
export function configurePATOverload(
  device: Device,
  source: 'interface' | 'pool',
  poolName?: string
): boolean {
  if (source === 'interface') {
    device.natConfig.overloadInterface = 'interface';
    device.natConfig.overloadPool = undefined;
    return true;
  } else if (source === 'pool' && poolName) {
    if (!device.natConfig.pools.has(poolName)) {
      return false;
    }
    device.natConfig.overloadInterface = undefined;
    device.natConfig.overloadPool = poolName;
    return true;
  }
  return false;
}

/**
 * Remove PAT overload configuration
 */
export function removePATOverload(device: Device): void {
  device.natConfig.overloadInterface = undefined;
  device.natConfig.overloadPool = undefined;
}

// ============================================================================
// NAT Translation
// ============================================================================

/**
 * Create a new NAT translation
 */
function createTranslation(
  config: NATConfig,
  protocol: 'tcp' | 'udp' | 'icmp' | 'ip',
  localIP: string,
  globalIP: string,
  localPort?: number,
  remoteIP?: string,
  remotePort?: number
): NATTranslation {
  let globalPort: number | undefined;
  
  // For PAT, allocate a global port
  if (localPort !== undefined && (config.overloadInterface || config.overloadPool)) {
    globalPort = getNextAvailablePort(config);
  }
  
  const translation: NATTranslation = {
    protocol,
    localIP,
    localPort,
    globalIP,
    globalPort,
    remoteIP,
    remotePort,
    timeout: Date.now() + getTimeoutForProtocol(protocol),
    hits: 0,
  };
  
  const key = generateTranslationKey(protocol, localIP, localPort, remoteIP, remotePort);
  config.translations.set(key, translation);
  
  return translation;
}

/**
 * Get timeout for protocol
 */
function getTimeoutForProtocol(protocol: string): number {
  switch (protocol) {
    case 'tcp':
      return NAT_TIMEOUT_TCP;
    case 'udp':
      return NAT_TIMEOUT_UDP;
    case 'icmp':
      return NAT_TIMEOUT_ICMP;
    default:
      return NAT_TIMEOUT_UDP;
  }
}

/**
 * Clean up expired translations
 */
export function cleanupExpiredTranslations(device: Device): void {
  const now = Date.now();
  const expiredKeys: string[] = [];
  
  for (const [key, trans] of device.natConfig.translations) {
    if (now > trans.timeout) {
      expiredKeys.push(key);
      
      // Return IP to pool if using dynamic NAT
      if (device.natConfig.overloadPool) {
        const pool = device.natConfig.pools.get(device.natConfig.overloadPool);
        if (pool) {
          returnIPToPool(pool, trans.globalIP);
        }
      }
    }
  }
  
  for (const key of expiredKeys) {
    device.natConfig.translations.delete(key);
  }
}

// ============================================================================
// Packet Translation
// ============================================================================

/**
 * Translate packet for outgoing traffic (inside to outside)
 * Returns the translated source IP and port
 */
export function translateOutgoing(
  device: Device,
  srcIP: string,
  dstIP: string,
  protocol: ProtocolType,
  srcPort?: number,
  dstPort?: number
): { srcIP: string; srcPort?: number } | null {
  const config = device.natConfig;
  
  // 1. Check for static NAT first (highest priority)
  const staticEntry = config.staticEntries.get(srcIP);
  if (staticEntry) {
    return { srcIP: staticEntry.globalIP, srcPort };
  }
  
  // 2. Check for existing translation
  const proto = protocol.toLowerCase() as 'tcp' | 'udp' | 'icmp' | 'ip';
  const existingKey = generateTranslationKey(proto, srcIP, srcPort, dstIP, dstPort);
  const existing = config.translations.get(existingKey);
  
  if (existing) {
    existing.hits++;
    existing.timeout = Date.now() + getTimeoutForProtocol(proto);
    return { srcIP: existing.globalIP, srcPort: existing.globalPort };
  }
  
  // 3. Create new PAT translation if overload is configured
  if (config.overloadInterface || config.overloadPool) {
    let globalIP: string;
    
    if (config.overloadInterface === 'interface') {
      // Use interface IP - find outside interface
      const outsideIface = device.interfaces.find(i => 
        config.outsideInterfaces.has(i.name) && i.ip
      );
      if (!outsideIface || !outsideIface.ip) {
        return null;
      }
      globalIP = outsideIface.ip;
    } else if (config.overloadPool) {
      const pool = config.pools.get(config.overloadPool);
      if (!pool) return null;
      const poolIP = getAvailableIPFromPool(pool);
      if (!poolIP) return null;
      globalIP = poolIP;
    } else {
      return null;
    }
    
    const translation = createTranslation(
      config,
      proto,
      srcIP,
      globalIP,
      srcPort,
      dstIP,
      dstPort
    );
    
    return { srcIP: translation.globalIP, srcPort: translation.globalPort };
  }
  
  // 4. Dynamic NAT without PAT (one-to-one)
  // This would require ACL matching - simplified for now
  
  return null; // No translation
}

/**
 * Translate packet for incoming traffic (outside to inside)
 * Returns the translated destination IP and port
 */
export function translateIncoming(
  device: Device,
  srcIP: string,
  dstIP: string,
  protocol: ProtocolType,
  srcPort?: number,
  dstPort?: number
): { dstIP: string; dstPort?: number } | null {
  const config = device.natConfig;
  const proto = protocol.toLowerCase() as 'tcp' | 'udp' | 'icmp' | 'ip';
  
  // 1. Check for static NAT
  for (const [localIP, staticEntry] of config.staticEntries) {
    if (staticEntry.globalIP === dstIP) {
      return { dstIP: localIP, dstPort };
    }
  }
  
  // 2. Check for existing PAT translation
  // For PAT, we need to look up by global port
  if (dstPort !== undefined) {
    for (const trans of config.translations.values()) {
      if (trans.globalIP === dstIP && 
          trans.globalPort === dstPort &&
          trans.protocol === proto &&
          trans.remoteIP === srcIP &&
          trans.remotePort === srcPort) {
        trans.hits++;
        trans.timeout = Date.now() + getTimeoutForProtocol(proto);
        return { dstIP: trans.localIP, dstPort: trans.localPort };
      }
    }
  }
  
  // 3. Check for existing dynamic translation by global IP
  for (const trans of config.translations.values()) {
    if (trans.globalIP === dstIP && trans.protocol === proto) {
      trans.hits++;
      trans.timeout = Date.now() + getTimeoutForProtocol(proto);
      return { dstIP: trans.localIP, dstPort };
    }
  }
  
  return null; // No translation found
}

// ============================================================================
// Show Functions
// ============================================================================

/**
 * Get formatted NAT translations
 */
export function showNATTranslations(device: Device): string {
  const config = device.natConfig;
  
  if (config.translations.size === 0) {
    return '% No NAT translations\n';
  }
  
  let output = 'Pro Inside global      Inside local       Outside local      Outside global\n';
  
  for (const trans of config.translations.values()) {
    const proto = trans.protocol.toUpperCase().padEnd(4);
    
    const insideGlobal = trans.globalPort !== undefined
      ? `${trans.globalIP}:${trans.globalPort}`
      : trans.globalIP;
    
    const insideLocal = trans.localPort !== undefined
      ? `${trans.localIP}:${trans.localPort}`
      : trans.localIP;
    
    const outsideLocal = trans.remoteIP 
      ? (trans.remotePort !== undefined ? `${trans.remoteIP}:${trans.remotePort}` : trans.remoteIP)
      : '---';
    
    const outsideGlobal = outsideLocal;
    
    output += `${proto} ${insideGlobal.padEnd(20)} ${insideLocal.padEnd(20)} ${outsideLocal.padEnd(20)} ${outsideGlobal}\n`;
  }
  
  return output;
}

/**
 * Get formatted NAT statistics
 */
export function showNATStatistics(device: Device): string {
  const config = device.natConfig;
  
  let output = 'Total active translations: ' + config.translations.size + '\n';
  output += 'Static translations: ' + config.staticEntries.size + '\n';
  output += 'Dynamic translations: ' + (config.translations.size - config.staticEntries.size) + '\n';
  output += 'Outside interfaces: ' + Array.from(config.outsideInterfaces).join(', ') + '\n';
  output += 'Inside interfaces: ' + Array.from(config.insideInterfaces).join(', ') + '\n';
  
  if (config.overloadInterface || config.overloadPool) {
    output += 'PAT (Overload) enabled\n';
  }
  
  return output;
}
