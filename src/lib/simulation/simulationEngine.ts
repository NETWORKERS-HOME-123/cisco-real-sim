/**
 * Simulation Engine
 * Event-driven packet processing engine
 * Handles ARP, ICMP, MAC learning, and routing logic
 */

import { v4 as uuidv4 } from 'uuid';
import {
  Topology,
  Device,
  Interface,
  Packet,
  ProtocolType,
  ARPPayload,
  ICMPPayload,
  PacketEvent,
  SimulationEvent,
  Route,
} from '../types';
import { getConnectedInterface, findDeviceByName } from '../topology/topologyEngine';
import { learnMAC, lookupMAC, initializeMACTable } from '../utils/macTable';
import { learnARP, lookupARP } from '../utils/arpTable';
import { isValidIPv4, isValidIPv6, sanitizeInput, LIMITS } from '../utils/security';
import { checkPacketAgainstACLs } from '../acl/aclEngine';

// ============================================================================
// Event Queue - Optimized with Priority Queue (Min-Heap)
// O(log n) insertion vs O(n log n) for array sort
// ============================================================================

import { PriorityQueue } from '../utils/priorityQueue';

export class EventQueue {
  private queue: PriorityQueue<SimulationEvent>;
  private processedCount = 0;

  constructor() {
    // Min-heap based on timestamp
    this.queue = new PriorityQueue((a, b) => a.timestamp - b.timestamp);
  }

  enqueue(event: SimulationEvent): void {
    this.queue.enqueue(event);
  }

  dequeue(): SimulationEvent | undefined {
    return this.queue.dequeue();
  }

  peek(): SimulationEvent | undefined {
    return this.queue.peek();
  }

  isEmpty(): boolean {
    return this.queue.isEmpty();
  }

  size(): number {
    return this.queue.size();
  }

  getProcessedCount(): number {
    return this.processedCount;
  }

  incrementProcessed(): void {
    this.processedCount++;
  }
}

// ============================================================================
// IP Utilities
// ============================================================================

export function ipToLong(ip: string): number {
  const parts = ip.split('.');
  // Use >>> 0 to convert signed 32-bit to unsigned
  return ((parseInt(parts[0]) << 24) |
         (parseInt(parts[1]) << 16) |
         (parseInt(parts[2]) << 8) |
         parseInt(parts[3])) >>> 0;
}

export function longToIP(long: number): string {
  return `${(long >>> 24) & 255}.${(long >>> 16) & 255}.${(long >>> 8) & 255}.${long & 255}`;
}

export function applySubnetMask(ip: string, mask: string): string {
  const ipLong = ipToLong(ip);
  const maskLong = ipToLong(mask);
  return longToIP(ipLong & maskLong);
}

export function isSameNetwork(ip1: string, ip2: string, mask: string): boolean {
  return applySubnetMask(ip1, mask) === applySubnetMask(ip2, mask);
}

export function isValidIP(ip: string): boolean {
  const pattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  if (!pattern.test(ip)) return false;
  
  const parts = ip.split('.').map(Number);
  return parts.every(p => p >= 0 && p <= 255);
}

export function isValidMask(mask: string): boolean {
  if (!isValidIP(mask)) return false;
  
  const long = ipToLong(mask);
  // Check if mask is contiguous (all 1s followed by all 0s)
  let foundZero = false;
  for (let i = 31; i >= 0; i--) {
    const bit = (long >> i) & 1;
    if (bit === 0) foundZero = true;
    if (bit === 1 && foundZero) return false;
  }
  return true;
}

// ============================================================================
// Packet Creation
// ============================================================================

export function createARPPacket(
  operation: 'request' | 'reply',
  senderIP: string,
  senderMAC: string,
  targetIP: string,
  targetMAC: string = '00:00:00:00:00:00'
): Packet {
  const payload: ARPPayload = {
    operation,
    senderIP,
    senderMAC,
    targetIP,
    targetMAC,
  };

  return {
    id: uuidv4(),
    srcIP: null, // ARP doesn't use IP layer
    dstIP: null,
    srcMAC: senderMAC,
    dstMAC: operation === 'request' ? 'FF:FF:FF:FF:FF:FF' : targetMAC,
    protocol: 'ARP',
    payload,
    ttl: MAX_L2_HOP_COUNT, // Use L2 hop limit for ARP (broadcast frames)
    timestamp: Date.now(),
  };
}

