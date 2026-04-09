/**
 * STP (Spanning Tree Protocol) Engine
 * Implements IEEE 802.1D Spanning Tree Protocol for loop prevention
 * 
 * Features:
 * - Root bridge election (lowest Bridge ID)
 * - BPDU generation and processing
 * - Port roles: Root, Designated, Alternate, Backup
 * - Port states: Blocking, Listening, Learning, Forwarding
 * - Path cost calculation
 * - Topology change handling
 */

import {
  Device,
  Topology,
  STPConfig,
  STPVLAN,
  STPPort,
  STPPortRole,
  STPPortState,
  BPDU,
} from '../types';

// ============================================================================
// Constants
// ============================================================================

const STP_HELLO_TIME = 2000;        // 2 seconds in ms
const STP_FORWARD_DELAY = 15000;    // 15 seconds in ms
const STP_MAX_AGE = 20000;          // 20 seconds in ms

// Default port costs based on link speed
const PORT_COSTS: { [speed: string]: number } = {
  '10': 100,      // 10 Mbps
  '100': 19,      // 100 Mbps
  '1000': 4,      // 1 Gbps
  '10000': 2,     // 10 Gbps
};

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate Bridge ID from priority and MAC address
 */
function generateBridgeID(priority: number, macAddress: string): string {
  // Bridge ID: 2 bytes priority + 6 bytes MAC
  const priHex = priority.toString(16).padStart(4, '0');
  const macClean = macAddress.replace(/:/g, '').toLowerCase();
  return `${priHex}.${macClean}`;
}

/**
 * Generate Port ID from priority and port number
 */
function generatePortID(priority: number, portNumber: number): number {
  return (priority << 8) | (portNumber & 0xFF);
}

/**
 * Get default path cost for interface
 */
function getDefaultPathCost(interfaceName: string): number {
  // Infer speed from interface name
  if (interfaceName.toLowerCase().includes('gigabit')) {
    return PORT_COSTS['1000'];
  } else if (interfaceName.toLowerCase().includes('fast')) {
    return PORT_COSTS['100'];
  } else if (interfaceName.toLowerCase().includes('ten')) {
    return PORT_COSTS['10000'];
  }
  return PORT_COSTS['100'];
}

/**
 * Compare bridge IDs (lower is better)
 */
function compareBridgeIDs(id1: string, id2: string): number {
  if (id1 < id2) return -1;
  if (id1 > id2) return 1;
  return 0;
}

// ============================================================================
// STP Initialization
// ============================================================================

/**
 * Initialize STP for a switch
 */
export function initializeSTP(device: Device, vlanId: number = 1): STPVLAN {
  if (device.type !== 'switch') {
    throw new Error('STP can only be initialized on switches');
  }
  
  const macAddress = device.interfaces[0]?.mac || '00:00:00:00:00:00';
  const priority = device.stpConfig.globalDefaults.priority;
  const bridgeID = generateBridgeID(priority, macAddress);
  
  const stpVlan: STPVLAN = {
    vlanId,
    rootBridge: bridgeID,      // Initially believe we are root
    rootPriority: priority,
    rootCost: 0,
    rootPort: null,
    bridgeID,
    bridgePriority: priority,
    maxAge: device.stpConfig.globalDefaults.maxAge,
    helloTime: device.stpConfig.globalDefaults.helloTime,
    forwardDelay: device.stpConfig.globalDefaults.forwardDelay,
    holdTime: 1,
    topologyChange: false,
    topologyChangeCount: 0,
    timeSinceTC: 0,
    ports: new Map(),
  };
  
  // Initialize STP ports for all interfaces
  let portNumber = 1;
  for (const iface of device.interfaces) {
    const portID = generatePortID(128, portNumber++);
    const stpPort: STPPort = {
      interfaceName: iface.name,
      role: 'designated',        // Initially all ports are designated
      state: 'blocking',         // Start in blocking state
      priority: 128,
      cost: getDefaultPathCost(iface.name),
      designatedRoot: bridgeID,
      designatedBridge: bridgeID,
      designatedPort: portID,
      portID,
      forwardTransitions: 0,
      bpduGuard: false,
      bpduFilter: false,
      rootGuard: false,
      portFast: false,
    };
    
    stpVlan.ports.set(iface.name, stpPort);
  }
  
  device.stpConfig.vlanInstances.set(vlanId, stpVlan);
  return stpVlan;
}

// ============================================================================
// BPDU Handling
// ============================================================================

/**
 * Generate Configuration BPDU
 */
