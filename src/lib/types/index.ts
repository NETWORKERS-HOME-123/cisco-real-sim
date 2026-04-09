/**
 * Core Types for Cisco Network Simulator
 * All data models and interfaces for the simulation engine
 */

// ============================================================================
// Device Types
// ============================================================================

export type DeviceType = 'router' | 'switch';

export type InterfaceStatus = 'up' | 'down' | 'administratively down' | 'err-disabled';
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
  // Subinterface support (Router-on-a-Stick)
  isSubinterface: boolean; // True if this is a subinterface
  parentInterface: string | null; // Parent physical interface name (e.g., "GigabitEthernet0/0")
  encapsulation: number | null; // 802.1Q VLAN ID for subinterfaces
  // IPv6 support
  ipv6: string | null; // IPv6 address
  ipv6PrefixLength: number; // IPv6 prefix length (default 64)
  ipv6LinkLocal: string | null; // Auto-generated link-local address
  // Port Security support
  portSecurity: PortSecurityConfig;
}

export type PortViolationMode = 'protect' | 'restrict' | 'shutdown';

export interface SecureMacAddress {
  mac: string;
  vlan: number;
  type: 'static' | 'sticky' | 'dynamic';
  learnedAt: number;
  lastSeen: number;
}

export interface PortSecurityConfig {
  enabled: boolean;
  maxMacAddresses: number;
  violationMode: PortViolationMode;
  stickyMacEnabled: boolean;
  secureMacAddresses: SecureMacAddress[];
  violationCount: number;
  errDisabled: boolean;
  lastViolationMac?: string;
  lastViolationTime?: number;
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
  // OSPF support
  ospfProcess: OSPFProcess | null;
  ospfConfig: OSPFConfig | null;
  // Layer 3 Switch support (SVI - Switch Virtual Interface)
  ipRouting: boolean; // Enable L3 forwarding on switch
  // ACL support
  acls: Map<string, ACL>; // ACL name -> ACL
  aclApplications: Map<string, ACLApplication>; // interfaceName -> ACL application
  // NAT support
  natConfig: NATConfig;
  // STP support
  stpConfig: STPConfig;
  // DHCP support
  dhcpConfig: DHCPConfig;
}

export interface Route {
  network: string;
  mask: string;
  nextHop: string | null;
  interface: string | null;
  protocol: 'C' | 'S' | 'D' | 'O' | string; // Connected, Static, OSPF, etc.
  metric: number;
  isLocal: boolean;
  isIPv6: boolean; // IPv6 route flag
}

// ============================================================================
// IPv6 Types
// ============================================================================

export interface IPv6Route {
  network: string;        // IPv6 network (e.g., "2001:db8::")
  prefixLength: number;   // Prefix length (e.g., 64)
  nextHop: string | null; // IPv6 next hop
  interface: string | null;
  protocol: 'C' | 'S' | 'O' | string;
  metric: number;
}

// ============================================================================
// OSPF Types
// ============================================================================

export type OSPFNeighborState = 
  | 'Down' 
  | 'Init' 
  | '2-Way' 
  | 'ExStart' 
  | 'Exchange' 
  | 'Loading' 
  | 'Full';

export type OSPFInterfaceState = 
  | 'Down' 
  | 'Loopback' 
  | 'Waiting' 
  | 'Point-to-Point' 
  | 'DR' 
  | 'BDR' 
  | 'DROther';

export interface OSPFNeighbor {
  neighborId: string;           // Router ID of neighbor
  neighborIp: string;           // IP address of neighbor
  state: OSPFNeighborState;
  interface: string;            // Local interface name
  priority: number;             // DR priority (0-255)
  dr: string;                   // DR router ID
  bdr: string;                  // BDR router ID
  deadTime: number;             // Seconds until declared dead
  lastHello: number;            // Timestamp of last hello
}

export interface OSPFInterface {
  interfaceName: string;
  areaId: string;               // Area ID (e.g., "0", "0.0.0.0")
  state: OSPFInterfaceState;
  cost: number;                 // OSPF cost
  helloInterval: number;        // Default: 10 seconds
  deadInterval: number;         // Default: 40 seconds
  priority: number;             // DR priority (0-255)
  dr: string;                   // Current DR
  bdr: string;                  // Current BDR
  neighbors: Map<string, OSPFNeighbor>; // neighborId -> neighbor
}

export type LSAType = 1 | 2 | 3 | 4 | 5 | 7;

export interface LSAHeader {
  lsType: LSAType;
  lsId: string;                 // Link State ID
  advertisingRouter: string;    // Router ID that originated this LSA
  lsSequenceNumber: number;
  lsAge: number;
  checksum: number;
  length: number;
}