export function createICMPPacket(
  type: 'echo-request' | 'echo-reply',
  srcIP: string,
  dstIP: string,
  srcMAC: string,
  dstMAC: string,
  identifier: number = 1,
  sequenceNumber: number = 1,
  data: string = 'abcdefghijklmnopqrstuvwabcdefghi'
): Packet {
  const payload: ICMPPayload = {
    type,
    code: 0,
    identifier,
    sequenceNumber,
    data,
  };

  return {
    id: uuidv4(),
    srcIP,
    dstIP,
    srcMAC,
    dstMAC,
    protocol: 'ICMP',
    payload,
    ttl: 64,
    timestamp: Date.now(),
  };
}

// ============================================================================
// Switch Logic
// ============================================================================

// Maximum hop count for L2 frames to prevent broadcast storms in loops
// Without STP, a loop topology would cause infinite packet flooding
const MAX_L2_HOP_COUNT = 32;

/**
 * Determine which VLAN a frame belongs to based on the ingress interface.
 * Access ports: frame belongs to the port's access VLAN.
 * Trunk ports: frame belongs to native VLAN (untagged) — we don't simulate 802.1Q tags in the packet.
 */
function getFrameVlan(iface: Interface): number {
  if (iface.switchportMode === 'trunk') {
    return iface.nativeVlan; // Untagged frames use native VLAN
  }
  return iface.accessVlan; // Access and dynamic ports use access VLAN
}

/**
 * Check if a frame in a given VLAN is allowed out of an interface.
 * Access ports: only if the port's access VLAN matches.
 * Trunk ports: if the VLAN is in the allowed list (empty = all).
 */
function isVlanAllowedOnPort(iface: Interface, vlanId: number): boolean {
  if (iface.switchportMode === 'trunk') {
    // Empty trunkVlans = all VLANs allowed
    return iface.trunkVlans.length === 0 || iface.trunkVlans.includes(vlanId);
  }
  // Access / dynamic: must match the port's access VLAN
  return iface.accessVlan === vlanId;
}

export function processSwitchPacket(
  topology: Topology,
  device: Device,
  packet: Packet,
  ingressInterface: Interface,
  queue: EventQueue
): void {
  // L2 loop protection: drop frames that have been forwarded too many times
  if (packet.ttl <= 0) {
    return; // Silently drop -- loop detected
  }
  packet.ttl--;

  // Determine the VLAN for this frame
  const frameVlan = getFrameVlan(ingressInterface);

  // Learn source MAC (associated with ingress interface) with bounds checking
  if (packet.srcMAC && packet.srcMAC !== 'FF:FF:FF:FF:FF:FF') {
    learnMAC(device, packet.srcMAC, ingressInterface.id, frameVlan);
  }

  if (packet.dstMAC === 'FF:FF:FF:FF:FF:FF') {
    // Broadcast - flood to all ports in the same VLAN except ingress
    floodPacket(topology, device, packet, ingressInterface.id, queue, frameVlan);
    return;
  }

  // Lookup destination MAC in MAC table (with aging support)
  const destInterfaceId = lookupMAC(device, packet.dstMAC);

  if (destInterfaceId) {
    // Verify destination port is in the same VLAN before forwarding
    const destIface = device.interfaces.find(i => i.id === destInterfaceId);
    if (destIface && isVlanAllowedOnPort(destIface, frameVlan)) {
      forwardPacket(topology, device, packet, destInterfaceId, queue);
    } else {
      // Destination is in a different VLAN — flood within this VLAN
      floodPacket(topology, device, packet, ingressInterface.id, queue, frameVlan);
    }
  } else {
    // Unknown destination - flood within this VLAN
    floodPacket(topology, device, packet, ingressInterface.id, queue, frameVlan);
  }
}

function floodPacket(
  topology: Topology,
  device: Device,
  packet: Packet,
  excludeInterfaceId: string,
  queue: EventQueue,
  vlanId: number = 1
): void {
  for (const iface of device.interfaces) {
    if (iface.id === excludeInterfaceId || !iface.connectedTo || iface.isShutdown) continue;

    // Only flood to ports that carry this VLAN
    if (!isVlanAllowedOnPort(iface, vlanId)) continue;

    forwardPacket(topology, device, packet, iface.id, queue);
  }
}