export function generateBPDU(device: Device, vlanId: number, portName: string): BPDU | null {
  const stpVlan = device.stpConfig.vlanInstances.get(vlanId);
  if (!stpVlan) return null;
  
  const port = stpVlan.ports.get(portName);
  if (!port) return null;
  
  // Don't send BPDU on PortFast ports (unless BPDU Filter is disabled)
  if (port.portFast && port.bpduFilter) return null;
  
  return {
    protocolId: 0,
    version: 0,
    bpduType: 0,  // Configuration BPDU
    flags: stpVlan.topologyChange ? 0x01 : 0x00,
    rootId: stpVlan.rootBridge,
    rootPathCost: stpVlan.rootCost,
    bridgeId: stpVlan.bridgeID,
    portId: port.portID,
    messageAge: 0,
    maxAge: stpVlan.maxAge,
    helloTime: stpVlan.helloTime,
    forwardDelay: stpVlan.forwardDelay,
  };
}

/**
 * Process received BPDU
 */
export function processBPDU(
  device: Device,
  vlanId: number,
  portName: string,
  bpdu: BPDU
): boolean {
  const stpVlan = device.stpConfig.vlanInstances.get(vlanId);
  if (!stpVlan) return false;
  
  const port = stpVlan.ports.get(portName);
  if (!port) return false;
  
  // Check for BPDU Guard
  if (port.bpduGuard && port.portFast) {
    // Err-disable the port
    port.state = 'disabled';
    return true;
  }
  
  // Check for Root Guard
  if (port.rootGuard) {
    const receivedRoot = bpdu.rootId;
    const ourRoot = stpVlan.rootBridge;
    if (compareBridgeIDs(receivedRoot, ourRoot) < 0) {
      // Superior BPDU received on root-guard port - block it
      port.state = 'blocking';
      return true;
    }
  }
  
  // Compare BPDU with current port's designated BPDU
  const currentRoot = stpVlan.rootBridge;
  const receivedRoot = bpdu.rootId;
  
  let superiorBPDU = false;
  
  // Compare root bridge ID
  const rootComparison = compareBridgeIDs(receivedRoot, currentRoot);
  if (rootComparison < 0) {
    // Received BPDU has better root
    superiorBPDU = true;
  } else if (rootComparison === 0) {
    // Same root, compare path cost
    const receivedCost = bpdu.rootPathCost + port.cost;
    if (receivedCost < stpVlan.rootCost) {
      superiorBPDU = true;
    } else if (receivedCost === stpVlan.rootCost) {
      // Same cost, compare sender bridge ID
      const bridgeComparison = compareBridgeIDs(bpdu.bridgeId, stpVlan.bridgeID);
      if (bridgeComparison < 0) {
        superiorBPDU = true;
      } else if (bridgeComparison === 0) {
        // Same bridge, compare port ID
        if (bpdu.portId < port.portID) {
          superiorBPDU = true;
        }
      }
    }
  }
  
  if (superiorBPDU) {
    // Update our STP state based on superior BPDU
    stpVlan.rootBridge = bpdu.rootId;
    stpVlan.rootCost = bpdu.rootPathCost + port.cost;
    stpVlan.rootPort = portName;
    
    // Update port role
    port.role = 'root';
    port.designatedRoot = bpdu.rootId;
    port.designatedBridge = bpdu.bridgeId;
    port.designatedPort = bpdu.portId;
    
    // Transition state
    transitionPortState(port, 'listening');
    
    // Topology change
    stpVlan.topologyChange = true;
    stpVlan.topologyChangeCount++;
    
    return true;
  }
  
  // If we have a better BPDU, keep our role as designated
  if (port.role === 'designated' && rootComparison > 0) {
    // We have better root, remain designated
    return false;
  }
  
  // Check if this port should be alternate or backup
  if (rootComparison === 0 && stpVlan.rootPort && stpVlan.rootPort !== portName) {
    // Same root, but not root port - could be alternate
    const rootPort = stpVlan.ports.get(stpVlan.rootPort);
    if (rootPort) {
      const receivedCost = bpdu.rootPathCost + port.cost;
      const rootPortCost = stpVlan.rootCost;
      
      if (receivedCost > rootPortCost) {
        port.role = 'alternate';
        port.state = 'blocking';
      } else if (receivedCost === rootPortCost) {
        // Same cost, compare upstream bridge
        if (compareBridgeIDs(bpdu.bridgeId, stpVlan.bridgeID) !== 0) {
          port.role = 'alternate';
          port.state = 'blocking';
        } else {
          // Same bridge - backup port
          port.role = 'backup';
          port.state = 'blocking';
        }
      }
    }
  }
  
  return false;
}

// ============================================================================
// Port State Transitions
// ============================================================================

/**
 * Transition port to a new state
 */
