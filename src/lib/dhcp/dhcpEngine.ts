/**
 * DHCP (Dynamic Host Configuration Protocol) Engine
 * Implements DHCP Server functionality for the CCNA Network Simulator
 * 
 * Features:
 * - DHCP Pool configuration
 * - DORA process (Discover, Offer, Request, Ack)
 * - IP address allocation and lease management
 * - Excluded addresses
 * - DHCP bindings tracking
 * - DNS and default gateway options
 */

import {
  Device,
  DHCPPool,
  DHCPBinding,
  DHCPConfig,
  DHCPMessageType,
} from '../types';

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_LEASE_TIME = 86400;    // 1 day in seconds
const OFFER_TIMEOUT = 30000;         // 30 seconds for client to respond to offer

// DHCP Options
const DHCP_OPTION_SUBNET_MASK = 1;
const DHCP_OPTION_ROUTER = 3;
const DHCP_OPTION_DNS_SERVER = 6;
const DHCP_OPTION_DOMAIN_NAME = 15;
const DHCP_OPTION_IP_ADDRESS_LEASE_TIME = 51;
const DHCP_OPTION_DHCP_MESSAGE_TYPE = 53;
const DHCP_OPTION_SERVER_IDENTIFIER = 54;
const DHCP_OPTION_CLIENT_IDENTIFIER = 61;

// ============================================================================
// Utility Functions
// ============================================================================

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
 * Apply subnet mask to get network address
 */
function applySubnetMask(ip: string, mask: string): string {
  const ipLong = ipToLong(ip);
  const maskLong = ipToLong(mask);
  return longToIP(ipLong & maskLong);
}

/**
 * Generate IP range for a network
 */
function generateIPRange(network: string, mask: string): string[] {
  const netLong = ipToLong(network);
  const maskLong = ipToLong(mask);
  const hostBits = 32 - maskLong.toString(2).replace(/0/g, '').length;
  const numHosts = Math.pow(2, hostBits) - 2; // Exclude network and broadcast
  
  const ips: string[] = [];
  for (let i = 1; i <= numHosts; i++) {
    ips.push(longToIP(netLong + i));
  }
  
  return ips;
}

/**
 * Generate a random MAC address
 */
function generateRandomMAC(): string {
  const hex = '0123456789ABCDEF';
  let mac = '';
  for (let i = 0; i < 6; i++) {
    if (i > 0) mac += ':';
    mac += hex[Math.floor(Math.random() * 16)];
    mac += hex[Math.floor(Math.random() * 16)];
  }
  return mac;
}

// ============================================================================
// Pool Management
// ============================================================================

/**
 * Create a DHCP pool
 */
export function createDHCPPool(
  device: Device,
  name: string,
  network: string,
  mask: string
): DHCPPool | null {
  // Validate network address
  const netAddr = applySubnetMask(network, mask);
  if (netAddr !== network) {
    return null; // Not a valid network address
  }
  
  // Generate available IPs
  const availableIPs = generateIPRange(network, mask);
  
  const pool: DHCPPool = {
    name,
    network,
    mask,
    defaultRouter: [],
    dnsServer: [],
    domainName: undefined,
    leaseTime: DEFAULT_LEASE_TIME,
    excludedIPs: [],
    bindings: new Map(),
  };
  
  // Store the pool
  device.dhcpConfig.pools.set(name, pool);
  
  return pool;
}

/**
 * Delete a DHCP pool
 */
export function deleteDHCPPool(device: Device, name: string): boolean {
  return device.dhcpConfig.pools.delete(name);
}

/**
 * Configure pool options
 */
export function configurePoolOptions(
  device: Device,
  poolName: string,
  options: {
    defaultRouter?: string[];
    dnsServer?: string[];
    domainName?: string;
    leaseTime?: number;
  }
): boolean {
  const pool = device.dhcpConfig.pools.get(poolName);
  if (!pool) return false;
  
  if (options.defaultRouter) pool.defaultRouter = options.defaultRouter;
  if (options.dnsServer) pool.dnsServer = options.dnsServer;
  if (options.domainName !== undefined) pool.domainName = options.domainName;
  if (options.leaseTime !== undefined) pool.leaseTime = options.leaseTime;
  
  return true;
}

/**
 * Add excluded address to pool
 */
export function addExcludedIP(device: Device, poolName: string, ip: string): boolean {
  const pool = device.dhcpConfig.pools.get(poolName);
  if (!pool) return false;
  
  if (!pool.excludedIPs.includes(ip)) {
    pool.excludedIPs.push(ip);
  }
  
  return true;
}

/**
 * Remove excluded address from pool
 */