// ============================================================================
// Router Logic
// ============================================================================

export function processRouterPacket(
  topology: Topology,
  device: Device,
  packet: Packet,
  ingressInterface: Interface,
  queue: EventQueue
): void {
  // Check ingress ACL for IP packets
  if (packet.protocol !== 'ARP' && packet.srcIP && packet.dstIP) {
    const permitted = checkPacketAgainstACLs(
      device,
      ingressInterface.name,
      packet,
      packet.srcIP,
      packet.dstIP,
      'in'
    );
    if (!permitted) {
      // Packet denied by ACL - silently drop
      return;
    }
  }

  // Handle ARP packets
  if (packet.protocol === 'ARP') {
    const arpPayload = packet.payload as ARPPayload;
    
    if (arpPayload.operation === 'request') {
      // Check if request is for one of our interfaces
      for (const iface of device.interfaces) {
        if (iface.ip === arpPayload.targetIP && !iface.isShutdown) {
          // Send ARP reply
          const replyPacket = createARPPacket(
            'reply',
            iface.ip,
            iface.mac,
            arpPayload.senderIP,
            arpPayload.senderMAC
          );
          
          // Queue reply
          queue.enqueue({
            id: uuidv4(),
            type: 'packet',
            timestamp: Date.now() + 1,
            data: {
              packet: replyPacket,
              ingressDevice: device.id,
              ingressInterface: iface.id,
            },
          });
          break;
        }
      }
    } else if (arpPayload.operation === 'reply') {
      // Update ARP table with aging
      learnARP(device, arpPayload.senderIP, arpPayload.senderMAC);
    }
    return;
  }

  // Handle IP packets
  if (packet.protocol === 'ICMP' && packet.dstIP && packet.srcIP) {
    // Check if packet is for us
    const isForUs = device.interfaces.some(i => i.ip === packet.dstIP);
    
    if (isForUs) {
      handleLocalICMP(topology, device, packet, ingressInterface, queue);
    } else {
      // Forward the packet
      forwardIPPacket(topology, device, packet, ingressInterface, queue);
    }
  }
}

function handleLocalICMP(
  topology: Topology,
  device: Device,
  packet: Packet,
  ingressInterface: Interface,
  queue: EventQueue
): void {
  const icmpPayload = packet.payload as ICMPPayload;
  
  if (icmpPayload.type === 'echo-request' && packet.dstIP && packet.srcIP) {
    // Find the interface with the destination IP
    const destInterface = device.interfaces.find(i => i.ip === packet.dstIP);
    if (!destInterface) return;

    // Send echo reply
    const replyPacket = createICMPPacket(
      'echo-reply',
      packet.dstIP,
      packet.srcIP!,
      destInterface.mac,
      packet.srcMAC,
      icmpPayload.identifier,
      icmpPayload.sequenceNumber,
      icmpPayload.data
    );

    // We need to resolve the destination MAC
    const dstMAC = lookupARP(device, packet.srcIP!);
    
    if (dstMAC) {
      replyPacket.dstMAC = dstMAC;
      queue.enqueue({
        id: uuidv4(),
        type: 'packet',
        timestamp: Date.now() + 1,
        data: {
          packet: replyPacket,
          ingressDevice: device.id,
          ingressInterface: destInterface.id,
        },
      });
    } else {
      // Need to ARP first - queue ARP request
      const arpRequest = createARPPacket(
        'request',
        destInterface.ip!,
        destInterface.mac,
        packet.srcIP!
      );
      
      queue.enqueue({
        id: uuidv4(),
        type: 'packet',
        timestamp: Date.now(),
        data: {
          packet: arpRequest,
          ingressDevice: device.id,
          ingressInterface: destInterface.id,
        },
      });
      
      // Queue the ICMP reply for after ARP (simplified - in real implementation
      // we'd need proper ARP queue management)
      queue.enqueue({
        id: uuidv4(),
        type: 'packet',
        timestamp: Date.now() + 100,
        data: {
          packet: replyPacket,
          ingressDevice: device.id,
          ingressInterface: destInterface.id,
        },
      });
    }
  }
}

