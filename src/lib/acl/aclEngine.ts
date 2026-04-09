/**
 * ACL (Access Control List) Engine
 * Implements Standard and Extended ACL matching for the CCNA Network Simulator
 * 
 * Features:
 * - Standard ACLs (1-99, 1300-1999): Match source IP only
 * - Extended ACLs (100-199, 2000-2699): Match source/dest IP, protocol, ports
 * - Named ACLs: Standard and Extended
 * - Wildcard mask matching
 * - Implicit deny at end
 * - Sequence numbers for ACE ordering
 */

import {
  Device,
  ACL,
  ACLACE,
  ACLType,
  ACLAction,
  ACLProtocol,
  ACLApplication,
  Packet,
  ProtocolType,
} from '../types';

// ============================================================================
// Constants
// ============================================================================

const STANDARD_ACL_MIN = 1;
const STANDARD_ACL_MAX = 99;
const STANDARD_ACL_EXPANDED_MIN = 1300;
const STANDARD_ACL_EXPANDED_MAX = 1999;

const EXTENDED_ACL_MIN = 100;
const EXTENDED_ACL_MAX = 199;
const EXTENDED_ACL_EXPANDED_MIN = 2000;
const EXTENDED_ACL_EXPANDED_MAX = 2699;

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
 * Check if IP matches network with wildcard mask
 */
function ipMatches(ip: string, network: string, wildcard: string): boolean {
  if (network === 'any') return true;
  if (network === 'host') {
    return ip === wildcard; // For "host x.x.x.x", wildcard is the host IP
  }
  
  const ipLong = ipToLong(ip);
  const netLong = ipToLong(network);
  const wildLong = ipToLong(wildcard);
  const maskLong = (~wildLong) >>> 0;
  
  return ((ipLong & maskLong) >>> 0) === ((netLong & maskLong) >>> 0);
}

/**
 * Determine if ACL number is standard (1-99, 1300-1999)
 */
export function isStandardACLNumber(num: number): boolean {
  return (num >= STANDARD_ACL_MIN && num <= STANDARD_ACL_MAX) ||
         (num >= STANDARD_ACL_EXPANDED_MIN && num <= STANDARD_ACL_EXPANDED_MAX);
}

/**
 * Determine if ACL number is extended (100-199, 2000-2699)
 */
export function isExtendedACLNumber(num: number): boolean {
  return (num >= EXTENDED_ACL_MIN && num <= EXTENDED_ACL_MAX) ||
         (num >= EXTENDED_ACL_EXPANDED_MIN && num <= EXTENDED_ACL_EXPANDED_MAX);
}

/**
 * Determine ACL type from name/number
 */
export function getACLType(name: string): ACLType {
  // Try to parse as number
  const num = parseInt(name, 10);
  if (!isNaN(num)) {
    if (isStandardACLNumber(num)) return 'standard';
    if (isExtendedACLNumber(num)) return 'extended';
  }
  // Named ACLs - check existing ACLs for type
  return 'standard'; // Default to standard if unknown
}

// ============================================================================
// ACL Management
// ============================================================================

/**
 * Create a new ACL
 */
export function createACL(device: Device, name: string, type: ACLType): ACL | null {
  if (device.acls.has(name)) {
    return null; // ACL already exists
  }
  
  const acl: ACL = {
    name,
    type,
    entries: [],
  };
  
  device.acls.set(name, acl);
  return acl;
}

/**
 * Delete an ACL
 */
export function deleteACL(device: Device, name: string): boolean {
  // Remove any interface applications of this ACL
  for (const [ifaceName, app] of device.aclApplications) {
    if (app.aclName === name) {
      device.aclApplications.delete(ifaceName);
    }
  }
  
  return device.acls.delete(name);
}

/**
 * Add an entry (ACE) to an ACL
 */
export function addACLEntry(
  device: Device,
  aclName: string,
  entry: Omit<ACLACE, 'sequence'>
): boolean {
  const acl = device.acls.get(aclName);
  if (!acl) return false;
  
  // Generate sequence number (default increment by 10)
  let sequence = 10;
  if (acl.entries.length > 0) {
    const maxSeq = Math.max(...acl.entries.map(e => e.sequence));
    sequence = maxSeq + 10;
  }
  
  const ace: ACLACE = {
    ...entry,
    sequence,
  };
  
  acl.entries.push(ace);
  // Sort by sequence number
  acl.entries.sort((a, b) => a.sequence - b.sequence);
  
  return true;
}

/**
 * Remove an entry from an ACL by sequence number
 */
export function removeACLEntry(device: Device, aclName: string, sequence: number): boolean {
  const acl = device.acls.get(aclName);
  if (!acl) return false;
  
  const index = acl.entries.findIndex(e => e.sequence === sequence);
  if (index === -1) return false;
  
  acl.entries.splice(index, 1);
  return true;
}

// ============================================================================
// ACL Application
// ============================================================================

/**
 * Apply an ACL to an interface
 */
export function applyACL(
  device: Device,
  interfaceName: string,
  aclName: string,
  direction: 'in' | 'out'
): boolean {
  // Check if ACL exists
  if (!device.acls.has(aclName)) return false;
  
  // Check if interface exists
  const iface = device.interfaces.find(i => i.name.toLowerCase() === interfaceName.toLowerCase());
  if (!iface) return false;
  
  device.aclApplications.set(interfaceName, {
    aclName,
    direction,
  });
  
  return true;
}

/**
 * Remove an ACL from an interface
 */
export function removeACLApplication(device: Device, interfaceName: string): boolean {
  return device.aclApplications.delete(interfaceName);
}

/**
 * Get ACL applied to an interface
 */
