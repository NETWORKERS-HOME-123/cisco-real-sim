/**
 * IPv6 Utility Functions
 * Handles IPv6 address validation, formatting, and manipulation
 */

/**
 * Validate IPv6 address format
 * Supports full, compressed, and IPv4-mapped formats
 */
export function isValidIPv6(ip: string): boolean {
  if (!ip || typeof ip !== 'string') return false;
  
  // Handle IPv4-mapped IPv6 addresses (::ffff:192.168.1.1)
  if (ip.toLowerCase().startsWith('::ffff:')) {
    const ipv4Part = ip.substring(7);
    return isValidIPv4(ipv4Part);
  }
  
  // Remove zone index if present (%eth0)
  const zoneIndex = ip.indexOf('%');
  if (zoneIndex !== -1) {
    ip = ip.substring(0, zoneIndex);
  }
  
  // Split by :: to handle compression
  const parts = ip.split('::');
  if (parts.length > 2) return false; // Only one :: allowed
  
  // Check each part
  for (const part of parts) {
    if (part === '') continue; // Empty part is valid (start/end of ::)
    
    const segments = part.split(':');
    if (segments.length > 8) return false;
    
    for (const segment of segments) {
      if (segment === '') continue;
      // Each segment must be 1-4 hex digits
      if (!/^[0-9a-fA-F]{1,4}$/.test(segment)) return false;
    }
  }
  
  // If no ::, must have exactly 8 segments
  if (parts.length === 1) {
    const segments = parts[0].split(':');
    if (segments.length !== 8) return false;
  }
  
  return true;
}

/**
 * Validate IPv4 address
 */
function isValidIPv4(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  
  for (const part of parts) {
    const num = parseInt(part, 10);
    if (isNaN(num) || num < 0 || num > 255) return false;
    // Check for leading zeros (except for 0 itself)
    if (part.length > 1 && part[0] === '0') return false;
  }
  
  return true;
}

/**
 * Expand compressed IPv6 address to full form
 * e.g., "2001:db8::1" -> "2001:0db8:0000:0000:0000:0000:0000:0001"
 */
export function expandIPv6(ip: string): string {
  if (!isValidIPv6(ip)) return '';
  
  // Handle IPv4-mapped addresses
  if (ip.toLowerCase().startsWith('::ffff:')) {
    return ip; // Keep as-is
  }
  
  // Remove zone index
  const zoneIndex = ip.indexOf('%');
  const zone = zoneIndex !== -1 ? ip.substring(zoneIndex) : '';
  if (zoneIndex !== -1) {
    ip = ip.substring(0, zoneIndex);
  }
  
  const parts = ip.split('::');
  
  if (parts.length === 1) {
    // No compression, just pad each segment
    return ip.split(':').map(s => s.padStart(4, '0')).join(':') + zone;
  }
  
  // Handle compression
  const left = parts[0] ? parts[0].split(':') : [];
  const right = parts[1] ? parts[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  
  const full = [
    ...left,
    ...Array(missing).fill('0'),
    ...right
  ];
  
  return full.map(s => s.padStart(4, '0')).join(':') + zone;
}

/**
 * Compress IPv6 address to shortest form
 * e.g., "2001:0db8:0000:0000:0000:0000:0000:0001" -> "2001:db8::1"
 */
export function compressIPv6(ip: string): string {
  if (!isValidIPv6(ip)) return '';
  
  // Handle IPv4-mapped addresses
  if (ip.toLowerCase().startsWith('::ffff:')) {
    return ip; // Keep as-is
  }
  
  // Remove zone index for processing
  const zoneIndex = ip.indexOf('%');
  const zone = zoneIndex !== -1 ? ip.substring(zoneIndex) : '';
  if (zoneIndex !== -1) {
    ip = ip.substring(0, zoneIndex);
  }
  
  // Expand first
  const expanded = expandIPv6(ip);
  const parts = expanded.split(':').map(s => s.replace(/^0+/, '') || '0');
  
  // Find longest run of zeros
  let longestStart = -1;
  let longestLength = 0;
  let currentStart = -1;
  let currentLength = 0;
  
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === '0') {
      if (currentStart === -1) {
        currentStart = i;
        currentLength = 1;
      } else {
        currentLength++;
      }
    } else {
      if (currentLength > longestLength) {
        longestLength = currentLength;
        longestStart = currentStart;
      }
      currentStart = -1;
      currentLength = 0;
    }
  }
  
  if (currentLength > longestLength) {
    longestLength = currentLength;
    longestStart = currentStart;
  }
  
  // Replace longest run with ::
  if (longestLength > 1) {
    const before = parts.slice(0, longestStart).join(':');
    const after = parts.slice(longestStart + longestLength).join(':');
    
    if (before && after) {
      return before + '::' + after + zone;
    } else if (before) {
      return before + '::' + zone;
    } else if (after) {
      return '::' + after + zone;
    } else {
      return '::' + zone;
    }
  }
  
  return parts.join(':') + zone;
}

