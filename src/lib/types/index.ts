/**
 * Core Types for Cisco Network Simulator
 * All data models and interfaces for the simulation engine
 */

// ============================================================================
// Device Types
// ============================================================================

export type DeviceType = 'router' | 'switch';

export type InterfaceStatus = 'up' | 'down' | 'administratively down';
export type SwitchportMode = 'access' | 'trunk' | 'dynamic';

export interface VLAN {
  id: number; // 1-4094
  name: string;
  interfaces: string[]; // Interface IDs assigned to this VLAN
}

export interface Interface {
  id: string;
  name: string; // e.g., "FastEthernet0/0", "GigabitEthernet0/1"
  ip: string | null;
  subnetMask: string | null;
  mac: string;
  status: InterfaceStatus;
  connectedTo: string | null; // Format: "deviceId/interfaceId"
  isShutdown: boolean;
  description: string;
  // VLAN support
  switchportMode: SwitchportMode;
  accessVlan: number; // VLAN ID for access ports (default 1)
  trunkVlans: number[]; // Allowed VLANs on trunk (empty = all)
  nativeVlan: number; // Native VLAN for trunks (default 1)
}

export interface Device {
  id: string;
  name: string; // Hostname like "Router1", "Switch1"
  type: DeviceType;
  interfaces: Interface[];
  position: { x: number; y: number };
  macTable: Map<string, string>; // For switches: MAC -> Interface
  arpTable: Map<string, string>; // For routers: IP -> MAC
  routingTable: Route[]; // For routers
  isRunning: boolean;
  startupConfig: string[];
  runningConfig: string[];
  // VLAN support for switches
  vlans: Map<number, VLAN>; // VLAN ID -> VLAN
  vlanDatabase: VLAN[]; // All configured VLANs
  // Security
  enableSecret?: string; // Enable secret (takes precedence)
  enablePassword?: string; // Enable password (less secure)
  bannerMotd?: string; // Banner message of the day
}

export interface Route {
  network: string;
  mask: string;
  nextHop: string | null;
  interface: string | null;
  protocol: 'C' | 'S' | 'D' | 'O' | string; // Connected, Static, etc.
  metric: number;
  isLocal: boolean;
}

// ============================================================================
// Topology Types
// ============================================================================

export interface Link {
  id: string;
  from: string; // Format: "deviceId/interfaceId"
  to: string; // Format: "deviceId/interfaceId"
  status: 'up' | 'down';
}

export interface Topology {
  devices: Map<string, Device>;
  links: Map<string, Link>;
  version: number;
}

export interface SerializedTopology {
  devices: SerializedDevice[];
  links: Link[];
  version: number;
}

export interface SerializedDevice {
  id: string;
  name: string;
  type: DeviceType;
  interfaces: Interface[];
  position: { x: number; y: number };
  macTable: [string, string][];
  arpTable: [string, string][];
  routingTable: Route[];
  isRunning: boolean;
  startupConfig: string[];
  runningConfig: string[];
  vlans?: [number, VLAN][]; // Serialized as array of tuples
  vlanDatabase?: VLAN[];
}

// ============================================================================
// Packet Types
// ============================================================================

export type ProtocolType = 'ARP' | 'ICMP' | 'IP';

export interface Packet {
  id: string;
  srcIP: string | null;
  dstIP: string | null;
  srcMAC: string;
  dstMAC: string;
  protocol: ProtocolType;
  payload: ARPPayload | ICMPPayload | any;
  ttl: number;
  timestamp: number;
}

export interface ARPPayload {
  operation: 'request' | 'reply';
  senderIP: string;
  senderMAC: string;
  targetIP: string;
  targetMAC: string;
}

export interface ICMPPayload {
  type: 'echo-request' | 'echo-reply' | 'time-exceeded' | 'unreachable';
  code: number;
  identifier: number;
  sequenceNumber: number;
  data: string;
}

// ============================================================================
// Simulation Event Types
// ============================================================================

export interface SimulationEvent {
  id: string;
  type: 'packet' | 'command' | 'timeout';
  timestamp: number;
  data: any;
}

export interface PacketEvent extends SimulationEvent {
  type: 'packet';
  data: {
    packet: Packet;
    ingressDevice: string;
    ingressInterface: string;
  };
}

export interface CommandEvent extends SimulationEvent {
  type: 'command';
  data: {
    deviceId: string;
    command: string;
  };
}

// ============================================================================
// CLI Types
// ============================================================================

export type CLIMode = 'user' | 'privileged' | 'config' | 'interface';

export interface CLIParseResult {
  success: boolean;
  command: string;
  args: string[];
  mode: CLIMode;
  error?: string;
  action?: CLIAction;
}

export interface CLIAction {
  type: string;
  params: Record<string, any>;
}

export interface CLIParserState {
  mode: CLIMode;
  configTarget: string | null; // Interface name when in interface mode
  history: string[];
  historyIndex: number;
}

// ============================================================================
// Animation Types
// ============================================================================

export interface PacketAnimation {
  id: string;
  packetId: string;
  srcDevice: string;
  dstDevice: string;
  progress: number; // 0 to 1
  status: 'pending' | 'in-transit' | 'delivered' | 'dropped';
  color: string;
}

// ============================================================================
// Message Types (for Web Worker Communication)
// ============================================================================

export type WorkerMessageType = 
  | 'INIT'
  | 'TOPOLOGY_UPDATE'
  | 'CLI_COMMAND'
  | 'PACKET_INJECT'
  | 'STATE_UPDATE'
  | 'ANIMATION_EVENT'
  | 'ERROR';

export interface WorkerMessage {
  type: WorkerMessageType;
  payload: any;
  timestamp: number;
}

// ============================================================================
// Store Types
// ============================================================================

export interface UIState {
  selectedDevice: string | null;
  selectedTool: 'select' | 'router' | 'switch' | 'link' | 'delete';
  zoom: number;
  pan: { x: number; y: number };
  showGrid: boolean;
  packetAnimations: Map<string, PacketAnimation>;
}

export interface AppState {
  topology: SerializedTopology;
  ui: UIState;
  isSimulationRunning: boolean;
  eventCount: number;
}