export function getInterfaceACL(
  device: Device,
  interfaceName: string,
  direction: 'in' | 'out'
): ACL | null {
  const app = device.aclApplications.get(interfaceName);
  if (!app || app.direction !== direction) return null;
  
  return device.acls.get(app.aclName) || null;
}

// ============================================================================
// ACL Matching
// ============================================================================

/**
 * Check if a packet matches an ACE
 */
function matchesACE(
  ace: ACLACE,
  packet: Packet,
  srcIP: string,
  dstIP: string,
  protocol: ProtocolType | string
): boolean {
  // Check source IP
  if (!ipMatches(srcIP, ace.source, ace.sourceWildcard || '0.0.0.0')) {
    return false;
  }
  
  // For extended ACLs, check additional fields
  if (ace.protocol && ace.protocol !== 'ip') {
    // Check protocol match
    const packetProto = getProtocolString(protocol);
    if (ace.protocol !== packetProto) {
      return false;
    }
    
    // Check destination (for extended)
    if (ace.destination && !ipMatches(dstIP, ace.destination, ace.destWildcard || '0.0.0.0')) {
      return false;
    }
    
    // Check ports (for TCP/UDP)
    if ((ace.protocol === 'tcp' || ace.protocol === 'udp') && ace.destPort !== undefined) {
      // Port matching would require parsing payload - simplified for now
      // In full implementation, would extract port from TCP/UDP header
    }
  }
  
  return true;
}

/**
 * Convert protocol type to string for matching
 */
function getProtocolString(protocol: ProtocolType | string): ACLProtocol {
  switch (protocol) {
    case 'ICMP':
    case 'icmp':
      return 'icmp';
    case 'IP':
    case 'ip':
      return 'ip';
    default:
      return 'ip';
  }
}

/**
 * Match a packet against an ACL
 * Returns: 'permit' | 'deny' | null (no match, should check next ACL or allow)
 */
export function matchPacket(
  acl: ACL,
  packet: Packet,
  srcIP: string,
  dstIP: string,
  direction: 'in' | 'out'
): 'permit' | 'deny' {
  // Check each ACE in order
  for (const ace of acl.entries) {
    if (matchesACE(ace, packet, srcIP, dstIP, packet.protocol)) {
      return ace.action;
    }
  }
  
  // Implicit deny at end
  return 'deny';
}

/**
 * Check if packet should be permitted through an interface
 * This is the main entry point for ACL filtering
 */
export function checkPacketAgainstACLs(
  device: Device,
  interfaceName: string,
  packet: Packet,
  srcIP: string,
  dstIP: string,
  direction: 'in' | 'out'
): boolean {
  const app = device.aclApplications.get(interfaceName);
  if (!app || app.direction !== direction) {
    return true; // No ACL applied, permit
  }
  
  const acl = device.acls.get(app.aclName);
  if (!acl) return true; // ACL doesn't exist, permit
  
  const result = matchPacket(acl, packet, srcIP, dstIP, direction);
  return result === 'permit';
}

// ============================================================================
// Show Functions
// ============================================================================

/**
 * Get formatted ACL output
 */
export function showACL(device: Device, name?: string): string {
  if (device.acls.size === 0) {
    return '% No ACLs configured\n';
  }
  
  let output = '';
  
  const aclsToShow = name 
    ? [device.acls.get(name)].filter(Boolean) as ACL[]
    : Array.from(device.acls.values());
  
  if (name && aclsToShow.length === 0) {
    return `% ACL ${name} not found\n`;
  }
  
  for (const acl of aclsToShow) {
    output += `${acl.type === 'standard' ? 'Standard' : 'Extended'} IP access list ${acl.name}\n`;
    
    for (const entry of acl.entries) {
      output += `    ${entry.sequence} ${entry.action}`;
      
      if (entry.protocol && entry.protocol !== 'ip') {
        output += ` ${entry.protocol}`;
      }
      
      // Source
      if (entry.source === 'any') {
        output += ' any';
      } else if (entry.sourceWildcard === '0.0.0.0') {
        output += ` host ${entry.source}`;
      } else {
        output += ` ${entry.source} ${entry.sourceWildcard}`;
      }
      
      // Destination (for extended)
      if (entry.destination) {
        if (entry.destination === 'any') {
          output += ' any';
        } else if (entry.destWildcard === '0.0.0.0') {
          output += ` host ${entry.destination}`;
        } else {
          output += ` ${entry.destination} ${entry.destWildcard}`;
        }
      }
      
      // Port matching
      if (entry.destPort !== undefined && entry.destPortOperator) {
        output += ` ${entry.destPortOperator} ${entry.destPort}`;
      }
      
      output += '\n';
    }
    
    output += '\n';
  }
  
  return output;
}

/**
 * Get ACL applications on interfaces
 */
export function showACLApplications(device: Device): string {
  if (device.aclApplications.size === 0) {
    return '% No ACLs applied to interfaces\n';
  }
  
  let output = 'Interface ACL Direction\n';
  
  for (const [ifaceName, app] of device.aclApplications) {
    output += `${ifaceName.padEnd(20)} ${app.aclName.padEnd(10)} ${app.direction}\n`;
  }
  
  return output;
}

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Validate wildcard mask
 */
export function isValidWildcard(mask: string): boolean {
  const parts = mask.split('.');
  if (parts.length !== 4) return false;
  
  for (const part of parts) {
    const num = parseInt(part, 10);
    if (isNaN(num) || num < 0 || num > 255) return false;
  }
  
  return true;
}

/**
 * Validate ACL number
 */
export function isValidACLNumber(num: number): boolean {
  return isStandardACLNumber(num) || isExtendedACLNumber(num);
}