export function transitionPortState(port: STPPort, newState: STPPortState): void {
  const oldState = port.state;
  port.state = newState;
  
  if (newState === 'forwarding') {
    port.forwardTransitions++;
  }
  
  // In a real implementation, this would schedule timers for each transition:
  // blocking -> listening: immediate
  // listening -> learning: forwardDelay (15s)
  // learning -> forwarding: forwardDelay (15s)
}

/**
 * Run STP state machine for a port
 * Called periodically to advance port states
 */
export function runSTPPortStateMachine(
  device: Device,
  vlanId: number,
  portName: string,
  elapsedMs: number
): void {
  const stpVlan = device.stpConfig.vlanInstances.get(vlanId);
  if (!stpVlan) return;
  
  const port = stpVlan.ports.get(portName);
  if (!port) return;
  
  // Skip PortFast ports
  if (port.portFast && port.state === 'forwarding') return;
  
  // Simplified state machine - in real implementation would track timers per port
  switch (port.state) {
    case 'blocking':
      if (port.role === 'root' || port.role === 'designated') {
        transitionPortState(port, 'listening');
      }
      break;
      
    case 'listening':
      // After forwardDelay, move to learning
      // For simulation, we'll skip the actual timer tracking
      if (port.role !== 'alternate' && port.role !== 'backup') {
        transitionPortState(port, 'learning');
      }
      break;
      
    case 'learning':
      // After forwardDelay, move to forwarding
      transitionPortState(port, 'forwarding');
      break;
      
    case 'forwarding':
    case 'disabled':
      // Terminal states
      break;
  }
}

// ============================================================================
// Root Bridge Election
// ============================================================================

/**
 * Check if this bridge should be root
 */
export function checkRootBridge(device: Device, vlanId: number): boolean {
  const stpVlan = device.stpConfig.vlanInstances.get(vlanId);
  if (!stpVlan) return false;
  
  return stpVlan.bridgeID === stpVlan.rootBridge;
}

/**
 * Set bridge priority
 */
export function setBridgePriority(device: Device, vlanId: number, priority: number): void {
  const stpVlan = device.stpConfig.vlanInstances.get(vlanId);
  if (!stpVlan) return;
  
  stpVlan.bridgePriority = priority;
  
  // Regenerate bridge ID
  const macAddress = device.interfaces[0]?.mac || '00:00:00:00:00:00';
  stpVlan.bridgeID = generateBridgeID(priority, macAddress);
  
  // If we were root, update root bridge ID
  if (checkRootBridge(device, vlanId)) {
    stpVlan.rootBridge = stpVlan.bridgeID;
  }
}

// ============================================================================
// Port Configuration
// ============================================================================

/**
 * Set port priority
 */
export function setPortPriority(
  device: Device,
  vlanId: number,
  portName: string,
  priority: number
): void {
  const stpVlan = device.stpConfig.vlanInstances.get(vlanId);
  if (!stpVlan) return;
  
  const port = stpVlan.ports.get(portName);
  if (!port) return;
  
  port.priority = priority;
  
  // Regenerate port ID
  const portNumber = port.portID & 0xFF;
  port.portID = generatePortID(priority, portNumber);
}

/**
 * Set port cost
 */
export function setPortCost(
  device: Device,
  vlanId: number,
  portName: string,
  cost: number
): void {
  const stpVlan = device.stpConfig.vlanInstances.get(vlanId);
  if (!stpVlan) return;
  
  const port = stpVlan.ports.get(portName);
  if (!port) return;
  
  port.cost = cost;
}

/**
 * Enable/disable PortFast
 */
export function setPortFast(
  device: Device,
  vlanId: number,
  portName: string,
  enabled: boolean
): void {
  const stpVlan = device.stpConfig.vlanInstances.get(vlanId);
  if (!stpVlan) return;
  
  const port = stpVlan.ports.get(portName);
  if (!port) return;
  
  port.portFast = enabled;
  if (enabled) {
    // PortFast ports go directly to forwarding
    port.state = 'forwarding';
    port.role = 'designated';
  }
}

/**
 * Enable/disable BPDU Guard
 */
export function setBPDUGuard(
  device: Device,
  vlanId: number,
  portName: string,
  enabled: boolean
): void {
  const stpVlan = device.stpConfig.vlanInstances.get(vlanId);
  if (!stpVlan) return;
  
  const port = stpVlan.ports.get(portName);
  if (!port) return;
  
  port.bpduGuard = enabled;
}

// ============================================================================
// Show Functions
// ============================================================================

/**
 * Get formatted STP output
 */