export interface RouterLSALink {
  linkId: string;               // Neighbor Router ID or Network ID
  linkData: string;             // Interface IP or Subnet Mask
  type: 1 | 2 | 3 | 4;          // 1=Point-to-Point, 2=Transit, 3=Stub, 4=Virtual
  metric: number;
}

export interface RouterLSA {
  header: LSAHeader;
  v: boolean;                   // Virtual link endpoint
  e: boolean;                   // ASBR
  b: boolean;                   // ABR
  links: RouterLSALink[];
}

export type LSA = RouterLSA;   // Can add NetworkLSA, SummaryLSA, etc.

export interface OSPFProcess {
  processId: number;
  routerId: string;             // OSPF Router ID
  areas: Map<string, OSPFArea>; // areaId -> Area
  interfaces: Map<string, OSPFInterface>; // interfaceName -> Interface
  lsdb: Map<string, LSA>;       // LSA key -> LSA
  neighbors: Map<string, OSPFNeighbor>; // neighborId -> Neighbor (all neighbors)
  isActive: boolean;
  passiveInterfaces: Set<string>;
  defaultOriginate: boolean;
}

export interface OSPFArea {
  areaId: string;
  lsas: Map<string, LSA>;       // LSA key -> LSA in this area
  transitCapability: boolean;
  stubArea: boolean;
  defaultCost: number;
}

export interface OSPFConfig {
  processId: number;
  routerId: string | null;
  networks: OSPFNetwork[];      // Networks to advertise
  passiveInterfaces: string[];
  defaultOriginate: boolean;
}

export interface OSPFNetwork {
  network: string;
  wildcard: string;
  areaId: string;
}

// ============================================================================
// ACL Types
// ============================================================================

export type ACLType = 'standard' | 'extended';
export type ACLAction = 'permit' | 'deny';
export type ACLProtocol = 'ip' | 'tcp' | 'udp' | 'icmp';

export interface ACLACE {
  sequence: number;
  action: ACLAction;
  protocol?: ACLProtocol;
  source: string;           // IP or 'any'
  sourceWildcard?: string;  // For standard/extended
  destination?: string;     // For extended ACLs
  destWildcard?: string;    // For extended ACLs
  sourcePort?: number;      // For TCP/UDP
  sourcePortOperator?: 'eq' | 'gt' | 'lt' | 'range';
  destPort?: number;        // For TCP/UDP
  destPortOperator?: 'eq' | 'gt' | 'lt' | 'range';
  destPortEnd?: number;     // For range operator
  flags?: string[];         // TCP flags (established, etc.)
}

export interface ACL {
  name: string;             // Number (1-199) or name
  type: ACLType;
  entries: ACLACE[];
}

export interface ACLApplication {
  aclName: string;
  direction: 'in' | 'out';
}

// ============================================================================
// NAT Types
// ============================================================================

export type NATType = 'static' | 'dynamic' | 'pat';

export interface NATTranslation {
  protocol: 'tcp' | 'udp' | 'icmp' | 'ip';
  localIP: string;
  localPort?: number;       // For PAT
  globalIP: string;
  globalPort?: number;      // For PAT
  remoteIP?: string;        // For tracking connections
  remotePort?: number;
  timeout: number;          // Expiration timestamp
  hits: number;             // Number of packets translated
}

export interface NATPool {
  name: string;
  startIP: string;
  endIP: string;
  netmask: string;
  availableIPs: string[];   // Pool of available IPs
}

export interface StaticNAT {
  localIP: string;
  globalIP: string;
}

export interface NATConfig {
  insideInterfaces: Set<string>;    // Interfaces marked as ip nat inside
  outsideInterfaces: Set<string>;   // Interfaces marked as ip nat outside
  staticEntries: Map<string, StaticNAT>; // localIP -> StaticNAT
  pools: Map<string, NATPool>;      // poolName -> NATPool
  translations: Map<string, NATTranslation>; // key -> translation
  overloadInterface?: string;       // Interface for PAT overload
  overloadPool?: string;            // Pool name for PAT
}

// ============================================================================
// STP Types
// ============================================================================

export type STPPortRole = 'root' | 'designated' | 'alternate' | 'backup' | 'disabled';
export type STPPortState = 'blocking' | 'listening' | 'learning' | 'forwarding' | 'disabled';

export interface STPPort {
  interfaceName: string;
  role: STPPortRole;
  state: STPPortState;
  priority: number;           // Port priority (0-255, default 128)
  cost: number;               // Path cost
  designatedRoot: string;     // Root bridge ID
  designatedBridge: string;   // Designated bridge ID
  designatedPort: number;     // Designated port ID
  portID: number;             // Port ID (priority + port number)
  forwardTransitions: number; // Number of state transitions
  bpduGuard: boolean;         // BPDU Guard enabled
  bpduFilter: boolean;        // BPDU Filter enabled
  rootGuard: boolean;         // Root Guard enabled
  portFast: boolean;          // PortFast enabled
}

