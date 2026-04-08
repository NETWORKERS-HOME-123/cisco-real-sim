/**
 * Topology Engine
 * Manages network topology - devices, interfaces, and links
 * Pure logic, no UI dependencies
 */

import { v4 as uuidv4 } from 'uuid';
import {
  Device,
  DeviceType,
  Interface,
  Link,
  Topology,
  SerializedTopology,
  SerializedDevice,
  VLAN,
} from '../types';

/**
 * Generate a random MAC address
 * Uses crypto.getRandomValues for better performance and security
 */
export function generateMAC(): string {
  // Use crypto API if available (browser environment)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    return Array.from(bytes, b => b.toString(16).padStart(2, '0').toUpperCase()).join(':');
  }
  
  // Fallback for environments without crypto
  const hex = '0123456789ABCDEF';
  let mac = '';
  for (let i = 0; i < 6; i++) {
    if (i > 0) mac += ':';
    mac += hex[Math.floor(Math.random() * 16)];
    mac += hex[Math.floor(Math.random() * 16)];
  }
  return mac;
}

// Generate default interfaces for a device
export function generateInterfaces(deviceType: DeviceType, deviceId: string): Interface[] {
  const interfaces: Interface[] = [];
  
  if (deviceType === 'router') {
    // Router typically has GigabitEthernet interfaces
    for (let i = 0; i < 4; i++) {
      interfaces.push({
        id: `${deviceId}-gi0/${i}`,
        name: `GigabitEthernet0/${i}`,
        ip: null,
        subnetMask: null,
        mac: generateMAC(),
        status: 'administratively down',
        connectedTo: null,
        isShutdown: true,
        description: '',
        // Routers don't use switchport -- neutral defaults
        switchportMode: 'access',
        accessVlan: 0,
        trunkVlans: [],
        nativeVlan: 0,
      });
    }
  } else if (deviceType === 'switch') {
    // Switch typically has FastEthernet interfaces
    for (let i = 0; i < 24; i++) {
      interfaces.push({
        id: `${deviceId}-fa0/${i}`,
        name: `FastEthernet0/${i}`,
        ip: null,
        subnetMask: null,
        mac: generateMAC(),
        status: 'administratively down',
        connectedTo: null,
        isShutdown: true,
        description: '',
        // VLAN fields for switches
        switchportMode: 'dynamic',
        accessVlan: 1,
        trunkVlans: [],
        nativeVlan: 1,
      });
    }
  }
  
  return interfaces;
}

// Create a new device
export function createDevice(
  type: DeviceType,
  name: string,
  position: { x: number; y: number }
): Device {
  const id = uuidv4();
  const interfaces = generateInterfaces(type, id);
  
  // Create default VLANs for switches
  const vlans = new Map<number, VLAN>();
  const vlanDatabase: VLAN[] = [];
  
  if (type === 'switch') {
    // Default VLAN 1
    const defaultVLAN: VLAN = {
      id: 1,
      name: 'default',
      interfaces: interfaces.map(i => i.id),
    };
    vlans.set(1, defaultVLAN);
    vlanDatabase.push(defaultVLAN);
  }
  
  return {
    id,
    name,
    type,
    interfaces,
    position,
    macTable: new Map(),
    arpTable: new Map(),
    routingTable: [],
    isRunning: true,
    startupConfig: [],
    runningConfig: [],
    vlans,
    vlanDatabase,
  };
}

// Create a new topology
export function createTopology(): Topology {
  return {
    devices: new Map(),
    links: new Map(),
    version: 0,
  };
}

// Add a device to the topology
export function addDevice(
  topology: Topology,
  type: DeviceType,
  name: string,
  position: { x: number; y: number }
): Device {
  const device = createDevice(type, name, position);
  topology.devices.set(device.id, device);
  topology.version++;
  return device;
}