export function removeExcludedIP(device: Device, poolName: string, ip: string): boolean {
  const pool = device.dhcpConfig.pools.get(poolName);
  if (!pool) return false;
  
  pool.excludedIPs = pool.excludedIPs.filter(e => e !== ip);
  return true;
}

// ============================================================================
// IP Allocation
// ============================================================================

/**
 * Get next available IP from pool
 */
function getAvailableIP(pool: DHCPPool): string | null {
  const allIPs = generateIPRange(pool.network, pool.mask);
  
  for (const ip of allIPs) {
    // Check if excluded
    if (pool.excludedIPs.includes(ip)) continue;
    
    // Check if already allocated
    const binding = pool.bindings.get(ip);
    if (!binding || binding.state === 'expired') {
      return ip;
    }
  }
  
  return null; // No available IPs
}

/**
 * Create a DHCP binding
 */
function createBinding(
  pool: DHCPPool,
  ip: string,
  mac: string,
  clientId?: string
): DHCPBinding {
  const now = Date.now();
  const binding: DHCPBinding = {
    ip,
    mac,
    clientId,
    leaseExpiry: now + (pool.leaseTime * 1000),
    leaseTime: pool.leaseTime,
    state: 'offered',
    poolName: pool.name,
  };
  
  pool.bindings.set(ip, binding);
  return binding;
}

/**
 * Renew a binding (Request -> Ack)
 */
function renewBinding(binding: DHCPBinding): void {
  binding.state = 'active';
  binding.leaseExpiry = Date.now() + (binding.leaseTime * 1000);
}

/**
 * Release a binding
 */
function releaseBinding(binding: DHCPBinding): void {
  binding.state = 'expired';
}

/**
 * Clean up expired bindings
 */
export function cleanupExpiredBindings(device: Device): void {
  const now = Date.now();
  
  for (const pool of device.dhcpConfig.pools.values()) {
    for (const [ip, binding] of pool.bindings) {
      if (binding.state === 'offered' || binding.state === 'active') {
        if (now > binding.leaseExpiry) {
          binding.state = 'expired';
        }
      }
    }
  }
}

// ============================================================================
// DORA Process Handlers
// ============================================================================

/**
 * Handle DHCP Discover message
 * Returns a DHCP Offer
 */
export function handleDHCPDiscover(
  device: Device,
  clientMAC: string,
  requestedIP?: string
): { offeredIP: string; leaseTime: number; options: any } | null {
  // Find a pool that can serve this request
  // For now, use the first available pool
  for (const pool of device.dhcpConfig.pools.values()) {
    let ip: string | null = null;
    
    // Check if client already has a binding
    for (const binding of pool.bindings.values()) {
      if (binding.mac === clientMAC && binding.state !== 'expired') {
        ip = binding.ip;
        break;
      }
    }
    
    // Check if requested IP is available
    if (!ip && requestedIP) {
      const binding = pool.bindings.get(requestedIP);
      if ((!binding || binding.state === 'expired') && 
          !pool.excludedIPs.includes(requestedIP)) {
        // Verify requested IP is in pool's network
        const netAddr = applySubnetMask(requestedIP, pool.mask);
        if (netAddr === pool.network) {
          ip = requestedIP;
        }
      }
    }
    
    // Get new available IP
    if (!ip) {
      ip = getAvailableIP(pool);
    }
    
    if (ip) {
      // Create or update binding
      createBinding(pool, ip, clientMAC);
      
      return {
        offeredIP: ip,
        leaseTime: pool.leaseTime,
        options: {
          subnetMask: pool.mask,
          router: pool.defaultRouter[0],
          dnsServer: pool.dnsServer,
          domainName: pool.domainName,
        },
      };
    }
  }
  
  return null; // No IP available
}

/**
 * Handle DHCP Request message
 * Returns a DHCP Ack or Nak
 */
export function handleDHCPRequest(
  device: Device,
  clientMAC: string,
  requestedIP: string,
  serverIP?: string
): { ack: boolean; ip?: string; leaseTime?: number; options?: any } {
  // Find the pool that offered this IP
  for (const pool of device.dhcpConfig.pools.values()) {
    const binding = pool.bindings.get(requestedIP);
    
    if (binding && binding.mac === clientMAC) {
      // This is our offer, confirm it
      renewBinding(binding);
      
      return {
        ack: true,
        ip: requestedIP,
        leaseTime: pool.leaseTime,
        options: {
          subnetMask: pool.mask,
          router: pool.defaultRouter[0],
          dnsServer: pool.dnsServer,
          domainName: pool.domainName,
        },
      };
    }
    
    // Check if IP is already taken by another client
    if (binding && binding.mac !== clientMAC && binding.state === 'active') {
      // Send Nak - IP is taken
      return { ack: false };
    }
  }
  
  // If we get here, we didn't offer this IP
  return { ack: false };
}