export interface STPVLAN {
  vlanId: number;
  rootBridge: string;         // Root bridge ID
  rootPriority: number;       // Root bridge priority
  rootCost: number;           // Cost to root
  rootPort: string | null;    // Root port interface name
  bridgeID: string;           // This bridge's ID
  bridgePriority: number;     // This bridge's priority
  maxAge: number;             // Max age (default 20s)
  helloTime: number;          // Hello time (default 2s)
  forwardDelay: number;       // Forward delay (default 15s)
  holdTime: number;           // Hold time
  topologyChange: boolean;    // Topology change in progress
  topologyChangeCount: number;
  timeSinceTC: number;        // Time since last topology change
  ports: Map<string, STPPort>; // interfaceName -> STPPort
}

export interface STPConfig {
  enabled: boolean;
  mode: 'stp' | 'rstp' | 'pvst'; // STP, Rapid-STP, or Per-VLAN STP
  vlanInstances: Map<number, STPVLAN>; // VLAN ID -> STP VLAN instance
  globalDefaults: {
    priority: number;           // Bridge priority (default 32768)
    maxAge: number;             // Default max age
    helloTime: number;          // Default hello time
    forwardDelay: number;       // Default forward delay
  };
}

export interface BPDU {
  protocolId: number;         // Always 0 for STP
  version: number;            // 0 for STP, 2 for RSTP
  bpduType: number;           // 0 for Config BPDU, 2 for TCN
  flags: number;              // Topology change flags
  rootId: string;             // Root bridge ID
  rootPathCost: number;       // Cost to root
  bridgeId: string;           // Sender bridge ID
  portId: number;             // Sender port ID
  messageAge: number;         // Age of message
  maxAge: number;             // Max age
  helloTime: number;          // Hello time
  forwardDelay: number;       // Forward delay
}

// ============================================================================
// DHCP Types
// ============================================================================

export type DHCPMessageType = 
  | 'DISCOVER' 
  | 'OFFER' 
  | 'REQUEST' 
  | 'DECLINE' 
 | 'ACK' 
  | 'NAK' 
  | 'RELEASE' 
  | 'INFORM';

export interface DHCPPool {
  name: string;
  network: string;            // Network address
  mask: string;               // Subnet mask
  defaultRouter: string[];    // Default gateway(s)
  dnsServer: string[];        // DNS server(s)
  domainName?: string;        // Domain name
  leaseTime: number;          // Lease time in seconds (default 86400 = 1 day)
  excludedIPs: string[];      // Excluded from DHCP range
  bindings: Map<string, DHCPBinding>; // IP -> binding
}

export interface DHCPBinding {
  ip: string;
  mac: string;
  clientId?: string;
  leaseExpiry: number;        // Timestamp when lease expires
  leaseTime: number;          // Original lease time
  state: 'active' | 'expired' | 'offered';
  poolName: string;
}

export interface DHCPConfig {
  enabled: boolean;
  pools: Map<string, DHCPPool>;     // poolName -> DHCPPool
  relayTargets: Map<string, string>; // interfaceName -> target IP (for DHCP relay)
}

export interface DHCPPacket {
  op: number;                 // 1 = request, 2 = reply
  htype: number;              // Hardware type (1 = Ethernet)
  hlen: number;               // Hardware address length (6)
  hops: number;               // Relay agent hops
  xid: number;                // Transaction ID
  secs: number;               // Seconds since client started
  flags: number;              // Flags
  ciaddr: string;             // Client IP address
  yiaddr: string;             // Your (client) IP address
  siaddr: string;             // Next server IP address
  giaddr: string;             // Relay agent IP address
  chaddr: string;             // Client hardware address (MAC)
  sname: string;              // Server name
  file: string;               // Boot file name
  options: Map<number, any>;  // DHCP options
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
  ospfProcess?: OSPFProcess | null;
  ospfConfig?: OSPFConfig | null;
  ipRouting?: boolean;
  acls?: [string, ACL][];
  aclApplications?: [string, ACLApplication][];
  natConfig?: NATConfig;
  stpConfig?: STPConfig;
  dhcpConfig?: {
    enabled: boolean;
    pools: [string, { name: string; network: string; mask: string; defaultRouter: string[]; dnsServer: string[]; domainName?: string; leaseTime: number; excludedIPs: string[]; bindings: [string, DHCPBinding][]; }][];
    relayTargets: [string, string][];
  };
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

export type CLIMode = 'user' | 'privileged' | 'config' | 'interface' | 'router' | 'acl' | 'dhcp';

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