// Remove a device from the topology
export function removeDevice(topology: Topology, deviceId: string): void {
  const device = topology.devices.get(deviceId);
  if (!device) return;
  
  // Remove all links connected to this device
  const linksToRemove: string[] = [];
  topology.links.forEach((link, linkId) => {
    if (link.from.startsWith(deviceId) || link.to.startsWith(deviceId)) {
      linksToRemove.push(linkId);
    }
  });
  
  linksToRemove.forEach(linkId => removeLink(topology, linkId));
  
  // Remove the device
  topology.devices.delete(deviceId);
  topology.version++;
}

// Update device position
export function updateDevicePosition(
  topology: Topology,
  deviceId: string,
  position: { x: number; y: number }
): void {
  const device = topology.devices.get(deviceId);
  if (device) {
    device.position = position;
    topology.version++;
  }
}

// Rename device
export function renameDevice(topology: Topology, deviceId: string, newName: string): void {
  const device = topology.devices.get(deviceId);
  if (device) {
    device.name = newName;
    topology.version++;
  }
}

// Create a link between two interfaces
export function createLink(
  topology: Topology,
  fromDeviceId: string,
  fromInterfaceId: string,
  toDeviceId: string,
  toInterfaceId: string
): Link | null {
  const fromDevice = topology.devices.get(fromDeviceId);
  const toDevice = topology.devices.get(toDeviceId);
  
  if (!fromDevice || !toDevice) return null;
  
  const fromInterface = fromDevice.interfaces.find(i => i.id === fromInterfaceId);
  const toInterface = toDevice.interfaces.find(i => i.id === toInterfaceId);
  
  if (!fromInterface || !toInterface) return null;
  
  // Check if interfaces are already connected
  if (fromInterface.connectedTo || toInterface.connectedTo) {
    return null;
  }
  
  const link: Link = {
    id: uuidv4(),
    from: `${fromDeviceId}/${fromInterfaceId}`,
    to: `${toDeviceId}/${toInterfaceId}`,
    status: 'down',
  };
  
  // Update interface connections
  fromInterface.connectedTo = `${toDeviceId}/${toInterfaceId}`;
  toInterface.connectedTo = `${fromDeviceId}/${fromInterfaceId}`;
  
  // Update link status based on interface status
  if (!fromInterface.isShutdown && !toInterface.isShutdown) {
    link.status = 'up';
    fromInterface.status = 'up';
    toInterface.status = 'up';
  }
  
  topology.links.set(link.id, link);
  topology.version++;
  
  return link;
}

// Remove a link
export function removeLink(topology: Topology, linkId: string): void {
  const link = topology.links.get(linkId);
  if (!link) return;
  
  // Disconnect interfaces
  // Format: "deviceId/interfaceId" - split only on first '/'
  const fromSlashIndex = link.from.indexOf('/');
  const toSlashIndex = link.to.indexOf('/');
  
  const fromDeviceId = link.from.substring(0, fromSlashIndex);
  const fromInterfaceId = link.from.substring(fromSlashIndex + 1);
  const toDeviceId = link.to.substring(0, toSlashIndex);
  const toInterfaceId = link.to.substring(toSlashIndex + 1);
  
  const fromDevice = topology.devices.get(fromDeviceId);
  const toDevice = topology.devices.get(toDeviceId);
  
  if (fromDevice) {
    const fromInterface = fromDevice.interfaces.find(i => i.id === fromInterfaceId);
    if (fromInterface) {
      fromInterface.connectedTo = null;
      fromInterface.status = 'administratively down';
    }
  }
  
  if (toDevice) {
    const toInterface = toDevice.interfaces.find(i => i.id === toInterfaceId);
    if (toInterface) {
      toInterface.connectedTo = null;
      toInterface.status = 'administratively down';
    }
  }
  
  topology.links.delete(linkId);
  topology.version++;
}

// Get interface by ID
export function getInterface(topology: Topology, deviceId: string, interfaceId: string): Interface | null {
  const device = topology.devices.get(deviceId);
  if (!device) return null;
  return device.interfaces.find(i => i.id === interfaceId) || null;
}

