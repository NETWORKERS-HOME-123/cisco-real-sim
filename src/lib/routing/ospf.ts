/**
 * OSPF (Open Shortest Path First) Routing Protocol Engine
 * Single-Area OSPFv2 Implementation for CCNA Network Simulator
 * 
 * Features:
 * - Hello protocol for neighbor discovery
 * - Neighbor state machine (Down→Init→2-Way→ExStart→Exchange→Loading→Full)
 * - DR/BDR election on broadcast segments
 * - LSA Type 1 (Router LSA) generation and flooding
 * - LSDB synchronization
 * - SPF calculation using Dijkstra's algorithm
 * - Route installation to routing table
 */

import {
  Device,
  Interface,
  OSPFProcess,
  OSPFInterface,
  OSPFNeighbor,
  OSPFArea,
  OSPFConfig,
  OSPFNetwork,
  RouterLSA,
  RouterLSALink,
  LSA,
  LSAType,
  Route,
  Topology,
} from '../types';
import { MinHeap } from '../utils/priorityQueue';

// IP utilities for OSPF LSA generation
function ipToLong(ip: string): number {
  const parts = ip.split('.').map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function longToIP(long: number): string {
  return [
    (long >>> 24) & 0xFF,
    (long >>> 16) & 0xFF,
    (long >>> 8) & 0xFF,
    long & 0xFF,
  ].join('.');
}

function applySubnetMask(ip: string, mask: string): string {
  const ipLong = ipToLong(ip);
  const maskLong = ipToLong(mask);
  return longToIP(ipLong & maskLong);
}

// ============================================================================
// Constants
// ============================================================================

const OSPF_PROTOCOL_NUMBER = 89;
const OSPF_ALL_ROUTERS = '224.0.0.5';   // AllSPFRouters
const OSPF_ALL_DR = '224.0.0.6';        // AllDRouters

const DEFAULT_HELLO_INTERVAL = 10;      // seconds
const DEFAULT_DEAD_INTERVAL = 40;       // seconds (4x hello)
const DEFAULT_COST = 10;
const DEFAULT_PRIORITY = 1;

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Convert IP address to 32-bit integer for comparisons
 */
function ipToInt(ip: string): number {
  const parts = ip.split('.');
  return (parseInt(parts[0]) << 24) |
         (parseInt(parts[1]) << 16) |
         (parseInt(parts[2]) << 8) |
         parseInt(parts[3]);
}

/**
 * Check if an IP matches a network with wildcard mask
 */
function ipMatchesNetwork(ip: string, network: string, wildcard: string): boolean {
  const ipInt = ipToInt(ip);
  const netInt = ipToInt(network);
  const wildInt = ipToInt(wildcard);
  const maskInt = ~wildInt;
  
  return (ipInt & maskInt) === (netInt & maskInt);
}

/**
 * Get the highest IP address from all active interfaces
 * Used for automatic Router ID selection
 */
export function getHighestInterfaceIp(device: Device): string | null {
  let highestIp: number = 0;
  let highestIpStr: string | null = null;
  
  for (const iface of device.interfaces) {
    if (iface.ip && iface.status === 'up' && !iface.isShutdown) {
      const ipInt = ipToInt(iface.ip);
      if (ipInt > highestIp) {
        highestIp = ipInt;
        highestIpStr = iface.ip;
      }
    }
  }
  
  return highestIpStr;
}

/**
 * Generate a unique LSA key for the LSDB
 */
function getLSAKey(lsType: LSAType, lsId: string, advRouter: string): string {
  return `${lsType}-${lsId}-${advRouter}`;
}

// ============================================================================
// OSPF Process Management
// ============================================================================

/**
 * Create a new OSPF process on a device
 */
export function createOSPFProcess(device: Device, processId: number, routerId?: string): OSPFProcess {
  // Auto-select router ID if not provided
  const selectedRouterId = routerId || getHighestInterfaceIp(device) || '0.0.0.0';
  
  const process: OSPFProcess = {
    processId,
    routerId: selectedRouterId,
    areas: new Map(),
    interfaces: new Map(),
    lsdb: new Map(),
    neighbors: new Map(),
    isActive: true,
    passiveInterfaces: new Set(),
    defaultOriginate: false,
  };
  
  device.ospfProcess = process;
  device.ospfConfig = {
    processId,
    routerId: selectedRouterId,
    networks: [],
    passiveInterfaces: [],
    defaultOriginate: false,
  };
  
  return process;
}

/**
 * Delete OSPF process from a device
 */
export function deleteOSPFProcess(device: Device): void {
  device.ospfProcess = null;
  device.ospfConfig = null;
  
  // Remove OSPF routes from routing table
  device.routingTable = device.routingTable.filter(route => route.protocol !== 'O');
}

/**
 * Set OSPF Router ID (requires restart to take effect in real IOS)
 */
export function setOSPFRouterId(device: Device, routerId: string): void {
  if (device.ospfConfig) {
    device.ospfConfig.routerId = routerId;
  }
  if (device.ospfProcess) {
    device.ospfProcess.routerId = routerId;
  }
}

/**
 * Add a network to OSPF advertisement
 */
export function addOSPFNetwork(device: Device, network: string, wildcard: string, areaId: string): void {
  if (!device.ospfConfig) return;
  
  device.ospfConfig.networks.push({ network, wildcard, areaId });
  
  // Activate OSPF on matching interfaces
  activateOSPFOnInterfaces(device);
}

/**
 * Remove a network from OSPF
 */
export function removeOSPFNetwork(device: Device, network: string, wildcard: string): void {
  if (!device.ospfConfig) return;
  
  device.ospfConfig.networks = device.ospfConfig.networks.filter(
    (n: OSPFNetwork) => n.network !== network || n.wildcard !== wildcard
  );
}

/**
 * Set passive interface
 */
export function setPassiveInterface(device: Device, interfaceName: string, passive: boolean): void {
  if (!device.ospfConfig || !device.ospfProcess) return;
  
  if (passive) {
    device.ospfConfig.passiveInterfaces.push(interfaceName);
    device.ospfProcess.passiveInterfaces.add(interfaceName);
  } else {
    device.ospfConfig.passiveInterfaces = device.ospfConfig.passiveInterfaces.filter(
      i => i.toLowerCase() !== interfaceName.toLowerCase()
    );
    device.ospfProcess.passiveInterfaces.delete(interfaceName);
  }
}

/**
 * Configure default route origination
 */
export function setDefaultOriginate(device: Device, originate: boolean): void {
  if (!device.ospfConfig || !device.ospfProcess) return;
  
  device.ospfConfig.defaultOriginate = originate;
  device.ospfProcess.defaultOriginate = originate;
}

// ============================================================================
// OSPF Interface Management
// ============================================================================

/**
 * Activate OSPF on interfaces matching configured networks
 */
export function activateOSPFOnInterfaces(device: Device): void {
  if (!device.ospfProcess || !device.ospfConfig) return;
  
  for (const iface of device.interfaces) {
    if (!iface.ip || iface.isShutdown) continue;
    
    // Check if this interface matches any configured network
    for (const network of device.ospfConfig.networks) {
      if (ipMatchesNetwork(iface.ip, network.network, network.wildcard)) {
        // Check if already configured
        if (!device.ospfProcess.interfaces.has(iface.name)) {
          addOSPFInterface(device, iface.name, network.areaId);
        }
        break;
      }
    }
  }
}

/**
 * Add OSPF to an interface
 */
export function addOSPFInterface(device: Device, interfaceName: string, areaId: string): void {
  if (!device.ospfProcess) return;
  
  const iface = device.interfaces.find(i => i.name.toLowerCase() === interfaceName.toLowerCase());
  if (!iface || !iface.ip) return;
  
  const ospfIface: OSPFInterface = {
    interfaceName,
    areaId,
    state: 'Waiting',
    cost: calculateInterfaceCost(iface),
    helloInterval: DEFAULT_HELLO_INTERVAL,
    deadInterval: DEFAULT_DEAD_INTERVAL,
    priority: DEFAULT_PRIORITY,
    dr: '0.0.0.0',
    bdr: '0.0.0.0',
    neighbors: new Map(),
  };
  
  device.ospfProcess.interfaces.set(interfaceName, ospfIface);
  
  // Create or update area
  if (!device.ospfProcess.areas.has(areaId)) {
    device.ospfProcess.areas.set(areaId, {
      areaId,
      lsas: new Map(),
      transitCapability: false,
      stubArea: false,
      defaultCost: 1,
    });
  }
}

/**
 * Remove OSPF from an interface
 */
export function removeOSPFInterface(device: Device, interfaceName: string): void {
  if (!device.ospfProcess) return;
  
  const ospfIface = device.ospfProcess.interfaces.get(interfaceName);
  if (!ospfIface) return;
  
  // Clear all neighbors on this interface
  for (const [neighborId, neighbor] of ospfIface.neighbors) {
    device.ospfProcess.neighbors.delete(neighborId);
  }
  
  device.ospfProcess.interfaces.delete(interfaceName);
}

/**
 * Calculate OSPF cost based on bandwidth (simplified)
 * In real OSPF: cost = reference_bandwidth / interface_bandwidth
 */
function calculateInterfaceCost(iface: Interface): number {
  // Simplified - assume all are Gigabit Ethernet with cost 1
  // Could be enhanced to detect interface type from name
  return DEFAULT_COST;
}

/**
 * Set OSPF cost on interface
 */
export function setOSPFInterfaceCost(device: Device, interfaceName: string, cost: number): void {
  if (!device.ospfProcess) return;
  
  const ospfIface = device.ospfProcess.interfaces.get(interfaceName);
  if (ospfIface) {
    ospfIface.cost = cost;
  }
}

/**
 * Set OSPF priority on interface (for DR election)
 */
export function setOSPFInterfacePriority(device: Device, interfaceName: string, priority: number): void {
  if (!device.ospfProcess) return;
  
  const ospfIface = device.ospfProcess.interfaces.get(interfaceName);
  if (ospfIface) {
    ospfIface.priority = Math.max(0, Math.min(255, priority));
  }
}

/**
 * Set hello interval on interface
 */
export function setOSPFHelloInterval(device: Device, interfaceName: string, interval: number): void {
  if (!device.ospfProcess) return;
  
  const ospfIface = device.ospfProcess.interfaces.get(interfaceName);
  if (ospfIface) {
    ospfIface.helloInterval = interval;
    ospfIface.deadInterval = interval * 4;
  }
}

/**
 * Set dead interval on interface
 */
export function setOSPFDeadInterval(device: Device, interfaceName: string, interval: number): void {
  if (!device.ospfProcess) return;
  
  const ospfIface = device.ospfProcess.interfaces.get(interfaceName);
  if (ospfIface) {
    ospfIface.deadInterval = interval;
  }
}

// ============================================================================
// Neighbor State Machine
// ============================================================================

/**
 * Process received Hello packet
 * This is the core of OSPF neighbor discovery
 */
export function processHelloPacket(
  device: Device,
  interfaceName: string,
  sourceIp: string,
  helloData: {
    routerId: string;
    areaId: string;
    neighbors: string[];
    dr: string;
    bdr: string;
    priority: number;
    helloInterval: number;
    deadInterval: number;
  }
): void {
  if (!device.ospfProcess) return;
  
  const ospfIface = device.ospfProcess.interfaces.get(interfaceName);
  if (!ospfIface) return;
  
  // Ignore self-originated hellos
  if (helloData.routerId === device.ospfProcess.routerId) return;
  
  // Check area ID match
  if (helloData.areaId !== ospfIface.areaId) {
    // Area mismatch - ignore hello
    return;
  }
  
  // Check hello/dead interval match
  if (helloData.helloInterval !== ospfIface.helloInterval ||
      helloData.deadInterval !== ospfIface.deadInterval) {
    // Interval mismatch - ignore hello
    return;
  }
  
  // Get or create neighbor
  let neighbor = ospfIface.neighbors.get(helloData.routerId);
  
  if (!neighbor) {
    neighbor = {
      neighborId: helloData.routerId,
      neighborIp: sourceIp,
      state: 'Init',
      interface: interfaceName,
      priority: helloData.priority,
      dr: helloData.dr,
      bdr: helloData.bdr,
      deadTime: ospfIface.deadInterval,
      lastHello: Date.now(),
    };
    ospfIface.neighbors.set(helloData.routerId, neighbor);
    device.ospfProcess.neighbors.set(helloData.routerId, neighbor);
  } else {
    // Update neighbor info
    neighbor.priority = helloData.priority;
    neighbor.dr = helloData.dr;
    neighbor.bdr = helloData.bdr;
    neighbor.deadTime = ospfIface.deadInterval;
    neighbor.lastHello = Date.now();
  }
  
  // State machine transitions
  const oldState = neighbor.state;
  
  if (neighbor.state === 'Down') {
    neighbor.state = 'Init';
  }
  
  // Check if we see ourselves in neighbor's hello list
  const seenInHello = helloData.neighbors.includes(device.ospfProcess.routerId);
  
  if (neighbor.state === 'Init' && seenInHello) {
    neighbor.state = '2-Way';
    // Attempt DR/BDR election
    performDRElection(device, interfaceName);
  }
  
  // In real OSPF, we would progress through ExStart, Exchange, Loading to Full
  // For CCNA level, we'll simplify to 2-Way or Full
  if (neighbor.state === '2-Way') {
    // Check if we should form full adjacency
    // On broadcast: Full with DR/BDR only, 2-Way with others
    const isDR = ospfIface.dr === device.ospfProcess.routerId;
    const isBDR = ospfIface.bdr === device.ospfProcess.routerId;
    const neighborIsDR = neighbor.neighborId === ospfIface.dr;
    const neighborIsBDR = neighbor.neighborId === ospfIface.bdr;
    
    if (isDR || isBDR || neighborIsDR || neighborIsBDR || ospfIface.dr === '0.0.0.0') {
      neighbor.state = 'Full';
      // Trigger LSA generation when adjacency reaches Full
      generateRouterLSA(device);
    }
  }
  
  // If state changed to Full, run SPF
  if (oldState !== 'Full' && neighbor.state === 'Full') {
    runSPF(device);
  }
}

/**
 * Perform DR/BDR election on a broadcast interface
 */
function performDRElection(device: Device, interfaceName: string): void {
  if (!device.ospfProcess) return;
  
  const ospfIface = device.ospfProcess.interfaces.get(interfaceName);
  if (!ospfIface) return;
  
  // Collect all neighbors + self for election
  interface Candidate {
    routerId: string;
    priority: number;
    isSelf: boolean;
  }
  
  const candidates: Candidate[] = [
    {
      routerId: device.ospfProcess.routerId,
      priority: ospfIface.priority,
      isSelf: true,
    }
  ];
  
  for (const neighbor of ospfIface.neighbors.values()) {
    candidates.push({
      routerId: neighbor.neighborId,
      priority: neighbor.priority,
      isSelf: false,
    });
  }
  
  // Filter out priority 0 (never DR)
  const eligible = candidates.filter(c => c.priority > 0);
  
  // Sort by priority (desc), then router ID (desc)
  eligible.sort((a, b) => {
    if (a.priority !== b.priority) {
      return b.priority - a.priority;
    }
    return ipToInt(b.routerId) - ipToInt(a.routerId);
  });
  
  // Elect DR (highest priority, then highest router ID)
  const newDR = eligible[0]?.routerId || '0.0.0.0';
  const newBDR = eligible[1]?.routerId || '0.0.0.0';
  
  // Check if DR/BDR changed
  const drChanged = ospfIface.dr !== newDR || ospfIface.bdr !== newBDR;
  
  ospfIface.dr = newDR;
  ospfIface.bdr = newBDR;
  
  // Update interface state
  if (newDR === device.ospfProcess.routerId) {
    ospfIface.state = 'DR';
  } else if (newBDR === device.ospfProcess.routerId) {
    ospfIface.state = 'BDR';
  } else {
    ospfIface.state = 'DROther';
  }
  
  // If DR/BDR changed, adjacencies may need to be re-evaluated
  if (drChanged) {
    reevaluateAdjacencies(device, interfaceName);
  }
}

/**
 * Re-evaluate adjacencies after DR/BDR change
 */
function reevaluateAdjacencies(device: Device, interfaceName: string): void {
  if (!device.ospfProcess) return;
  
  const ospfIface = device.ospfProcess.interfaces.get(interfaceName);
  if (!ospfIface) return;
  
  const isDR = ospfIface.dr === device.ospfProcess.routerId;
  const isBDR = ospfIface.bdr === device.ospfProcess.routerId;
  
  for (const neighbor of ospfIface.neighbors.values()) {
    const neighborIsDR = neighbor.neighborId === ospfIface.dr;
    const neighborIsBDR = neighbor.neighborId === ospfIface.bdr;
    
    // On broadcast: Full with DR/BDR, 2-Way with others
    if (isDR || isBDR || neighborIsDR || neighborIsBDR) {
      if (neighbor.state !== 'Full') {
        neighbor.state = 'Full';
        generateRouterLSA(device);
        runSPF(device);
      }
    } else {
      neighbor.state = '2-Way';
    }
  }
}

/**
 * Handle neighbor dead timer expiration
 */
export function checkNeighborDeadTimers(device: Device): void {
  if (!device.ospfProcess) return;
  
  const now = Date.now();
  
  for (const ospfIface of device.ospfProcess.interfaces.values()) {
    for (const [neighborId, neighbor] of ospfIface.neighbors) {
      const elapsed = (now - neighbor.lastHello) / 1000;
      
      if (elapsed > neighbor.deadTime) {
        // Neighbor is dead
        ospfIface.neighbors.delete(neighborId);
        device.ospfProcess.neighbors.delete(neighborId);
        
        // Re-run DR election if this was DR or BDR
        if (neighbor.neighborId === ospfIface.dr || neighbor.neighborId === ospfIface.bdr) {
          performDRElection(device, neighbor.interface);
        }
        
        // Re-generate LSA and run SPF
        generateRouterLSA(device);
        runSPF(device);
      }
    }
  }
}

// ============================================================================
// Hello Packet Generation
// ============================================================================

/**
 * Generate Hello packet data for an interface
 */
export function generateHelloData(device: Device, interfaceName: string): {
  routerId: string;
  areaId: string;
  neighbors: string[];
  dr: string;
  bdr: string;
  priority: number;
  helloInterval: number;
  deadInterval: number;
} | null {
  if (!device.ospfProcess) return null;
  
  const ospfIface = device.ospfProcess.interfaces.get(interfaceName);
  if (!ospfIface) return null;
  
  // Don't send hellos on passive interfaces
  if (device.ospfProcess.passiveInterfaces.has(interfaceName)) {
    return null;
  }
  
  // Get list of neighbors we see
  const neighbors: string[] = [];
  for (const neighbor of ospfIface.neighbors.values()) {
    neighbors.push(neighbor.neighborId);
  }
  
  return {
    routerId: device.ospfProcess.routerId,
    areaId: ospfIface.areaId,
    neighbors,
    dr: ospfIface.dr,
    bdr: ospfIface.bdr,
    priority: ospfIface.priority,
    helloInterval: ospfIface.helloInterval,
    deadInterval: ospfIface.deadInterval,
  };
}

/**
 * Get all interfaces that need to send hellos
 */
export function getActiveOSPFInterfaces(device: Device): string[] {
  if (!device.ospfProcess) return [];
  
  const active: string[] = [];
  
  for (const [name, ospfIface] of device.ospfProcess.interfaces) {
    // Check if interface is up
    const iface = device.interfaces.find(i => i.name === name);
    if (iface && iface.status === 'up' && !iface.isShutdown) {
      if (!device.ospfProcess.passiveInterfaces.has(name)) {
        active.push(name);
      }
    }
  }
  
  return active;
}

// ============================================================================
// LSA Generation and Management
// ============================================================================

/**
 * Generate Router LSA (Type 1) for this router
 */
export function generateRouterLSA(device: Device): void {
  if (!device.ospfProcess) return;
  
  const process = device.ospfProcess;
  const links: RouterLSALink[] = [];
  
  // Build links from OSPF interfaces
  for (const [ifaceName, ospfIface] of process.interfaces) {
    const iface = device.interfaces.find(i => i.name === ifaceName);
    if (!iface || iface.isShutdown || iface.status !== 'up') continue;
    
    // Link to neighbors (Transit or Point-to-Point)
    for (const neighbor of ospfIface.neighbors.values()) {
      if (neighbor.state === 'Full') {
        if (ospfIface.state === 'DR' || ospfIface.state === 'BDR' || ospfIface.state === 'DROther') {
          // Broadcast/NBMA segment - Transit link
          // RFC 2328: linkId = IP address of DR, linkData = router's own IP
          // Find the DR neighbor to get its interface IP
          let drIP = iface.ip || '0.0.0.0';
          if (ospfIface.dr !== '0.0.0.0') {
            const drNeighbor = Array.from(ospfIface.neighbors.values()).find(n => n.neighborId === ospfIface.dr);
            if (drNeighbor) {
              drIP = drNeighbor.neighborIp;
            }
          }
          links.push({
            linkId: drIP,
            linkData: iface.ip || '0.0.0.0',
            type: 2,  // Transit
            metric: ospfIface.cost,
          });
        } else {
          // Point-to-Point link
          links.push({
            linkId: neighbor.neighborId,
            linkData: iface.ip || '0.0.0.0',
            type: 1,  // Point-to-Point
            metric: ospfIface.cost,
          });
        }
      }
    }
    
    // Stub network for interfaces with no full neighbors
    const hasFullNeighbor = Array.from(ospfIface.neighbors.values()).some(n => n.state === 'Full');
    if (!hasFullNeighbor && iface.ip && iface.subnetMask) {
      // RFC 2328: linkId = network address, linkData = subnet mask
      links.push({
        linkId: applySubnetMask(iface.ip, iface.subnetMask),
        linkData: iface.subnetMask,
        type: 3,  // Stub
        metric: ospfIface.cost,
      });
    }
  }
  
  // Create Router LSA
  const lsa: RouterLSA = {
    header: {
      lsType: 1,
      lsId: process.routerId,
      advertisingRouter: process.routerId,
      lsSequenceNumber: Date.now(),
      lsAge: 0,
      checksum: 0,  // Simplified
      length: 0,    // Simplified
    },
    v: false,  // No virtual links for CCNA
    e: false,  // Not ASBR (unless default originate)
    b: process.areas.size > 1,  // ABR if multiple areas
    links,
  };
  
  // If default originate is enabled, mark as ASBR
  if (process.defaultOriginate) {
    lsa.e = true;
  }
  
  // Store in LSDB
  const key = getLSAKey(1, process.routerId, process.routerId);
  process.lsdb.set(key, lsa);
  
  // Store in area LSDB
  const area = process.areas.get('0');  // Single-area for now
  if (area) {
    area.lsas.set(key, lsa);
  }
}

/**
 * Receive and process LSA from neighbor
 */
export function receiveLSA(device: Device, lsa: LSA, fromNeighbor: string): void {
  if (!device.ospfProcess) return;
  
  const key = getLSAKey(lsa.header.lsType, lsa.header.lsId, lsa.header.advertisingRouter);
  const existing = device.ospfProcess.lsdb.get(key);
  
  // Check if this is a newer LSA
  if (!existing || isNewerLSA(lsa, existing)) {
    // Store new LSA
    device.ospfProcess.lsdb.set(key, lsa);
    
    // Store in area LSDB
    // For now, assume area 0 (need to determine from receiving interface)
    const area = device.ospfProcess.areas.get('0');
    if (area) {
      area.lsas.set(key, lsa);
    }
    
    // Re-run SPF
    runSPF(device);
    
    // Flood to other neighbors (except the one we received from)
    floodLSA(device, lsa, fromNeighbor);
  }
}

/**
 * Compare two LSAs to determine which is newer
 */
function isNewerLSA(newLSA: LSA, oldLSA: LSA): boolean {
  const newHeader = newLSA.header;
  const oldHeader = oldLSA.header;
  
  // Compare sequence numbers first
  if (newHeader.lsSequenceNumber !== oldHeader.lsSequenceNumber) {
    return newHeader.lsSequenceNumber > oldHeader.lsSequenceNumber;
  }
  
  // Then checksum (simplified - higher is newer)
  if (newHeader.checksum !== oldHeader.checksum) {
    return newHeader.checksum > oldHeader.checksum;
  }
  
  // Then age (smaller age is newer, unless MaxAge)
  const MAX_AGE = 3600;
  if (newHeader.lsAge === MAX_AGE && oldHeader.lsAge !== MAX_AGE) {
    return true;
  }
  if (oldHeader.lsAge === MAX_AGE && newHeader.lsAge !== MAX_AGE) {
    return false;
  }
  
  return newHeader.lsAge < oldHeader.lsAge;
}

/**
 * Flood LSA to all neighbors except the source
 */
function floodLSA(device: Device, lsa: LSA, exceptNeighbor: string): void {
  if (!device.ospfProcess) return;
  
  for (const ospfIface of device.ospfProcess.interfaces.values()) {
    for (const neighbor of ospfIface.neighbors.values()) {
      if (neighbor.neighborId !== exceptNeighbor && neighbor.state === 'Full') {
        // In real implementation, would queue LSA for transmission
        // For simulation, we rely on periodic LSDB sync
      }
    }
  }
}

// ============================================================================
// SPF Calculation (Dijkstra Algorithm)
// ============================================================================

interface SPFNode {
  routerId: string;
  distance: number;
  parent: string | null;
  interface: string | null;
}

/**
 * Run SPF algorithm to calculate shortest paths
 * Optimized with MinHeap: O(E log V) instead of O(V²)
 */
export function runSPF(device: Device): void {
  if (!device.ospfProcess) return;
  
  const process = device.ospfProcess;
  const minHeap = new MinHeap<SPFNode>();
  const visited = new Map<string, SPFNode>();
  
  // Initialize with self
  const startNode: SPFNode = {
    routerId: process.routerId,
    distance: 0,
    parent: null,
    interface: null,
  };
  minHeap.insert(startNode, 0);
  
  // Dijkstra's algorithm with MinHeap (O(E log V))
  while (!minHeap.isEmpty()) {
    // Extract node with minimum distance (O(log V))
    const current = minHeap.extractMin()!;
    
    // Skip if already visited (we might have stale entries in heap)
    if (visited.has(current.routerId)) continue;
    
    visited.set(current.routerId, current);
    
    // Process neighbors from LSA
    const lsaKey = getLSAKey(1, current.routerId, current.routerId);
    const lsa = process.lsdb.get(lsaKey) as RouterLSA | undefined;
    
    if (!lsa) continue;
    
    for (const link of lsa.links) {
      if (link.type === 1 || link.type === 2) {
        // Point-to-Point or Transit - neighbor is another router
        const neighborId = link.linkId;
        
        if (!visited.has(neighborId)) {
          const newDistance = current.distance + link.metric;
          
          // Find the interface to reach this neighbor
          const outInterface = findInterfaceToNeighbor(device, current.routerId, neighborId);
          
          const neighborNode: SPFNode = {
            routerId: neighborId,
            distance: newDistance,
            parent: current.routerId,
            interface: outInterface,
          };
          
          // Add to heap (O(log V))
          minHeap.insert(neighborNode, newDistance);
        }
      }
    }
  }
  
  // Install routes based on SPF tree
  installOSPFRoutes(device, visited);
}

/**
 * Find the local interface used to reach a neighbor
 */
function findInterfaceToNeighbor(device: Device, fromRouter: string, toRouter: string): string | null {
  if (!device.ospfProcess) return null;
  
  // If fromRouter is us, find interface to toRouter
  if (fromRouter === device.ospfProcess.routerId) {
    for (const [ifaceName, ospfIface] of device.ospfProcess.interfaces) {
      const neighbor = ospfIface.neighbors.get(toRouter);
      if (neighbor) return ifaceName;
    }
  }
  
  return null;
}

/**
 * Install OSPF routes into the routing table
 */
function installOSPFRoutes(device: Device, spfTree: Map<string, SPFNode>): void {
  if (!device.ospfProcess) return;
  
  // Remove existing OSPF routes
  device.routingTable = device.routingTable.filter(r => r.protocol !== 'O');
  
  // Add new routes from SPF tree
  for (const [routerId, node] of spfTree) {
    if (routerId === device.ospfProcess.routerId) continue;
    
    // Get LSA for this router to find its networks
    const lsaKey = getLSAKey(1, routerId, routerId);
    const lsa = device.ospfProcess.lsdb.get(lsaKey) as RouterLSA | undefined;
    
    if (!lsa) continue;
    
    // Find outgoing interface
    let outInterface: string | null = null;
    let nextHop: string | null = null;
    
    // Trace back to find first hop
    let current = node;
    while (current.parent !== device.ospfProcess.routerId && current.parent) {
      const parent = spfTree.get(current.parent);
      if (!parent) break;
      current = parent;
    }
    
    outInterface = current.interface;
    
    // Find next-hop IP address
    if (outInterface) {
      const ospfIface = device.ospfProcess.interfaces.get(outInterface);
      if (ospfIface) {
        // Find neighbor on this interface
        for (const neighbor of ospfIface.neighbors.values()) {
          if (neighbor.state === 'Full') {
            // Check if this neighbor is on the path to the destination
            const neighborLSA = device.ospfProcess.lsdb.get(
              getLSAKey(1, neighbor.neighborId, neighbor.neighborId)
            ) as RouterLSA | undefined;
            
            if (neighborLSA && isOnPath(spfTree, neighbor.neighborId, routerId)) {
              nextHop = neighbor.neighborIp;
              break;
            }
          }
        }
      }
    }
    
    // Add stub network routes from this router's LSA
    for (const link of lsa.links) {
      if (link.type === 3) {
        // Stub network
        const route: Route = {
          network: link.linkId,
          mask: link.linkData,
          nextHop,
          interface: outInterface,
          protocol: 'O',
          metric: node.distance + link.metric,
          isLocal: false,
          isIPv6: false,
        };
        
        // Avoid duplicates
        const exists = device.routingTable.some(
          r => r.network === route.network && r.mask === route.mask
        );
        
        if (!exists) {
          device.routingTable.push(route);
        }
      }
    }
  }
  
  // Add default route if default-originate is enabled and we have a path to ASBR
  if (device.ospfProcess.defaultOriginate) {
    // Find ASBR
    for (const [key, lsa] of device.ospfProcess.lsdb) {
      const routerLSA = lsa as RouterLSA;
      if (routerLSA.e && routerLSA.header.advertisingRouter !== device.ospfProcess.routerId) {
        // Found an ASBR
        const asbrNode = spfTree.get(routerLSA.header.advertisingRouter);
        if (asbrNode) {
          const outInterface = asbrNode.interface;
          const nextHop = findNextHopToRouter(device, routerLSA.header.advertisingRouter);
          
          device.routingTable.push({
            network: '0.0.0.0',
            mask: '0.0.0.0',
            nextHop,
            interface: outInterface,
            protocol: 'O',
            metric: asbrNode.distance + 1,
            isLocal: false,
            isIPv6: false,
          });
          break;
        }
      }
    }
  }
}

/**
 * Check if a router is on the path from us to destination
 */
function isOnPath(spfTree: Map<string, SPFNode>, potentialHop: string, destination: string): boolean {
  let current = spfTree.get(destination);
  
  while (current) {
    if (current.routerId === potentialHop) return true;
    if (!current.parent) break;
    current = spfTree.get(current.parent);
  }
  
  return false;
}

/**
 * Find next-hop IP to reach a specific router
 */
function findNextHopToRouter(device: Device, routerId: string): string | null {
  if (!device.ospfProcess) return null;
  
  for (const ospfIface of device.ospfProcess.interfaces.values()) {
    const neighbor = ospfIface.neighbors.get(routerId);
    if (neighbor && neighbor.state === 'Full') {
      return neighbor.neighborIp;
    }
  }
  
  return null;
}

// ============================================================================
// Show Command Helpers
// ============================================================================

/**
 * Get formatted OSPF process information
 */
export function getOSPFProcessInfo(device: Device): string {
  if (!device.ospfProcess) {
    return 'OSPF not enabled\n';
  }
  
  const process = device.ospfProcess;
  
  let output = `Routing Process "ospf ${process.processId}" with ID ${process.routerId}\n`;
  output += `Supports only single TOS(TOS0) routes\n`;
  output += `Supports opaque LSA\n`;
  output += `It is an area border router\n`;
  output += `Initial SPF schedule delay 5000 msecs\n`;
  output += `Minimum hold time between two consecutive SPFs 10000 msecs\n`;
  output += `Maximum wait time between two consecutive SPFs 10000 msecs\n`;
  output += `Incremental-SPF disabled\n`;
  output += `Minimum LSA interval 5 secs\n`;
  output += `Minimum LSA arrival 1000 msecs\n`;
  output += `LSA group pacing timer 240 secs\n`;
  output += `Interface flood pacing timer 33 msecs\n`;
  output += `Retransmission pacing timer 66 msecs\n`;
  output += `Number of external LSA 0. Checksum Sum 0x000000\n`;
  output += `Number of opaque AS LSA 0. Checksum Sum 0x000000\n`;
  output += `Number of DCbitless external and opaque AS LSA 0\n`;
  output += `Number of DoNotAge external and opaque AS LSA 0\n`;
  output += `Number of areas in this router is ${process.areas.size}. 1 normal 0 stub 0 nssa\n`;
  output += `External flood list length 0\n`;
  
  for (const area of process.areas.values()) {
    output += `\nArea ${area.areaId}\n`;
    output += `  Number of interfaces in this area is ${countInterfacesInArea(device, area.areaId)}\n`;
    output += `  Area has no authentication\n`;
    output += `  SPF algorithm last executed ${Date.now() % 1000}ms ago\n`;
    output += `  SPF algorithm executed 1 times\n`;
    output += `  Area ranges are\n`;
    output += `  Number of LSA ${area.lsas.size}. Checksum Sum 0x000000\n`;
    output += `  Number of opaque link LSA 0. Checksum Sum 0x000000\n`;
    output += `  Number of DCbitless LSA 0\n`;
    output += `  Number of indication LSA 0\n`;
    output += `  Number of DoNotAge LSA 0\n`;
    output += `  Flood list length 0\n`;
  }
  
  return output;
}

function countInterfacesInArea(device: Device, areaId: string): number {
  if (!device.ospfProcess) return 0;
  
  let count = 0;
  for (const ospfIface of device.ospfProcess.interfaces.values()) {
    if (ospfIface.areaId === areaId) count++;
  }
  return count;
}

/**
 * Get formatted OSPF neighbor table
 */
export function getOSPFNeighborTable(device: Device): string {
  if (!device.ospfProcess) {
    return '% OSPF not enabled\n';
  }
  
  const neighbors = Array.from(device.ospfProcess.neighbors.values());
  
  if (neighbors.length === 0) {
    return '% No OSPF neighbors\n';
  }
  
  let output = '\nNeighbor ID     Pri   State           Dead Time   Address         Interface\n';
  
  for (const neighbor of neighbors) {
    const deadTime = Math.max(0, neighbor.deadTime - Math.floor((Date.now() - neighbor.lastHello) / 1000));
    const deadTimeStr = `${deadTime}s`;
    
    output += `${neighbor.neighborId.padEnd(15)} `;
    output += `${String(neighbor.priority).padStart(3)} `;
    output += `${neighbor.state.padEnd(15)} `;
    output += `${deadTimeStr.padEnd(11)} `;
    output += `${neighbor.neighborIp.padEnd(15)} `;
    output += `${neighbor.interface}\n`;
  }
  
  return output;
}

/**
 * Get formatted OSPF interface information
 */
export function getOSPFInterfaceInfo(device: Device, interfaceName?: string): string {
  if (!device.ospfProcess) {
    return '% OSPF not enabled\n';
  }
  
  let output = '';
  
  const interfaces = interfaceName 
    ? [device.ospfProcess.interfaces.get(interfaceName)].filter(Boolean)
    : Array.from(device.ospfProcess.interfaces.values());
  
  for (const ospfIface of interfaces) {
    if (!ospfIface) continue;
    
    const iface = device.interfaces.find(i => i.name === ospfIface.interfaceName);
    
    output += `${ospfIface.interfaceName} is ${iface?.status === 'up' ? 'up' : 'down'}, line protocol is ${iface?.status === 'up' ? 'up' : 'down'}\n`;
    output += `  Internet Address ${iface?.ip || '0.0.0.0'}/${iface?.subnetMask ? getMaskLength(iface.subnetMask) : 0}, Area ${ospfIface.areaId}\n`;
    output += `  Process ID ${device.ospfProcess.processId}, Router ID ${device.ospfProcess.routerId}, Network Type BROADCAST, Cost: ${ospfIface.cost}\n`;
    output += `  Transmit Delay is 1 sec, State ${ospfIface.state}, Priority ${ospfIface.priority}\n`;
    output += `  Designated Router (ID) ${ospfIface.dr}, Interface address ${iface?.ip || '0.0.0.0'}\n`;
    output += `  Backup Designated router (ID) ${ospfIface.bdr}, Interface address ${iface?.ip || '0.0.0.0'}\n`;
    output += `  Timer intervals configured, Hello ${ospfIface.helloInterval}, Dead ${ospfIface.deadInterval}, Wait ${ospfIface.deadInterval}, Retransmit 5\n`;
    output += `    oob-resync timeout 40\n`;
    output += `    Hello due in ${Math.floor(Math.random() * ospfIface.helloInterval)}s\n`;
    output += `  Supports Link-local Signaling (LLS)\n`;
    output += `  Index 1/1, flood queue length 0\n`;
    output += `  Next 0x0(0)/0x0(0)\n`;
    output += `  Last flood scan length is 0, maximum is 0\n`;
    output += `  Last flood scan time is 0 msec, maximum is 0 msec\n`;
    output += `  Neighbor Count is ${ospfIface.neighbors.size}, Adjacent neighbor count is ${countFullNeighbors(ospfIface)}\n`;
    output += `  Suppress hello for 0 neighbor(s)\n`;
    output += `\n`;
  }
  
  return output || '% No OSPF interfaces\n';
}

function getMaskLength(mask: string): number {
  const octets = mask.split('.').map(Number);
  let count = 0;
  for (const octet of octets) {
    for (let i = 7; i >= 0; i--) {
      if (octet & (1 << i)) count++;
    }
  }
  return count;
}

function countFullNeighbors(ospfIface: OSPFInterface): number {
  let count = 0;
  for (const neighbor of ospfIface.neighbors.values()) {
    if (neighbor.state === 'Full') count++;
  }
  return count;
}

/**
 * Get formatted OSPF database
 */
export function getOSPFDatabase(device: Device, areaId?: string): string {
  if (!device.ospfProcess) {
    return '% OSPF not enabled\n';
  }
  
  let output = '\n            OSPF Router with ID (' + device.ospfProcess.routerId + ') (Process ID ' + device.ospfProcess.processId + ')\n\n';
  
  // Show Router LSAs (Type 1)
  output += '                Router Link States (Area ' + (areaId || '0') + ')\n\n';
  output += 'Link ID         ADV Router      Age         Seq#       Checksum Link count\n';
  
  for (const [key, lsa] of device.ospfProcess.lsdb) {
    const routerLSA = lsa as RouterLSA;
    const age = Math.floor((Date.now() - routerLSA.header.lsSequenceNumber) / 1000) % 3600;
    const seqHex = routerLSA.header.lsSequenceNumber.toString(16).padStart(8, '0');
    
    output += `${routerLSA.header.lsId.padEnd(15)} `;
    output += `${routerLSA.header.advertisingRouter.padEnd(15)} `;
    output += `${String(age).padStart(11)} `;
    output += `0x${seqHex} `;
    output += `0x${routerLSA.header.checksum.toString(16).padStart(4, '0')} `;
    output += `${routerLSA.links.length}\n`;
  }
  
  return output;
}

/**
 * Get OSPF routes from routing table
 */
export function getOSPFRoutes(device: Device): string {
  const ospfRoutes = device.routingTable.filter(r => r.protocol === 'O');
  
  if (ospfRoutes.length === 0) {
    return '% No OSPF routes in routing table\n';
  }
  
  let output = 'Codes: L - local, C - connected, S - static, R - RIP, M - mobile, B - BGP\n';
  output += '       D - EIGRP, EX - EIGRP external, O - OSPF, IA - OSPF inter area\n';
  output += '       N1 - OSPF NSSA external type 1, N2 - OSPF NSSA external type 2\n';
  output += '       E1 - OSPF external type 1, E2 - OSPF external type 2\n';
  output += '\nGateway of last resort is not set\n\n';
  
  for (const route of ospfRoutes) {
    const cidr = getMaskLength(route.mask);
    const via = route.nextHop ? `via ${route.nextHop}` : `is directly connected`;
    const outputLine = route.nextHop 
      ? `O    ${route.network}/${cidr} [110/${route.metric}] ${via}, ${route.interface}`
      : `O    ${route.network} ${via}, ${route.interface}`;
    output += outputLine + '\n';
  }
  
  return output;
}

// ============================================================================
// OSPF Tick/Update Function
// ============================================================================

let lastHelloTick = 0;
let lastDeadCheck = 0;

/**
 * Main OSPF update function - call this periodically from simulation
 */
export function ospfTick(device: Device, currentTime: number): void {
  if (!device.ospfProcess) return;
  
  // Check dead timers every second
  if (currentTime - lastDeadCheck >= 1000) {
    checkNeighborDeadTimers(device);
    lastDeadCheck = currentTime;
  }
  
  // Hello generation is handled by the simulation engine based on per-interface timers
}

/**
 * Check if we should send hello on a specific interface
 */
export function shouldSendHello(device: Device, interfaceName: string, currentTime: number, lastHelloTime: number): boolean {
  if (!device.ospfProcess) return false;
  
  const ospfIface = device.ospfProcess.interfaces.get(interfaceName);
  if (!ospfIface) return false;
  
  const helloInterval = ospfIface.helloInterval * 1000; // Convert to ms
  return (currentTime - lastHelloTime) >= helloInterval;
}

// ============================================================================
// Export key functions for simulation integration
// ============================================================================

export {
  OSPF_PROTOCOL_NUMBER,
  OSPF_ALL_ROUTERS,
  OSPF_ALL_DR,
  DEFAULT_HELLO_INTERVAL,
  DEFAULT_DEAD_INTERVAL,
};