/**
 * Handle DHCP Release message
 */
export function handleDHCPRelease(
  device: Device,
  clientMAC: string,
  releasedIP: string
): void {
  for (const pool of device.dhcpConfig.pools.values()) {
    const binding = pool.bindings.get(releasedIP);
    if (binding && binding.mac === clientMAC) {
      releaseBinding(binding);
      return;
    }
  }
}

/**
 * Handle DHCP Inform message
 * Returns configuration options without IP allocation
 */
export function handleDHCPInform(
  device: Device,
  clientMAC: string
): { options: any } | null {
  // Find a pool for this client (based on network)
  for (const pool of device.dhcpConfig.pools.values()) {
    return {
      options: {
        subnetMask: pool.mask,
        router: pool.defaultRouter,
        dnsServer: pool.dnsServer,
        domainName: pool.domainName,
      },
    };
  }
  
  return null;
}

// ============================================================================
// Show Functions
// ============================================================================

/**
 * Get formatted DHCP pool information
 */
export function showDHCPPools(device: Device): string {
  if (device.dhcpConfig.pools.size === 0) {
    return '% No DHCP pools configured\n';
  }
  
  let output = 'Pool                  : Network           / Mask              \n';
  output += '---------------------------------------------------------------\n';
  
  for (const pool of device.dhcpConfig.pools.values()) {
    const netStr = `${pool.network}/${pool.mask}`;
    output += `${pool.name.padEnd(21)} : ${netStr.padEnd(38)}\n`;
    
    if (pool.defaultRouter.length > 0) {
      output += `  Default Router      : ${pool.defaultRouter.join(', ')}\n`;
    }
    if (pool.dnsServer.length > 0) {
      output += `  DNS Server          : ${pool.dnsServer.join(', ')}\n`;
    }
    if (pool.domainName) {
      output += `  Domain Name         : ${pool.domainName}\n`;
    }
    output += `  Lease Time          : ${pool.leaseTime} seconds\n`;
    
    if (pool.excludedIPs.length > 0) {
      output += `  Excluded IPs        : ${pool.excludedIPs.join(', ')}\n`;
    }
    
    output += '\n';
  }
  
  return output;
}

/**
 * Get formatted DHCP bindings
 */
export function showDHCPBindings(device: Device): string {
  let totalBindings = 0;
  for (const pool of device.dhcpConfig.pools.values()) {
    totalBindings += pool.bindings.size;
  }
  
  if (totalBindings === 0) {
    return '% No DHCP bindings\n';
  }
  
  let output = 'IP Address      Client ID/          Lease Expiration    Type\n';
  output += '                Hardware Address\n';
  output += '---------------------------------------------------------------\n';
  
  for (const pool of device.dhcpConfig.pools.values()) {
    for (const binding of pool.bindings.values()) {
      if (binding.state === 'expired') continue;
      
      const clientId = binding.clientId || binding.mac;
      const expiry = new Date(binding.leaseExpiry).toLocaleString();
      const type = binding.state === 'active' ? 'Automatic' : 'Offered';
      
      output += `${binding.ip.padEnd(15)} ${clientId.padEnd(20)} ${expiry.padEnd(20)} ${type}\n`;
    }
  }
  
  return output;
}

/**
 * Get formatted DHCP server statistics
 */
export function showDHCPStatistics(device: Device): string {
  let totalPools = device.dhcpConfig.pools.size;
  let totalBindings = 0;
  let activeBindings = 0;
  let expiredBindings = 0;
  
  for (const pool of device.dhcpConfig.pools.values()) {
    for (const binding of pool.bindings.values()) {
      totalBindings++;
      if (binding.state === 'active') activeBindings++;
      if (binding.state === 'expired') expiredBindings++;
    }
  }
  
  let output = 'DHCP Server Statistics:\n';
  output += `  Pools configured    : ${totalPools}\n`;
  output += `  Total bindings      : ${totalBindings}\n`;
  output += `  Active bindings     : ${activeBindings}\n`;
  output += `  Expired bindings    : ${expiredBindings}\n`;
  output += `  DHCP service        : ${device.dhcpConfig.enabled ? 'Enabled' : 'Disabled'}\n`;
  
  return output;
}

// ============================================================================
// DHCP Relay
// ============================================================================

/**
 * Configure DHCP relay on an interface
 */
export function configureDHCPRelay(
  device: Device,
  interfaceName: string,
  serverIP: string
): void {
  device.dhcpConfig.relayTargets.set(interfaceName, serverIP);
}

/**
 * Remove DHCP relay from an interface
 */
export function removeDHCPRelay(device: Device, interfaceName: string): void {
  device.dhcpConfig.relayTargets.delete(interfaceName);
}