// Get connected interface
export function getConnectedInterface(topology: Topology, deviceId: string, interfaceId: string): Interface | null {
  const device = topology.devices.get(deviceId);
  if (!device) return null;
  
  const iface = device.interfaces.find(i => i.id === interfaceId);
  if (!iface || !iface.connectedTo) return null;
  
  const [connectedDeviceId, connectedInterfaceId] = iface.connectedTo.split('/');
  return getInterface(topology, connectedDeviceId, connectedInterfaceId);
}

// Serialize topology to JSON
export function serializeTopology(topology: Topology): SerializedTopology {
  const devices: SerializedDevice[] = [];
  
  topology.devices.forEach((device) => {
    devices.push({
      id: device.id,
      name: device.name,
      type: device.type,
      interfaces: device.interfaces,
      position: device.position,
      macTable: Array.from(device.macTable.entries()),
      arpTable: Array.from(device.arpTable.entries()),
      routingTable: device.routingTable,
      isRunning: device.isRunning,
      startupConfig: device.startupConfig,
      runningConfig: device.runningConfig,
      vlans: Array.from(device.vlans.entries()),
      vlanDatabase: device.vlanDatabase,
    });
  });
  
  return {
    devices,
    links: Array.from(topology.links.values()),
    version: topology.version,
  };
}

// Deserialize topology from JSON
export function deserializeTopology(data: SerializedTopology): Topology {
  const topology = createTopology();
  
  data.devices.forEach((deviceData) => {
    // Ensure VLAN fields have defaults for backward compatibility
    const interfaces: Interface[] = deviceData.interfaces.map(i => ({
      ...i,
      status: (i.isShutdown ? 'administratively down' : (i.connectedTo ? 'up' : 'down')) as Interface['status'],
      switchportMode: i.switchportMode || 'dynamic',
      accessVlan: i.accessVlan ?? 1,
      trunkVlans: i.trunkVlans || [],
      nativeVlan: i.nativeVlan ?? 1,
    }));
    
    // Rebuild VLAN structures for switches
    const vlans = new Map<number, VLAN>();
    const vlanDatabase: VLAN[] = deviceData.vlanDatabase || [];
    
    if (deviceData.type === 'switch' && vlanDatabase.length === 0) {
      // Create default VLAN 1 if none exist
      const defaultVLAN: VLAN = {
        id: 1,
        name: 'default',
        interfaces: interfaces.map(i => i.id),
      };
      vlans.set(1, defaultVLAN);
      vlanDatabase.push(defaultVLAN);
    } else {
      vlanDatabase.forEach(vlan => vlans.set(vlan.id, vlan));
    }
    
    const device: Device = {
      ...deviceData,
      interfaces,
      macTable: new Map(deviceData.macTable),
      arpTable: new Map(deviceData.arpTable),
      vlans,
      vlanDatabase,
    };
    topology.devices.set(device.id, device);
  });
  
  data.links.forEach((link) => {
    topology.links.set(link.id, link);
  });
  
  topology.version = data.version;
  
  return topology;
}

// Find device by name
export function findDeviceByName(topology: Topology, name: string): Device | null {
  for (const device of topology.devices.values()) {
    if (device.name.toLowerCase() === name.toLowerCase()) {
      return device;
    }
  }
  return null;
}

// Get next available device name
export function getNextDeviceName(topology: Topology, type: DeviceType): string {
  const prefix = type === 'router' ? 'Router' : 'Switch';
  let index = 1;
  
  while (findDeviceByName(topology, `${prefix}${index}`)) {
    index++;
  }
  
  return `${prefix}${index}`;
}

// Get link between two devices
export function getLinkBetween(
  topology: Topology,
  deviceId1: string,
  deviceId2: string
): Link | null {
  for (const link of topology.links.values()) {
    const fromDeviceId = link.from.split('/')[0];
    const toDeviceId = link.to.split('/')[0];
    
    if ((fromDeviceId === deviceId1 && toDeviceId === deviceId2) ||
        (fromDeviceId === deviceId2 && toDeviceId === deviceId1)) {
      return link;
    }
  }
  return null;
}