function forwardIPPacket(
  topology: Topology,
  device: Device,
  packet: Packet,
  ingressInterface: Interface,
  queue: EventQueue
): void {
  if (!packet.dstIP) return;

  // Decrement TTL
  packet.ttl--;
  
  if (packet.ttl <= 0) {
    // Send TTL exceeded (simplified)
    return;
  }

  // Find route
  const route = findRoute(device, packet.dstIP);
  if (!route) {
    // Destination unreachable (simplified)
    return;
  }

  // Find outgoing interface
  let outInterface: Interface | undefined;
  if (route.interface) {
    outInterface = device.interfaces.find(i => i.name === route.interface);
  } else if (route.nextHop) {
    // Find interface on same network as next hop
    outInterface = device.interfaces.find(i => 
      i.ip && isSameNetwork(i.ip, route.nextHop!, i.subnetMask!)
    );
  }

  if (!outInterface || outInterface.isShutdown) {
    return;
  }

  // Check egress ACL before forwarding
  if (packet.srcIP && packet.dstIP) {
    const permitted = checkPacketAgainstACLs(
      device,
      outInterface.name,
      packet,
      packet.srcIP,
      packet.dstIP,
      'out'
    );
    if (!permitted) {
      // Packet denied by ACL - silently drop
      return;
    }
  }

  // Update source MAC to outgoing interface
  packet.srcMAC = outInterface.mac;

  // Resolve destination MAC
  let dstMAC: string | null = null;
  const targetIP = route.nextHop || packet.dstIP;
  if (targetIP) {
    dstMAC = lookupARP(device, targetIP);
  }

  if (dstMAC) {
    packet.dstMAC = dstMAC;
    queue.enqueue({
      id: uuidv4(),
      type: 'packet',
      timestamp: Date.now() + 1,
      data: {
        packet,
        ingressDevice: device.id,
        ingressInterface: outInterface.id,
      },
    });
  } else {
    // Send ARP request
    const arpRequest = createARPPacket(
      'request',
      outInterface.ip!,
      outInterface.mac,
      targetIP
    );
    
    queue.enqueue({
      id: uuidv4(),
      type: 'packet',
      timestamp: Date.now(),
      data: {
        packet: arpRequest,
        ingressDevice: device.id,
        ingressInterface: outInterface.id,
      },
    });
    
    // Queue packet for transmission after ARP
    queue.enqueue({
      id: uuidv4(),
      type: 'packet',
      timestamp: Date.now() + 100,
      data: {
        packet,
        ingressDevice: device.id,
        ingressInterface: outInterface.id,
      },
    });
  }
}

export function findRoute(device: Device, dstIP: string): Route | null {
  // Check connected networks first
  for (const iface of device.interfaces) {
    if (iface.ip && iface.subnetMask && isSameNetwork(iface.ip, dstIP, iface.subnetMask)) {
      return {
        network: applySubnetMask(dstIP, iface.subnetMask),
        mask: iface.subnetMask,
        nextHop: null,
        interface: iface.name,
        protocol: 'C',
        metric: 0,
        isLocal: true,
        isIPv6: false,
      };
    }
  }

  // Check routing table
  let bestRoute: Route | null = null;
  let longestPrefix = -1;

  for (const route of device.routingTable) {
    if (isSameNetwork(dstIP, route.network, route.mask)) {
      const prefixLength = ipToLong(route.mask).toString(2).replace(/0/g, '').length;
      if (prefixLength > longestPrefix) {
        longestPrefix = prefixLength;
        bestRoute = route;
      }
    }
  }

  return bestRoute;
}

// ============================================================================
// Packet Forwarding
// ============================================================================

function forwardPacket(
  topology: Topology,
  device: Device,
  packet: Packet,
  destInterfaceId: string,
  queue: EventQueue
): void {
  const destInterface = device.interfaces.find(i => i.id === destInterfaceId);
  if (!destInterface || !destInterface.connectedTo || destInterface.isShutdown) {
    return;
  }

  // Get connected device and interface
  const [connectedDeviceId, connectedInterfaceId] = destInterface.connectedTo.split('/');
  const connectedDevice = topology.devices.get(connectedDeviceId);
  
  if (!connectedDevice) return;

  // Create packet event for the next device
  queue.enqueue({
    id: uuidv4(),
    type: 'packet',
    timestamp: Date.now() + 10, // Small delay for "transmission"
    data: {
      packet: { ...packet }, // Clone packet
      ingressDevice: connectedDeviceId,
      ingressInterface: connectedInterfaceId,
    },
  });
}