export function showSTP(device: Device, vlanId?: number): string {
  if (device.type !== 'switch') {
    return '% STP is only available on switches\n';
  }
  
  const instances = vlanId 
    ? [device.stpConfig.vlanInstances.get(vlanId)].filter(Boolean) as STPVLAN[]
    : Array.from(device.stpConfig.vlanInstances.values());
  
  if (instances.length === 0) {
    return '% No STP instances configured\n';
  }
  
  let output = '';
  
  for (const stpVlan of instances) {
    output += `VLAN${stpVlan.vlanId}\n`;
    output += `  Spanning tree enabled protocol ${device.stpConfig.mode}\n`;
    output += `  Root ID    Priority    ${parseInt(stpVlan.rootBridge.substring(0, 4), 16)}\n`;
    output += `             Address     ${stpVlan.rootBridge.substring(5)}\n`;
    output += `             Cost        ${stpVlan.rootCost}\n`;
    output += `             Port        ${stpVlan.rootPort || '0'}\n`;
    output += `             Hello Time  ${stpVlan.helloTime} sec  Max Age ${stpVlan.maxAge} sec  Forward Delay ${stpVlan.forwardDelay} sec\n\n`;
    
    output += `  Bridge ID  Priority    ${parseInt(stpVlan.bridgeID.substring(0, 4), 16)}\n`;
    output += `             Address     ${stpVlan.bridgeID.substring(5)}\n`;
    output += `             Hello Time  ${stpVlan.helloTime} sec  Max Age ${stpVlan.maxAge} sec  Forward Delay ${stpVlan.forwardDelay} sec\n`;
    output += `             Aging Time  300\n\n`;
    
    output += 'Interface        Role      Sts       Cost      Prio.Nbr  Type\n';
    output += '---------------- --------- --------- --------- --------- -----------------\n';
    
    for (const port of stpVlan.ports.values()) {
      const role = port.role.padEnd(9);
      const state = port.state.padEnd(9);
      const cost = String(port.cost).padEnd(9);
      const prioNbr = `${port.priority}.${port.portID & 0xFF}`.padEnd(9);
      const type = port.portFast ? 'P2p Edge' : 'P2p';
      
      output += `${port.interfaceName.padEnd(16)} ${role} ${state} ${cost} ${prioNbr} ${type}\n`;
    }
    
    output += '\n';
  }
  
  return output;
}

/**
 * Get STP port information
 */
export function showSTPPort(device: Device, portName: string, vlanId?: number): string {
  if (device.type !== 'switch') {
    return '% STP is only available on switches\n';
  }
  
  const instances = vlanId 
    ? [device.stpConfig.vlanInstances.get(vlanId)].filter(Boolean) as STPVLAN[]
    : Array.from(device.stpConfig.vlanInstances.values());
  
  let output = '';
  
  for (const stpVlan of instances) {
    const port = stpVlan.ports.get(portName);
    if (!port) continue;
    
    output += `VLAN${stpVlan.vlanId} - ${portName}:\n`;
    output += `  Port Role: ${port.role}\n`;
    output += `  Port State: ${port.state}\n`;
    output += `  Port Priority: ${port.priority}\n`;
    output += `  Port Cost: ${port.cost}\n`;
    output += `  Designated Root: ${port.designatedRoot}\n`;
    output += `  Designated Bridge: ${port.designatedBridge}\n`;
    output += `  PortFast: ${port.portFast ? 'Enabled' : 'Disabled'}\n`;
    output += `  BPDU Guard: ${port.bpduGuard ? 'Enabled' : 'Disabled'}\n`;
    output += '\n';
  }
  
  return output || `% Port ${portName} not found\n`;
}

// ============================================================================
// Main STP Tick Function
// ============================================================================

/**
 * Main STP update function - called periodically
 */
export function stpTick(device: Device, currentTime: number): void {
  if (device.type !== 'switch') return;
  if (!device.stpConfig.enabled) return;
  
  for (const [vlanId, stpVlan] of device.stpConfig.vlanInstances) {
    // Process each port
    for (const [portName, port] of stpVlan.ports) {
      // Skip disabled and PortFast forwarding ports
      if (port.state === 'disabled') continue;
      if (port.portFast && port.state === 'forwarding') continue;
      
      // Run state machine (simplified - would track actual timers in full impl)
      runSTPPortStateMachine(device, vlanId, portName, 1000);
    }
    
    // If we're the root bridge, send BPDUs on all designated ports
    if (checkRootBridge(device, vlanId)) {
      // In simulation, BPDUs are generated when needed
    }
    
    // Update topology change timer
    if (stpVlan.topologyChange) {
      stpVlan.timeSinceTC += 1000;
      if (stpVlan.timeSinceTC > stpVlan.maxAge * 1000) {
        stpVlan.topologyChange = false;
      }
    }
  }
}