/**
 * Generate IPv6 link-local address from MAC address
 * Uses EUI-64 format
 */
export function generateLinkLocalAddress(mac: string): string {
  // Clean MAC address
  const cleanMac = mac.replace(/:/g, '').toLowerCase();
  if (cleanMac.length !== 12) return '';
  
  // Insert ff:fe in the middle for EUI-64
  const eui64 = cleanMac.substring(0, 6) + 'fffe' + cleanMac.substring(6);
  
  // Flip the 7th bit (Universal/Local bit)
  const firstByte = parseInt(eui64.substring(0, 2), 16);
  const modifiedFirstByte = firstByte ^ 0x02;
  
  // Format as IPv6 link-local address
  const interfaceID = modifiedFirstByte.toString(16).padStart(2, '0') + eui64.substring(2, 4) +
                      ':' + eui64.substring(4, 8) + ':' + eui64.substring(8, 12) +
                      ':' + eui64.substring(12, 16);
  
  return 'fe80::' + interfaceID;
}

/**
 * Validate IPv6 prefix length (0-128)
 */
export function isValidIPv6PrefixLength(length: number): boolean {
  return Number.isInteger(length) && length >= 0 && length <= 128;
}

/**
 * Check if two IPv6 addresses are in the same network
 */
export function isSameIPv6Network(ip1: string, ip2: string, prefixLength: number): boolean {
  const expanded1 = expandIPv6(ip1);
  const expanded2 = expandIPv6(ip2);
  
  if (!expanded1 || !expanded2) return false;
  
  // Convert to binary and compare prefix
  const bin1 = ipv6ToBinary(expanded1);
  const bin2 = ipv6ToBinary(expanded2);
  
  return bin1.substring(0, prefixLength) === bin2.substring(0, prefixLength);
}

/**
 * Convert expanded IPv6 address to binary string
 */
function ipv6ToBinary(ip: string): string {
  const parts = ip.split(':');
  return parts.map(p => parseInt(p, 16).toString(2).padStart(16, '0')).join('');
}

/**
 * Get IPv6 network address from address and prefix length
 */
export function getIPv6Network(ip: string, prefixLength: number): string {
  const expanded = expandIPv6(ip);
  if (!expanded) return '';
  
  const binary = ipv6ToBinary(expanded);
  const networkBinary = binary.substring(0, prefixLength).padEnd(128, '0');
  
  // Convert back to IPv6
  const parts: string[] = [];
  for (let i = 0; i < 128; i += 16) {
    const chunk = networkBinary.substring(i, i + 16);
    parts.push(parseInt(chunk, 2).toString(16).padStart(4, '0'));
  }
  
  return compressIPv6(parts.join(':'));
}

/**
 * Check if IPv6 address is link-local (fe80::/10)
 */
export function isIPv6LinkLocal(ip: string): boolean {
  if (!isValidIPv6(ip)) return false;
  const expanded = expandIPv6(ip);
  if (!expanded) return false;
  
  // Link-local addresses start with fe80::
  return expanded.toLowerCase().startsWith('fe80');
}

/**
 * Check if IPv6 address is loopback (::1)
 */
export function isIPv6Loopback(ip: string): boolean {
  return compressIPv6(ip) === '::1';
}

/**
 * Check if IPv6 address is multicast (ff00::/8)
 */
export function isIPv6Multicast(ip: string): boolean {
  if (!isValidIPv6(ip)) return false;
  const expanded = expandIPv6(ip);
  if (!expanded) return false;
  
  // Multicast addresses start with ff
  return expanded.toLowerCase().startsWith('ff');
}

/**
 * Format IPv6 address for display
 * Always show compressed form
 */
export function formatIPv6(ip: string): string {
  return compressIPv6(ip).toLowerCase();
}
