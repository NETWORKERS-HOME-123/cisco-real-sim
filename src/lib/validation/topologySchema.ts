/**
 * Topology Validation Schema
 * Prevents prototype pollution and XSS via imported topology data
 */

// MAC address validation
const MAC_REGEX = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;

// IP address validation
const IP_REGEX = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;

// Device name validation (alphanumeric, hyphens, max 63 chars)
const DEVICE_NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,62}$/;

// Interface name validation
const INTERFACE_NAME_REGEX = /^(FastEthernet|GigabitEthernet|Ethernet|Loopback|Vlan|Serial)[0-9/:.]+$/;

export interface ValidatedInterface {
  id: string;
  name: string;
  ip: string | null;
  subnetMask: string | null;
  mac: string;
  status: 'up' | 'down' | 'administratively down';
  connectedTo: string | null;
  isShutdown: boolean;
  description: string;
}

export interface ValidatedDevice {
  id: string;
  name: string;
  type: 'router' | 'switch';
  interfaces: ValidatedInterface[];
  position: { x: number; y: number };
  macTable: [string, string][];
  arpTable: [string, string][];
  routingTable: any[];
  isRunning: boolean;
  startupConfig: string[];
  runningConfig: string[];
}

export interface ValidatedTopology {
  devices: ValidatedDevice[];
  links: any[];
  version: number;
}

/**
 * Validate MAC address format
 */
function isValidMAC(mac: string): boolean {
  return MAC_REGEX.test(mac);
}

/**
 * Validate IP address format
 */
function isValidIP(ip: string): boolean {
  return IP_REGEX.test(ip);
}

/**
 * Validate device name
 */
function isValidDeviceName(name: string): boolean {
  return DEVICE_NAME_REGEX.test(name) && name.length <= 63;
}

/**
 * Validate interface name
 */
function isValidInterfaceName(name: string): boolean {
  return INTERFACE_NAME_REGEX.test(name) && name.length <= 64;
}

/**
 * Sanitize string to prevent XSS
 */
function sanitizeString(str: string): string {
  return str
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/**
 * Validate and sanitize interface data
 */
function validateInterface(data: any): ValidatedInterface {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid interface data');
  }

  const id = String(data.id);
  const name = String(data.name);
  const mac = String(data.mac);
  
  if (!isValidInterfaceName(name)) {
    throw new Error(`Invalid interface name: ${name}`);
  }
  
  if (!isValidMAC(mac)) {
    throw new Error(`Invalid MAC address: ${mac}`);
  }

  const ip = data.ip ? String(data.ip) : null;
  if (ip && !isValidIP(ip)) {
    throw new Error(`Invalid IP address: ${ip}`);
  }

  const subnetMask = data.subnetMask ? String(data.subnetMask) : null;
  if (subnetMask && !isValidIP(subnetMask)) {
    throw new Error(`Invalid subnet mask: ${subnetMask}`);
  }

  return {
    id,
    name,
    ip,
    subnetMask,
    mac,
    status: ['up', 'down', 'administratively down'].includes(data.status) 
      ? data.status 
      : 'administratively down',
    connectedTo: data.connectedTo ? String(data.connectedTo) : null,
    isShutdown: Boolean(data.isShutdown),
    description: sanitizeString(String(data.description || '')).substring(0, 240),
  };
}

/**
 * Validate and sanitize device data
 */
function validateDevice(data: any): ValidatedDevice {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid device data');
  }

  const id = String(data.id);
  const name = String(data.name);
  
  if (!isValidDeviceName(name)) {
    throw new Error(`Invalid device name: ${name}`);
  }

  const type = data.type === 'switch' ? 'switch' : 'router';
  
  // Validate interfaces array
  if (!Array.isArray(data.interfaces)) {
    throw new Error('Invalid interfaces array');
  }
  
  if (data.interfaces.length > 100) {
    throw new Error('Too many interfaces (max 100)');
  }

  const interfaces = data.interfaces.map(validateInterface);

  // Validate position
  const position = {
    x: Math.max(-10000, Math.min(10000, Number(data.position?.x) || 0)),
    y: Math.max(-10000, Math.min(10000, Number(data.position?.y) || 0)),
  };

  // Validate MAC table
  const macTable: [string, string][] = [];
  if (Array.isArray(data.macTable)) {
    for (const entry of data.macTable.slice(0, 10000)) {
      if (Array.isArray(entry) && entry.length >= 2) {
        const mac = String(entry[0]);
        const ifaceId = String(entry[1]);
        if (isValidMAC(mac)) {
          macTable.push([mac, ifaceId]);
        }
      }
    }
  }

  // Validate ARP table
  const arpTable: [string, string][] = [];
  if (Array.isArray(data.arpTable)) {
    for (const entry of data.arpTable.slice(0, 1000)) {
      if (Array.isArray(entry) && entry.length >= 2) {
        const ip = String(entry[0]);
        const mac = String(entry[1]);
        if (isValidIP(ip) && isValidMAC(mac)) {
          arpTable.push([ip, mac]);
        }
      }
    }
  }

  return {
    id,
    name,
    type,
    interfaces,
    position,
    macTable,
    arpTable,
    routingTable: Array.isArray(data.routingTable) ? data.routingTable.slice(0, 1000) : [],
    isRunning: Boolean(data.isRunning),
    startupConfig: (data.startupConfig || [])
      .slice(0, 10000)
      .map((c: any) => String(c).substring(0, 1024)),
    runningConfig: (data.runningConfig || [])
      .slice(0, 10000)
      .map((c: any) => String(c).substring(0, 1024)),
  };
}

/**
 * Validate and sanitize topology data
 * @throws {Error} If validation fails
 */
export function validateTopology(data: unknown): ValidatedTopology {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid topology data');
  }

  const topologyData = data as any;

  // Check for prototype pollution
  if (topologyData.__proto__ || topologyData.constructor) {
    throw new Error('Potential prototype pollution detected');
  }

  // Validate devices
  if (!Array.isArray(topologyData.devices)) {
    throw new Error('Invalid devices array');
  }

  if (topologyData.devices.length > 1000) {
    throw new Error('Too many devices (max 1000)');
  }

  const devices = topologyData.devices.map(validateDevice);

  // Validate links
  if (!Array.isArray(topologyData.links)) {
    throw new Error('Invalid links array');
  }

  if (topologyData.links.length > 5000) {
    throw new Error('Too many links (max 5000)');
  }

  const links = topologyData.links.slice(0, 5000).map((link: any) => ({
    id: String(link?.id || ''),
    from: String(link?.from || ''),
    to: String(link?.to || ''),
    status: link?.status === 'up' ? 'up' : 'down',
  }));

  return {
    devices,
    links,
    version: Math.max(0, Math.floor(Number(topologyData.version) || 0)),
  };
}

/**
 * Safe deserialize with validation
 */
export function safeDeserializeTopology(jsonString: string): ValidatedTopology {
  let parsed: unknown;
  
  try {
    parsed = JSON.parse(jsonString);
  } catch (e) {
    throw new Error('Invalid JSON format');
  }
  
  return validateTopology(parsed);
}