// ============================================================================
// Main Packet Processing
// ============================================================================

export function processPacket(
  topology: Topology,
  event: PacketEvent,
  queue: EventQueue
): void {
  const { packet, ingressDevice, ingressInterface } = event.data;
  
  const device = topology.devices.get(ingressDevice);
  if (!device) return;

  const iface = device.interfaces.find(i => i.id === ingressInterface);
  if (!iface || iface.isShutdown) return;

  if (device.type === 'switch') {
    processSwitchPacket(topology, device, packet, iface, queue);
  } else if (device.type === 'router') {
    processRouterPacket(topology, device, packet, iface, queue);
  }
}

// ============================================================================
// Routing Table Management
// ============================================================================

export function addConnectedRoutes(device: Device): void {
  // Remove all existing connected routes first, then rebuild from active interfaces.
  // This ensures routes are cleaned up when interfaces are shutdown or IPs removed.
  device.routingTable = device.routingTable.filter(r => r.protocol !== 'C');

  // Rebuild connected routes from active interfaces with IPs
  for (const iface of device.interfaces) {
    if (iface.ip && iface.subnetMask && !iface.isShutdown) {
      const network = applySubnetMask(iface.ip, iface.subnetMask);

      device.routingTable.push({
        network,
        mask: iface.subnetMask,
        nextHop: null,
        interface: iface.name,
        protocol: 'C',
        metric: 0,
        isLocal: true,
        isIPv6: false,
      });
    }
  }
}

export function addStaticRoute(
  device: Device,
  network: string,
  mask: string,
  nextHop: string | null,
  interfaceName: string | null
): boolean {
  // Validate inputs
  if (!isValidIP(network) || !isValidMask(mask)) {
    return false;
  }
  
  if (nextHop && !isValidIP(nextHop)) {
    return false;
  }

  // Remove existing route for same network
  device.routingTable = device.routingTable.filter(r => 
    !(r.network === network && r.mask === mask && r.protocol === 'S')
  );

  device.routingTable.push({
    network,
    mask,
    nextHop,
    interface: interfaceName,
    protocol: 'S',
    metric: 1,
    isLocal: false,
    isIPv6: false,
  });

  return true;
}

// ============================================================================
// Synchronous Ping Simulation
// Traces an ICMP echo-request through the topology and returns real results
// ============================================================================

export interface PingResult {
  sent: number;
  received: number;
  results: ('!' | '.' | 'U' | 'H')[];  // ! = reply, . = timeout, U = unreachable, H = host unreachable
  rttMin: number;
  rttAvg: number;
  rttMax: number;
}

/**
 * Simulate ping by tracing the ICMP packet hop-by-hop through the topology.
 * Returns real results based on whether the packet can actually reach the destination.
 */
export function simulatePing(
  topology: Topology,
  sourceDevice: Device,
  targetIP: string,
  count: number = 5
): PingResult {
  const result: PingResult = {
    sent: count,
    received: 0,
    results: [],
    rttMin: 999,
    rttAvg: 0,
    rttMax: 0,
  };

  // Find source interface
  const srcInterface = sourceDevice.interfaces.find(i => i.ip && !i.isShutdown);
  if (!srcInterface || !srcInterface.ip) {
    result.results = Array(count).fill('.');
    return result;
  }

  // Check if pinging ourselves (including loopback interfaces)
  if (sourceDevice.interfaces.some(i => i.ip === targetIP && !i.isShutdown)) {
    result.received = count;
    result.results = Array(count).fill('!');
    result.rttMin = 0;
    result.rttAvg = 0;
    result.rttMax = 1;
    return result;
  }

  for (let seq = 0; seq < count; seq++) {
    const reachable = tracePacketPath(topology, sourceDevice, srcInterface, targetIP);
    if (reachable) {
      result.results.push('!');
      result.received++;
      const rtt = 1 + Math.floor(Math.random() * 4); // 1-4ms simulated RTT
      result.rttMin = Math.min(result.rttMin, rtt);
      result.rttMax = Math.max(result.rttMax, rtt);
    } else {
      result.results.push('.');
    }
  }

  if (result.received > 0) {
    result.rttAvg = Math.round((result.rttMin + result.rttMax) / 2);
  } else {
    result.rttMin = 0;
    result.rttMax = 0;
  }

  return result;
}

/**
 * Trace a packet from source to destination, following the actual topology.
 * Returns true if the destination is reachable, false otherwise.
 */
function tracePacketPath(
  topology: Topology,
  currentDevice: Device,
  srcInterface: Interface,
  targetIP: string,
  visited: Set<string> = new Set()
): boolean {
  // Loop detection
  if (visited.has(currentDevice.id)) return false;
  visited.add(currentDevice.id);

  // TTL exhaustion (max 30 hops like real traceroute)
  if (visited.size > 30) return false;

  // Check if target is on a directly connected network of this device
  if (currentDevice.type === 'router') {
    // Check if target is on one of our interfaces (including loopbacks)
    if (currentDevice.interfaces.some(i => i.ip === targetIP && !i.isShutdown)) {
      return true;
    }

    // Find route to destination
    const route = findRoute(currentDevice, targetIP);
    if (!route) return false;

    // Find outgoing interface
    let outInterface: Interface | undefined;
    if (route.interface) {
      outInterface = currentDevice.interfaces.find(i => i.name === route.interface);
    } else if (route.nextHop) {
      outInterface = currentDevice.interfaces.find(i =>
        i.ip && i.subnetMask && isSameNetwork(i.ip, route.nextHop!, i.subnetMask)
      );
    }

    if (!outInterface || outInterface.isShutdown || !outInterface.connectedTo) return false;

    // Follow the link to the next device
    const [nextDeviceId, nextInterfaceId] = outInterface.connectedTo.split('/');
    const nextDevice = topology.devices.get(nextDeviceId);
    if (!nextDevice) return false;

    const nextIface = nextDevice.interfaces.find(i => i.id === nextInterfaceId);
    if (!nextIface || nextIface.isShutdown) return false;

    // If next device is a switch, trace through it
    if (nextDevice.type === 'switch') {
      return traceThroughSwitch(topology, nextDevice, nextIface, targetIP, visited);
    }

    // If next device is a router, check if it's the target or recurse
    if (nextDevice.interfaces.some(i => i.ip === targetIP && !i.isShutdown)) {
      return true;
    }
    return tracePacketPath(topology, nextDevice, nextIface, targetIP, visited);
  }

  // If current device is a switch, trace through it
  if (currentDevice.type === 'switch') {
    return traceThroughSwitch(topology, currentDevice, srcInterface, targetIP, visited);
  }

  return false;
}

/**
 * Trace a packet through a switch to find the target.
 * Switches flood to all ports (except ingress) looking for the target.
 */
function traceThroughSwitch(
  topology: Topology,
  switchDevice: Device,
  ingressInterface: Interface,
  targetIP: string,
  visited: Set<string>
): boolean {
  // Check all connected interfaces (flood behavior)
  for (const iface of switchDevice.interfaces) {
    if (iface.id === ingressInterface.id || !iface.connectedTo || iface.isShutdown) continue;

    const [connDeviceId, connInterfaceId] = iface.connectedTo.split('/');
    const connDevice = topology.devices.get(connDeviceId);
    if (!connDevice || visited.has(connDevice.id)) continue;

    const connIface = connDevice.interfaces.find(i => i.id === connInterfaceId);
    if (!connIface || connIface.isShutdown) continue;

    // Check if connected device has the target IP
    if (connDevice.type === 'router') {
      if (connDevice.interfaces.some(i => i.ip === targetIP && !i.isShutdown)) {
        return true;
      }
      // Recurse through the router
      if (tracePacketPath(topology, connDevice, connIface, targetIP, new Set(visited))) {
        return true;
      }
    } else if (connDevice.type === 'switch') {
      // Recurse through connected switch
      if (traceThroughSwitch(topology, connDevice, connIface, targetIP, new Set(visited))) {
        return true;
      }
    }
  }

  return false;
}

export function removeStaticRoute(device: Device, network: string, mask: string): boolean {
  const initialLength = device.routingTable.length;
  device.routingTable = device.routingTable.filter(r => 
    !(r.network === network && r.mask === mask && r.protocol === 'S')
  );
  return device.routingTable.length < initialLength;
}
