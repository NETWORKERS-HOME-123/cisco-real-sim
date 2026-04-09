/**
 * CLI Command Executor
 * Executes parsed CLI commands against the simulation engine
 */

import { Topology, Device, Interface, Route, CLIAction, CLIParserState, ACL } from '../types';
import { sanitizeInput, isValidHostname, isValidIPv6 as validateIPv6, truncate, LIMITS } from '../utils/security';
import {
  isValidIP,
  isValidMask,
  isSameNetwork,
  applySubnetMask,
  addConnectedRoutes,
  addStaticRoute,
  removeStaticRoute,
  createARPPacket,
  createICMPPacket,
  simulatePing,
} from '../simulation/simulationEngine';
import { findDeviceByName, generateMAC } from '../topology/topologyEngine';
import { EventQueue } from '../simulation/simulationEngine';
import { v4 as uuidv4 } from 'uuid';
import {
  createOSPFProcess,
  deleteOSPFProcess,
  setOSPFRouterId,
  addOSPFNetwork,
  removeOSPFNetwork,
  setPassiveInterface,
  setDefaultOriginate,
  setOSPFInterfaceCost,
  setOSPFInterfacePriority,
  setOSPFHelloInterval,
  setOSPFDeadInterval,
  getOSPFProcessInfo,
  getOSPFNeighborTable,
  getOSPFInterfaceInfo,
  getOSPFDatabase,
  getOSPFRoutes,
} from '../routing/ospf';
import {
  createACL,
  deleteACL,
  addACLEntry,
  removeACLEntry,
  applyACL,
  removeACLApplication,
  showACL,
  showACLApplications,
  getACLType,
  isValidACLNumber,
} from '../acl/aclEngine';
import {
  setNATInside,
  setNATOutside,
  removeNATInterface,
  configureStaticNAT,
  removeStaticNAT,
  createNATPool,
  deleteNATPool,
  configurePATOverload,
  removePATOverload,
  showNATTranslations,
  showNATStatistics,
} from '../nat/natEngine';
import {
  initializeSTP,
  setBridgePriority,
  setPortCost,
  setPortFast,
  setBPDUGuard,
  showSTP,
  showSTPPort,
} from '../stp/stpEngine';
import {
  createDHCPPool,
  deleteDHCPPool,
  configurePoolOptions,
  addExcludedIP,
  removeExcludedIP,
  configureDHCPRelay,
  removeDHCPRelay,
  showDHCPPools,
  showDHCPBindings,
  showDHCPStatistics,
} from '../dhcp/dhcpEngine';

// ============================================================================
// Executor Result
// ============================================================================

export interface ExecutorResult {
  success: boolean;
  output: string;
  error?: string;
  stateChanged: boolean;
}

// ============================================================================
// Helper Functions
// ============================================================================

function isLoopback(iface: Interface): boolean {
  return iface.name.toLowerCase().startsWith('loopback');
}

// Shared EUI-64 link-local formatter — converts 16-byte array to compressed IPv6 string
// Handles RFC 5952 zero compression: finds longest run of zero words and replaces with ::
function formatEUI64LinkLocal(bytes: number[]): string {
  const words: number[] = [];
  for (let i = 0; i < 8; i++) {
    words.push((bytes[i * 2] << 8) | bytes[i * 2 + 1]);
  }

  // Find longest run of consecutive zero words (RFC 5952)
  let bestStart = -1, bestLen = 0, curStart = -1, curLen = 0;
  for (let i = 0; i < 8; i++) {
    if (words[i] === 0) {
      if (curStart === -1) curStart = i;
      curLen++;
      if (curLen > bestLen) { bestStart = curStart; bestLen = curLen; }
    } else {
      curStart = -1; curLen = 0;
    }
  }

  const parts: string[] = [];
  let i = 0;
  while (i < 8) {
    if (i === bestStart && bestLen >= 2) {
      parts.push(i === 0 ? '::' : ':');
      i += bestLen;
    } else {
      parts.push((i > 0 && !(i === bestStart + bestLen && bestStart >= 0) ? ':' : '') + words[i].toString(16));
      i++;
    }
  }
  return parts.join('');
}

function getInterfaceStatusString(iface: Interface): string {
  if (iface.isShutdown) {
    return 'administratively down';
  }
  // Loopback interfaces are always up (no physical link needed)
  if (isLoopback(iface)) {
    return 'up';
  }
  return iface.connectedTo ? 'up' : 'down';
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  if (days > 0) {
    return `${days}d${hours}h`;
  } else if (hours > 0) {
    return `${hours}h${minutes}m`;
  } else {
    return `${minutes}m`;
  }
}

// ============================================================================
// Show Commands
// ============================================================================

function showVersion(device: Device): string {
  const uptime = Math.floor(Date.now() / 1000) % 1000000; // Simulated uptime
  
  return `
Cisco IOS Software, C${device.type === 'router' ? '800' : '2960'} Software (C${device.type === 'router' ? '800' : '2960'}-UNIVERSALK9-M), Version 15.7(3)M4, RELEASE SOFTWARE (fc1)
Technical Support: http://www.cisco.com/techsupport
Copyright (c) 1986-2018 by Cisco Systems, Inc.
Compiled Mon 10-Sep-18 06:25 by prod_rel_team

ROM: System Bootstrap, Version 15.4(1r)T, RELEASE SOFTWARE (fc1)

${device.name} uptime is ${formatUptime(uptime)}
System returned to ROM by reload at 00:00:00 UTC Mon Jan 1 2024
System restarted at 00:00:00 UTC Mon Jan 1 2024
System image file is "flash:c${device.type === 'router' ? '800' : '2960'}-universalk9-mz.SPA.157-3.M4.bin"
Last reload type: Normal Reload

This product contains cryptographic features and is subject to United
States and local country laws governing import, export, transfer and
use. Delivery of Cisco cryptographic products does not imply
third-party authority to import, export, distribute or use encryption.
Importers, exporters, distributors and users are responsible for
compliance with U.S. and local country laws. By using this product you
agree to comply with applicable laws and regulations. If you are unable
to comply with U.S. and local laws, return this product immediately.

A summary of U.S. laws governing Cisco cryptographic products may be found at:
http://www.cisco.com/wwl/export/crypto/tool/stqrg.html

If you require further assistance please contact us by sending email to
export@cisco.com.

cisco ${device.type === 'router' ? 'C881-K9' : 'WS-C2960+24TC-L'} ( revision A0 ) with ${device.type === 'router' ? '236544K/26624K' : '262144K'} bytes of memory.
Processor board ID FGL1639216M
Last reset from power-on
1 Virtual Ethernet interface
${device.interfaces.length} ${device.type === 'router' ? 'Gigabit Ethernet' : 'FastEthernet'} interfaces
32768K bytes of non-volatile configuration memory.
255744K bytes of physical memory.
249856K bytes of flash memory at bootflash:.

Configuration register is 0x2102
`;
}

function showRunningConfig(device: Device): string {
  let output = 'Building configuration...\n\n';
  output += 'Current configuration : ' + device.runningConfig.length * 10 + ' bytes\n';
  output += '!\n';
  output += '! Last configuration change at 00:00:00 UTC Mon Jan 1 2024\n';
  output += '!\n';
  output += 'version 15.7\n';
  output += 'service timestamps debug datetime msec\n';
  output += 'service timestamps log datetime msec\n';
  output += 'service password-encryption\n';
  output += '!\n';
  output += `hostname ${device.name}\n`;
  output += '!\n';
  if (device.enableSecret) {
    output += `enable secret 5 ${device.enableSecret}\n`;
  }
  if (device.enablePassword) {
    output += `enable password ${device.enablePassword}\n`;
  }
  output += '!\n';
  if (device.bannerMotd) {
    output += `banner motd ^C${device.bannerMotd}^C\n`;
  }
  output += '!\n';

  // Interface configurations
  for (const iface of device.interfaces) {
    output += `interface ${iface.name}\n`;
    if (iface.description) {
      output += ` description ${iface.description}\n`;
    }
    if (iface.ip && iface.subnetMask) {
      output += ` ip address ${iface.ip} ${iface.subnetMask}\n`;
    }
    if (iface.isShutdown) {
      output += ' shutdown\n';
    } else {
      output += ' no shutdown\n';
    }
    output += '!\n';
  }
  
  // Routing configuration
  for (const route of device.routingTable) {
    if (route.protocol === 'S') {
      output += `ip route ${route.network} ${route.mask} ${route.nextHop || route.interface}\n`;
    }
  }
  
  output += '!\n';
  output += 'end\n';
  
  return output;
}

function showStartupConfig(device: Device): string {
  if (device.startupConfig.length === 0) {
    return 'startup-config is not present\n';
  }
  return showRunningConfig({ ...device, runningConfig: device.startupConfig });
}

function showIPInterfaceBrief(device: Device): string {
  let output = '\n';
  output += 'Interface                  IP-Address      OK? Method Status                Protocol\n';
  
  for (const iface of device.interfaces) {
    const ip = iface.ip || 'unassigned';
    const method = iface.ip ? 'manual' : 'unset';
    const status = getInterfaceStatusString(iface);
    const protocol = iface.isShutdown ? 'down' : (isLoopback(iface) || iface.connectedTo ? 'up' : 'down');
    
    output += `${iface.name.padEnd(26)} ${ip.padEnd(15)} YES ${method.padEnd(7)} ${status.padEnd(21)} ${protocol}\n`;
  }
  
  return output + '\n';
}

function showInterfaces(device: Device, interfaceName?: string): string {
  let output = '';
  const interfaces = interfaceName 
    ? device.interfaces.filter(i => i.name.toLowerCase() === interfaceName.toLowerCase())
    : device.interfaces;
  
  for (const iface of interfaces) {
    const status = getInterfaceStatusString(iface);
    const protocol = iface.isShutdown ? 'down' : (isLoopback(iface) || iface.connectedTo ? 'up' : 'down');
    const isUp = !iface.isShutdown && (isLoopback(iface) || !!iface.connectedTo);
    
    output += `${iface.name} is ${status}, line protocol is ${protocol}\n`;
    const hwType = isLoopback(iface) ? 'Loopback' : (device.type === 'router' ? 'CN Gigabit Ethernet' : 'EtherSVI');
    output += `  Hardware is ${hwType}, address is ${iface.mac} (bia ${iface.mac})\n`;
    
    if (iface.description) {
      output += `  Description: ${iface.description}\n`;
    }
    
    if (iface.ip && iface.subnetMask) {
      output += `  Internet address is ${iface.ip}/${getPrefixLength(iface.subnetMask)}\n`;
    }
    
    output += `  MTU 1500 bytes, BW 100000 Kbit/sec, DLY 100 usec,\n`;
    output += `     reliability 255/255, txload 1/255, rxload 1/255\n`;
    output += `  Encapsulation ARPA, loopback not set\n`;
    output += `  Keepalive set (10 sec)\n`;
    
    if (isUp) {
      output += `  Full-duplex, 100Mb/s, media type is RJ45\n`;
      output += `  output flow-control is unsupported, input flow-control is unsupported\n`;
      output += `  ARP type: ARPA, ARP Timeout 04:00:00\n`;
      output += `  Last input 00:00:00, output 00:00:00, output hang never\n`;
      output += `  Last clearing of "show interface" counters never\n`;
      output += `  Input queue: 0/75/0/0 (size/max/drops/flushes); Total output drops: 0\n`;
      output += `  Queueing strategy: fifo\n`;
      output += `  Output queue: 0/40 (size/max)\n`;
      output += `  5 minute input rate 0 bits/sec, 0 packets/sec\n`;
      output += `  5 minute output rate 0 bits/sec, 0 packets/sec\n`;
      output += `     0 packets input, 0 bytes, 0 no buffer\n`;
      output += `     Received 0 broadcasts (0 IP multicasts)\n`;
      output += `     0 runts, 0 giants, 0 throttles\n`;
      output += `     0 input errors, 0 CRC, 0 frame, 0 overrun, 0 ignored\n`;
      output += `     0 watchdog, 0 multicast, 0 pause input\n`;
      output += `     0 packets output, 0 bytes, 0 underruns\n`;
      output += `     0 output errors, 0 collisions, 1 interface resets\n`;
      output += `     0 unknown protocol drops\n`;
      output += `     0 babbles, 0 late collision, 0 deferred\n`;
      output += `     0 lost carrier, 0 no carrier, 0 pause output\n`;
      output += `     0 output buffer failures, 0 output buffers swapped out\n`;
    } else {
      output += `  ${iface.isShutdown ? 'Administratively down' : 'Disconnected'}\n`;
    }
    
    output += '\n';
  }
  
  return output;
}

function showIPInterface(device: Device, interfaceName?: string): string {
  let output = '';
  const interfaces = interfaceName
    ? device.interfaces.filter(i => i.name.toLowerCase() === interfaceName.toLowerCase())
    : device.interfaces;

  if (interfaces.length === 0) {
    return interfaceName ? `% Interface ${interfaceName} not found\n` : '';
  }

  for (const iface of interfaces) {
    const status = getInterfaceStatusString(iface);
    const protocol = iface.isShutdown ? 'down' : (isLoopback(iface) || iface.connectedTo ? 'up' : 'down');

    output += `${iface.name} is ${status}, line protocol is ${protocol}\n`;

    if (iface.ip && iface.subnetMask) {
      output += `  Internet address is ${iface.ip}/${getPrefixLength(iface.subnetMask)}\n`;
      output += `  Broadcast address is 255.255.255.255\n`;
    } else {
      output += `  Internet protocol processing disabled\n`;
    }

    output += `  MTU is 1500 bytes\n`;
    output += `  Directed broadcast forwarding is disabled\n`;
    output += `  Outgoing Common access list is not set\n`;
    output += `  Outgoing access list is not set\n`;
    output += `  Inbound Common access list is not set\n`;
    output += `  Inbound  access list is not set\n`;
    output += `  Proxy ARP is enabled\n`;
    output += `  Local Proxy ARP is disabled\n`;
    output += `  Security level is default\n`;
    output += `  Split horizon is enabled\n`;
    output += `  ICMP redirects are always sent\n`;
    output += `  ICMP unreachables are always sent\n`;
    output += `  ICMP mask replies are never sent\n`;
    output += `  IP fast switching is enabled\n`;
    output += `  IP CEF switching is enabled\n`;
    output += `  IP multicast fast switching is enabled\n`;
    output += `  IP route-cache flags are Fast, CEF\n`;
    output += `  Router Discovery is disabled\n`;
    output += `  IP output packet accounting is disabled\n`;
    output += `  IP access violation accounting is disabled\n`;
    output += `  TCP/IP header compression is disabled\n`;
    output += `  RTP/IP header compression is disabled\n`;
    output += `  Probe proxy name replies are disabled\n`;
    output += `  Policy routing is disabled\n`;
    output += `  Network address translation is disabled\n`;
    output += `  BGP Policy Mapping is disabled\n`;
    output += `  Input features: MCI Check\n`;
    output += `  IPv4 WCCP Redirect outbound is disabled\n`;
    output += `  IPv4 WCCP Redirect inbound is disabled\n`;
    output += `  IPv4 WCCP Redirect exclude is disabled\n`;
    output += '\n';
  }

  return output;
}

function showIPRoute(device: Device): string {
  if (device.type === 'switch') {
    return 'IP routing not enabled on this switch\n';
  }
  
  let output = 'Codes: L - local, C - connected, S - static, R - RIP, M - mobile, B - BGP\n';
  output += '       D - EIGRP, EX - EIGRP external, O - OSPF, IA - OSPF inter area\n';
  output += '       N1 - OSPF NSSA external type 1, N2 - OSPF NSSA external type 2\n';
  output += '       E1 - OSPF external type 1, E2 - OSPF external type 2\n';
  output += '       i - IS-IS, su - IS-IS summary, L1 - IS-IS level-1, L2 - IS-IS level-2\n';
  output += '       ia - IS-IS inter area, * - candidate default, U - per-user static route\n';
  output += '       o - ODR, P - periodic downloaded static route, H - NHRP, l - LISP\n';
  output += '       a - application route\n';
  output += '       + - replicated route, % - next hop override, p - overrides from PfR\n\n';
  // Detect default route (0.0.0.0/0)
  const defaultRoute = device.routingTable.find(r =>
    r.network === '0.0.0.0' && r.mask === '0.0.0.0'
  );
  if (defaultRoute) {
    const via = defaultRoute.nextHop || defaultRoute.interface || 'unknown';
    output += `Gateway of last resort is ${via} to network 0.0.0.0\n\n`;
  } else {
    output += 'Gateway of last resort is not set\n\n';
  }
  
  // Add connected routes
  for (const iface of device.interfaces) {
    if (iface.ip && iface.subnetMask && !iface.isShutdown) {
      const network = applySubnetMask(iface.ip, iface.subnetMask);
      output += `C        ${network}/${getPrefixLength(iface.subnetMask)} is directly connected, ${iface.name}\n`;
      output += `L        ${iface.ip}/32 is directly connected, ${iface.name}\n`;
    }
  }

  // Add static and dynamic routes with AD/metric
  for (const route of device.routingTable) {
    if (route.protocol === 'S') {
      const prefix = getPrefixLength(route.mask);
      const ad = 1; // Static route AD
      const via = route.nextHop ? `via ${route.nextHop}` : `is directly connected, ${route.interface}`;
      output += `S        ${route.network}/${prefix} [${ad}/${route.metric}] ${via}\n`;
    } else if (route.protocol === 'O') {
      const prefix = getPrefixLength(route.mask);
      const ad = 110; // OSPF AD
      const via = route.nextHop ? `via ${route.nextHop}` : `is directly connected, ${route.interface}`;
      output += `O        ${route.network}/${prefix} [${ad}/${route.metric}] ${via}\n`;
    } else if (route.protocol === 'D') {
      const prefix = getPrefixLength(route.mask);
      const ad = 90; // EIGRP AD
      const via = route.nextHop ? `via ${route.nextHop}` : `is directly connected, ${route.interface}`;
      output += `D        ${route.network}/${prefix} [${ad}/${route.metric}] ${via}\n`;
    } else if (route.protocol === 'R') {
      const prefix = getPrefixLength(route.mask);
      const ad = 120; // RIP AD
      const via = route.nextHop ? `via ${route.nextHop}` : `is directly connected, ${route.interface}`;
      output += `R        ${route.network}/${prefix} [${ad}/${route.metric}] ${via}\n`;
    }
  }
  
  return output + '\n';
}

function showARP(device: Device): string {
  if (device.type === 'switch') {
    return 'This command is available only on routers.\n';
  }

  let output = 'Protocol  Address          Age (min)  Hardware Addr   Type   Interface\n';

  // Show self entries for each interface with an IP
  for (const iface of device.interfaces) {
    if (iface.ip && !iface.isShutdown) {
      output += `Internet  ${iface.ip.padEnd(15)}  -          ${iface.mac}  ARPA   ${iface.name}\n`;
    }
  }

  // Show dynamically learned ARP entries
  device.arpTable.forEach((mac, ip) => {
    // Find the best matching interface for this ARP entry
    const matchingIface = device.interfaces.find(i =>
      i.ip && i.subnetMask && isSameNetwork(i.ip, ip, i.subnetMask)
    );
    const ifaceName = matchingIface?.name || 'Unknown';
    output += `Internet  ${ip.padEnd(15)}  0          ${mac}  ARPA   ${ifaceName}\n`;
  });

  return output + '\n';
}

function showMACTable(device: Device): string {
  if (device.type === 'router') {
    return 'MAC address table is only available on switches.\n';
  }
  
  let output = '\n          Mac Address Table\n';
  output += '-------------------------------------------\n';
  output += 'Vlan    Mac Address       Type        Ports\n';
  output += '----    -----------       --------    -----\n';
  
  device.macTable.forEach((interfaceId, mac) => {
    const iface = device.interfaces.find(i => i.id === interfaceId);
    const port = iface ? iface.name.replace('FastEthernet', 'Fa') : 'Unknown';
    output += `  1    ${mac}    DYNAMIC     ${port}\n`;
  });
  
  output += '-------------------------------------------\n';
  output += `Total Mac Addresses for this criterion: ${device.macTable.size}\n\n`;
  
  return output;
}

function getPrefixLength(mask: string): number {
  const parts = mask.split('.').map(Number);
  let bits = 0;
  for (const part of parts) {
    let n = part;
    while (n > 0) {
      bits += n & 1;
      n >>= 1;
    }
  }
  return bits;
}

// ============================================================================
// Configuration Commands
// ============================================================================

// ============================================================================
// CDP Neighbor Discovery
// ============================================================================

function showCDPNeighbors(topology: Topology, device: Device): string {
  let output = 'Capability Codes: R - Router, T - Trans Bridge, B - Source Route Bridge\n';
  output += '                  S - Switch, H - Host, I - IGMP, r - Repeater, P - Phone,\n';
  output += '                  D - Remote, C - CVTA, M - Two-port Mac Relay\n\n';
  output += 'Device ID        Local Intrfce     Holdtme    Capability  Platform  Port ID\n';

  for (const iface of device.interfaces) {
    if (!iface.connectedTo || iface.isShutdown) continue;

    const [connDeviceId, connInterfaceId] = iface.connectedTo.split('/');
    const connDevice = topology.devices.get(connDeviceId);
    if (!connDevice) continue;

    const connIface = connDevice.interfaces.find(i => i.id === connInterfaceId);
    if (!connIface) continue;

    const capability = connDevice.type === 'router' ? 'R' : 'S';
    const platform = connDevice.type === 'router' ? 'C881-K9' : 'WS-C2960';
    const localPort = iface.name.replace('GigabitEthernet', 'Gig ').replace('FastEthernet', 'Fas ');
    const remotePort = connIface.name.replace('GigabitEthernet', 'Gig ').replace('FastEthernet', 'Fas ');

    output += `${connDevice.name.padEnd(16)} ${localPort.padEnd(17)} 180        ${capability.padEnd(11)} ${platform.padEnd(9)} ${remotePort}\n`;
  }

  output += '\nTotal cdp entries displayed : ' + device.interfaces.filter(i => i.connectedTo && !i.isShutdown).length + '\n';
  return output;
}

// ============================================================================
// Interface Entry (handles dynamic Loopback creation)
// ============================================================================

function handleInterfaceEntry(device: Device, interfaceName: string): ExecutorResult {
  // Check if interface already exists
  const existing = device.interfaces.find(i =>
    i.name.toLowerCase() === interfaceName.toLowerCase()
  );
  if (existing) {
    return { success: true, output: '', stateChanged: false };
  }

  // Auto-create Loopback interfaces (Cisco IOS creates them on first reference)
  const loopbackMatch = interfaceName.match(/^[Ll]oopback\s*(\d+)$/);
  if (loopbackMatch) {
    const loopNum = parseInt(loopbackMatch[1], 10);
    const canonicalName = `Loopback${loopNum}`;
    const newIface: Interface = {
      id: `${device.id}-lo${loopNum}`,
      name: canonicalName,
      ip: null,
      subnetMask: null,
      mac: generateMAC(),
      status: 'up',
      connectedTo: null,
      isShutdown: false,
      description: '',
      switchportMode: 'access',
      accessVlan: 0,
      trunkVlans: [],
      nativeVlan: 0,
      isSubinterface: false,
      parentInterface: null,
      encapsulation: null,
      ipv6: null,
      ipv6PrefixLength: 64,
      ipv6LinkLocal: null,
      portSecurity: {
        enabled: false,
        maxMacAddresses: 1,
        violationMode: 'shutdown',
        stickyMacEnabled: false,
        secureMacAddresses: [],
        violationCount: 0,
        errDisabled: false,
      },
    };
    device.interfaces.push(newIface);
    device.runningConfig.push(`interface ${canonicalName}`);
    return {
      success: true,
      output: '',
      stateChanged: true,
    };
  }

  // Auto-create Subinterfaces (e.g., GigabitEthernet0/0.10)
  const subifaceMatch = interfaceName.match(/^([Gg]igabit[Ee]thernet\d+\/\d+)\.(\d+)$/);
  if (subifaceMatch) {
    const parentName = subifaceMatch[1];
    const vlanId = parseInt(subifaceMatch[2], 10);
    
    // Check if parent interface exists
    const parent = device.interfaces.find(i =>
      i.name.toLowerCase() === parentName.toLowerCase()
    );
    if (!parent) {
      return {
        success: false,
        output: '',
        error: `% Parent interface ${parentName} does not exist\n`,
        stateChanged: false,
      };
    }
    
    // Create subinterface
    const canonicalName = parentName.charAt(0).toUpperCase() + parentName.slice(1) + '.' + vlanId;
    const newIface: Interface = {
      id: `${device.id}-sub-${parentName.replace(/\//g, '-')}-${vlanId}`,
      name: canonicalName,
      ip: null,
      subnetMask: null,
      mac: generateMAC(),
      status: parent.status,
      connectedTo: null,
      isShutdown: false,
      description: '',
      switchportMode: 'access',
      accessVlan: 0,
      trunkVlans: [],
      nativeVlan: 0,
      isSubinterface: true,
      parentInterface: parentName,
      encapsulation: vlanId,
      ipv6: null,
      ipv6PrefixLength: 64,
      ipv6LinkLocal: null,
      portSecurity: {
        enabled: false,
        maxMacAddresses: 1,
        violationMode: 'shutdown',
        stickyMacEnabled: false,
        secureMacAddresses: [],
        violationCount: 0,
        errDisabled: false,
      },
    };
    device.interfaces.push(newIface);
    device.runningConfig.push(`interface ${canonicalName}`);
    return {
      success: true,
      output: '',
      stateChanged: true,
    };
  }

  // Auto-create SVI (Switch Virtual Interface) - Vlan10, Vlan20, etc.
  const vlanMatch = interfaceName.match(/^[Vv]lan\s*(\d+)$/);
  if (vlanMatch) {
    // Only allow on switches or routers
    const vlanNum = parseInt(vlanMatch[1], 10);
    const canonicalName = `Vlan${vlanNum}`;
    
    // Check if VLAN exists (for switches)
    if (device.type === 'switch') {
      const vlan = device.vlans.get(vlanNum);
      if (!vlan) {
        return {
          success: false,
          output: '',
          error: `% VLAN ${vlanNum} does not exist\n`,
          stateChanged: false,
        };
      }
    }
    
    const newIface: Interface = {
      id: `${device.id}-vlan${vlanNum}`,
      name: canonicalName,
      ip: null,
      subnetMask: null,
      mac: generateMAC(),
      status: 'down', // SVI is down until there's at least one port in that VLAN
      connectedTo: null,
      isShutdown: false,
      description: '',
      switchportMode: 'access',
      accessVlan: vlanNum,
      trunkVlans: [],
      nativeVlan: 0,
      isSubinterface: false,
      parentInterface: null,
      encapsulation: null,
      ipv6: null,
      ipv6PrefixLength: 64,
      ipv6LinkLocal: null,
      portSecurity: {
        enabled: false,
        maxMacAddresses: 1,
        violationMode: 'shutdown',
        stickyMacEnabled: false,
        secureMacAddresses: [],
        violationCount: 0,
        errDisabled: false,
      },
    };
    device.interfaces.push(newIface);
    device.runningConfig.push(`interface ${canonicalName}`);
    return {
      success: true,
      output: '',
      stateChanged: true,
    };
  }

  // For non-loopback interfaces, just validate they exist
  return {
    success: false,
    output: '',
    error: `% Invalid interface type and target\n`,
    stateChanged: false,
  };
}

function setHostname(device: Device, name: string): ExecutorResult {
  // Sanitize and validate hostname
  const sanitized = sanitizeInput(name).trim();
  
  if (!isValidHostname(sanitized)) {
    return {
      success: false,
      output: '',
      error: 'Invalid hostname format. Must start with alphanumeric, contain only letters, numbers, and hyphens, max 63 chars.',
      stateChanged: false,
    };
  }
  
  const truncated = truncate(sanitized, LIMITS.HOSTNAME_MAX_LEN);
  const oldName = device.name;
  device.name = truncated;
  device.runningConfig.push(`hostname ${name}`);
  
  return {
    success: true,
    output: '',
    stateChanged: true,
  };
}

function setIPAddress(
  device: Device,
  interfaceName: string,
  ip: string,
  mask: string
): ExecutorResult {
  if (!isValidIP(ip)) {
    return {
      success: false,
      output: '',
      error: `Invalid IP address: ${ip}`,
      stateChanged: false,
    };
  }
  
  if (!isValidMask(mask)) {
    return {
      success: false,
      output: '',
      error: `Invalid subnet mask: ${mask}`,
      stateChanged: false,
    };
  }
  
  const iface = device.interfaces.find(i => 
    i.name.toLowerCase() === interfaceName.toLowerCase()
  );
  
  if (!iface) {
    return {
      success: false,
      output: '',
      error: `Interface ${interfaceName} does not exist`,
      stateChanged: false,
    };
  }
  
  iface.ip = ip;
  iface.subnetMask = mask;
  device.runningConfig.push(`interface ${interfaceName}`);
  device.runningConfig.push(` ip address ${ip} ${mask}`);
  
  // Update connected routes
  addConnectedRoutes(device);
  
  return {
    success: true,
    output: '',
    stateChanged: true,
  };
}

function removeIPAddress(device: Device, interfaceName: string): ExecutorResult {
  const iface = device.interfaces.find(i => 
    i.name.toLowerCase() === interfaceName.toLowerCase()
  );
  
  if (!iface) {
    return {
      success: false,
      output: '',
      error: `Interface ${interfaceName} does not exist`,
      stateChanged: false,
    };
  }
  
  iface.ip = null;
  iface.subnetMask = null;
  device.runningConfig.push(`interface ${interfaceName}`);
  device.runningConfig.push(' no ip address');
  
  // Update connected routes
  addConnectedRoutes(device);
  
  return {
    success: true,
    output: '',
    stateChanged: true,
  };
}

function setShutdown(device: Device, interfaceName: string, shutdown: boolean): ExecutorResult {
  const iface = device.interfaces.find(i => 
    i.name.toLowerCase() === interfaceName.toLowerCase()
  );
  
  if (!iface) {
    return {
      success: false,
      output: '',
      error: `Interface ${interfaceName} does not exist`,
      stateChanged: false,
    };
  }
  
  const wasUp = !iface.isShutdown && (isLoopback(iface) || !!iface.connectedTo);
  iface.isShutdown = shutdown;
  iface.status = shutdown ? 'administratively down' : (isLoopback(iface) || iface.connectedTo ? 'up' : 'down');
  const isUp = !iface.isShutdown && (isLoopback(iface) || !!iface.connectedTo);
  device.runningConfig.push(`interface ${interfaceName}`);
  device.runningConfig.push(shutdown ? ' shutdown' : ' no shutdown');

  // Update connected routes
  addConnectedRoutes(device);

  // Generate syslog-style messages on state change
  let syslog = '';
  if (wasUp !== isUp) {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 23);
    const stateStr = isUp ? 'up' : 'down';
    const protoStr = isUp ? 'up' : 'down';
    syslog += `${timestamp}: %LINK-3-UPDOWN: Interface ${iface.name}, changed state to ${stateStr}\n`;
    syslog += `${timestamp}: %LINEPROTO-5-UPDOWN: Line protocol on Interface ${iface.name}, changed state to ${protoStr}\n`;
  }

  return {
    success: true,
    output: syslog,
    stateChanged: true,
  };
}

function setDescription(device: Device, interfaceName: string, description: string): ExecutorResult {
  const iface = device.interfaces.find(i => 
    i.name.toLowerCase() === interfaceName.toLowerCase()
  );
  
  if (!iface) {
    return {
      success: false,
      output: '',
      error: `Interface ${interfaceName} does not exist`,
      stateChanged: false,
    };
  }
  
  // Sanitize and limit description length
  const sanitized = sanitizeInput(description);
  const truncated = truncate(sanitized, LIMITS.DESCRIPTION_MAX_LEN);
  
  iface.description = truncated;
  device.runningConfig.push(`interface ${interfaceName}`);
  device.runningConfig.push(` description ${truncated}`);
  
  return {
    success: true,
    output: '',
    stateChanged: true,
  };
}

function removeDescription(device: Device, interfaceName: string): ExecutorResult {
  return setDescription(device, interfaceName, '');
}

// ============================================================================
// VLAN Commands
// ============================================================================

function createVlan(device: Device, vlanId: number): ExecutorResult {
  if (device.type !== 'switch') {
    return { success: false, output: '', error: 'VLAN configuration is only available on switches', stateChanged: false };
  }
  if (vlanId < 1 || vlanId > 4094) {
    return { success: false, output: '', error: '% Bad VLAN list - character #1 is a non-numeric character.', stateChanged: false };
  }
  if (vlanId === 1) {
    return { success: true, output: 'Default VLAN 1 already exists\n', stateChanged: false };
  }

  if (!device.vlans.has(vlanId)) {
    const vlan = { id: vlanId, name: `VLAN${String(vlanId).padStart(4, '0')}`, interfaces: [] as string[] };
    device.vlans.set(vlanId, vlan);
    device.vlanDatabase.push(vlan);
  }
  device.runningConfig.push(`vlan ${vlanId}`);

  return { success: true, output: '', stateChanged: true };
}

function deleteVlan(device: Device, vlanId: number): ExecutorResult {
  if (device.type !== 'switch') {
    return { success: false, output: '', error: 'VLAN configuration is only available on switches', stateChanged: false };
  }
  if (vlanId === 1) {
    return { success: false, output: '', error: '% Default VLAN 1 may not be deleted.', stateChanged: false };
  }
  if (!device.vlans.has(vlanId)) {
    return { success: false, output: '', error: `% VLAN ${vlanId} not found`, stateChanged: false };
  }

  // Move ports back to VLAN 1
  const vlan = device.vlans.get(vlanId)!;
  const defaultVlan = device.vlans.get(1);
  for (const ifaceId of vlan.interfaces) {
    const iface = device.interfaces.find(i => i.id === ifaceId);
    if (iface && iface.accessVlan === vlanId) {
      iface.accessVlan = 1;
      if (defaultVlan) defaultVlan.interfaces.push(ifaceId);
    }
  }

  device.vlans.delete(vlanId);
  device.vlanDatabase = device.vlanDatabase.filter(v => v.id !== vlanId);
  device.runningConfig.push(`no vlan ${vlanId}`);

  return { success: true, output: '', stateChanged: true };
}

function setSwitchportMode(device: Device, interfaceName: string, mode: 'access' | 'trunk'): ExecutorResult {
  if (device.type !== 'switch') {
    return { success: false, output: '', error: '% Interface is not a switchport', stateChanged: false };
  }

  const iface = device.interfaces.find(i => i.name.toLowerCase() === interfaceName.toLowerCase());
  if (!iface) {
    return { success: false, output: '', error: `Interface ${interfaceName} does not exist`, stateChanged: false };
  }

  iface.switchportMode = mode;
  if (mode === 'trunk') {
    iface.trunkVlans = []; // empty = all VLANs allowed
  }
  device.runningConfig.push(`interface ${interfaceName}`);
  device.runningConfig.push(` switchport mode ${mode}`);

  return { success: true, output: '', stateChanged: true };
}

function setSwitchportAccessVlan(device: Device, interfaceName: string, vlanId: number): ExecutorResult {
  if (device.type !== 'switch') {
    return { success: false, output: '', error: '% Interface is not a switchport', stateChanged: false };
  }
  if (vlanId < 1 || vlanId > 4094) {
    return { success: false, output: '', error: '% Access VLAN does not exist. Creating vlan.', stateChanged: false };
  }

  const iface = device.interfaces.find(i => i.name.toLowerCase() === interfaceName.toLowerCase());
  if (!iface) {
    return { success: false, output: '', error: `Interface ${interfaceName} does not exist`, stateChanged: false };
  }

  // Auto-create VLAN if it doesn't exist (Cisco behavior)
  if (!device.vlans.has(vlanId)) {
    const vlan = { id: vlanId, name: `VLAN${String(vlanId).padStart(4, '0')}`, interfaces: [] as string[] };
    device.vlans.set(vlanId, vlan);
    device.vlanDatabase.push(vlan);
  }

  // Remove from old VLAN membership
  const oldVlan = device.vlans.get(iface.accessVlan);
  if (oldVlan) {
    oldVlan.interfaces = oldVlan.interfaces.filter(id => id !== iface.id);
  }

  // Add to new VLAN
  iface.accessVlan = vlanId;
  iface.switchportMode = 'access';
  const newVlan = device.vlans.get(vlanId)!;
  if (!newVlan.interfaces.includes(iface.id)) {
    newVlan.interfaces.push(iface.id);
  }

  device.runningConfig.push(`interface ${interfaceName}`);
  device.runningConfig.push(` switchport access vlan ${vlanId}`);

  return { success: true, output: '', stateChanged: true };
}

function setSwitchportTrunkAllowed(device: Device, interfaceName: string, vlansStr: string): ExecutorResult {
  if (device.type !== 'switch') {
    return { success: false, output: '', error: '% Interface is not a switchport', stateChanged: false };
  }

  const iface = device.interfaces.find(i => i.name.toLowerCase() === interfaceName.toLowerCase());
  if (!iface) {
    return { success: false, output: '', error: `Interface ${interfaceName} does not exist`, stateChanged: false };
  }

  // Parse VLAN list: "10,20,30" or "10-20" or "all"
  if (vlansStr.toLowerCase() === 'all') {
    iface.trunkVlans = [];
  } else {
    const vlanIds: number[] = [];
    for (const part of vlansStr.split(',')) {
      if (part.includes('-')) {
        const [start, end] = part.split('-').map(Number);
        for (let v = start; v <= end && v <= 4094; v++) vlanIds.push(v);
      } else {
        const v = parseInt(part, 10);
        if (v >= 1 && v <= 4094) vlanIds.push(v);
      }
    }
    iface.trunkVlans = vlanIds;
  }

  device.runningConfig.push(`interface ${interfaceName}`);
  device.runningConfig.push(` switchport trunk allowed vlan ${vlansStr}`);

  return { success: true, output: '', stateChanged: true };
}

function setSwitchportTrunkNative(device: Device, interfaceName: string, vlanId: number): ExecutorResult {
  if (device.type !== 'switch') {
    return { success: false, output: '', error: '% Interface is not a switchport', stateChanged: false };
  }

  const iface = device.interfaces.find(i => i.name.toLowerCase() === interfaceName.toLowerCase());
  if (!iface) {
    return { success: false, output: '', error: `Interface ${interfaceName} does not exist`, stateChanged: false };
  }

  iface.nativeVlan = vlanId;
  device.runningConfig.push(`interface ${interfaceName}`);
  device.runningConfig.push(` switchport trunk native vlan ${vlanId}`);

  return { success: true, output: '', stateChanged: true };
}

function setEncapsulationDot1Q(device: Device, interfaceName: string, vlanId: number): ExecutorResult {
  const iface = device.interfaces.find(i => i.name.toLowerCase() === interfaceName.toLowerCase());
  if (!iface) {
    return { success: false, output: '', error: `Interface ${interfaceName} does not exist`, stateChanged: false };
  }

  if (!iface.isSubinterface) {
    return { success: false, output: '', error: '% Encapsulation can only be set on subinterfaces', stateChanged: false };
  }

  iface.encapsulation = vlanId;
  device.runningConfig.push(`interface ${interfaceName}`);
  device.runningConfig.push(` encapsulation dot1Q ${vlanId}`);

  return { success: true, output: '', stateChanged: true };
}

function enableIPRouting(device: Device): ExecutorResult {
  if (device.type !== 'switch') {
    return { success: false, output: '', error: '% IP routing can only be enabled on switches', stateChanged: false };
  }

  device.ipRouting = true;
  device.runningConfig.push('ip routing');

  return { success: true, output: '', stateChanged: true };
}

function disableIPRouting(device: Device): ExecutorResult {
  device.ipRouting = false;
  device.runningConfig.push('no ip routing');

  return { success: true, output: '', stateChanged: true };
}

function showVlan(device: Device): string {
  if (device.type !== 'switch') {
    return '% This command is only available on switches.\n';
  }

  let output = '\nVLAN Name                             Status    Ports\n';
  output += '---- -------------------------------- --------- -------------------------------\n';

  // Sort VLANs by ID
  const sortedVlans = [...device.vlans.values()].sort((a, b) => a.id - b.id);

  for (const vlan of sortedVlans) {
    // Find access ports in this VLAN
    const ports = device.interfaces
      .filter(i => i.switchportMode === 'access' && i.accessVlan === vlan.id)
      .map(i => i.name.replace('FastEthernet', 'Fa'))
      .join(', ');

    output += `${String(vlan.id).padEnd(4)} ${vlan.name.padEnd(32)} active    ${ports}\n`;
  }

  output += '\n';
  return output;
}

function showInterfacesTrunk(device: Device): string {
  if (device.type !== 'switch') {
    return '% This command is only available on switches.\n';
  }

  const trunkPorts = device.interfaces.filter(i => i.switchportMode === 'trunk');

  if (trunkPorts.length === 0) {
    return '\nNo trunk interfaces configured.\n\n';
  }

  let output = '\nPort        Mode         Encapsulation  Status        Native vlan\n';
  output += '----------- ------------ -------------- ------------- -----------\n';

  for (const iface of trunkPorts) {
    const portName = iface.name.replace('FastEthernet', 'Fa');
    const status = iface.isShutdown ? 'not-connect' : (iface.connectedTo ? 'trunking' : 'not-connect');
    output += `${portName.padEnd(11)} on           802.1q         ${status.padEnd(13)} ${iface.nativeVlan}\n`;
  }

  output += '\nPort        Vlans allowed on trunk\n';
  output += '----------- ---------------------------------------------------------------------\n';

  for (const iface of trunkPorts) {
    const portName = iface.name.replace('FastEthernet', 'Fa');
    const allowed = iface.trunkVlans.length === 0 ? '1-4094' : iface.trunkVlans.join(',');
    output += `${portName.padEnd(11)} ${allowed}\n`;
  }

  output += '\n';
  return output;
}

// ============================================================================
// Routing Commands
// ============================================================================

function handleIPRoute(
  device: Device,
  network: string,
  mask: string,
  nextHop: string,
  remove: boolean
): ExecutorResult {
  if (!isValidIP(network)) {
    return {
      success: false,
      output: '',
      error: `Invalid network address: ${network}`,
      stateChanged: false,
    };
  }
  
  if (!isValidMask(mask)) {
    return {
      success: false,
      output: '',
      error: `Invalid subnet mask: ${mask}`,
      stateChanged: false,
    };
  }
  
  if (nextHop && !isValidIP(nextHop)) {
    return {
      success: false,
      output: '',
      error: `Invalid next hop: ${nextHop}`,
      stateChanged: false,
    };
  }
  
  if (device.type === 'switch') {
    return {
      success: false,
      output: '',
      error: 'IP routing is not enabled on switches',
      stateChanged: false,
    };
  }
  
  if (remove) {
    const removed = removeStaticRoute(device, network, mask);
    if (removed) {
      device.runningConfig.push(`no ip route ${network} ${mask} ${nextHop || ''}`);
    }
    return {
      success: removed,
      output: removed ? '' : 'No such route',
      stateChanged: removed,
    };
  } else {
    const added = addStaticRoute(device, network, mask, nextHop, null);
    if (added) {
      device.runningConfig.push(`ip route ${network} ${mask} ${nextHop}`);
    }
    return {
      success: added,
      output: added ? '' : 'Failed to add route',
      stateChanged: added,
    };
  }
}

// ============================================================================
// File Operations
// ============================================================================

function writeMemory(device: Device): ExecutorResult {
  device.startupConfig = [...device.runningConfig];
  return {
    success: true,
    output: 'Building configuration...\n[OK]\n',
    stateChanged: true,
  };
}

function eraseStartup(device: Device): ExecutorResult {
  device.startupConfig = [];
  return {
    success: true,
    output: 'Erasing the nvram filesystem will remove all configuration files! Continue? [confirm]\n[OK]\nErase of nvram: complete\n',
    stateChanged: true,
  };
}

function reload(device: Device): ExecutorResult {
  return {
    success: true,
    output: `\n\nSystem Bootstrap, Version 15.4(1r)T, RELEASE SOFTWARE (fc1)\n` +
            `Technical Support: http://www.cisco.com/techsupport\n` +
            `Copyright (c) 2014 by cisco Systems, Inc.\n\n` +
            `Current image file: flash:c800-universalk9-mz.SPA.157-3.M4.bin\n` +
            `Booting ${device.name}...\n\n` +
            `Press RETURN to get started!\n\n`,
    stateChanged: false,
  };
}

// ============================================================================
// Ping Command
// ============================================================================

function executePing(
  topology: Topology,
  device: Device,
  target: string,
  queue: EventQueue
): ExecutorResult {
  if (!isValidIP(target)) {
    return {
      success: false,
      output: '',
      error: `Invalid IP address: ${target}`,
      stateChanged: false,
    };
  }

  if (device.type === 'switch') {
    return {
      success: false,
      output: '',
      error: 'Ping is not available on switches',
      stateChanged: false,
    };
  }

  // Find source interface (use first interface with IP)
  const srcInterface = device.interfaces.find(i => i.ip && !i.isShutdown);
  if (!srcInterface) {
    return {
      success: false,
      output: '',
      error: 'No active interface with IP address',
      stateChanged: false,
    };
  }

  // Run real ping simulation that traces ICMP through the topology
  const pingResult = simulatePing(topology, device, target, 5);

  let output = `Type escape sequence to abort.\n`;
  output += `Sending 5, 100-byte ICMP Echos to ${target}, timeout is 2 seconds:\n`;
  output += pingResult.results.join('');
  output += '\n';
  output += `Success rate is ${Math.round((pingResult.received / pingResult.sent) * 100)} percent (${pingResult.received}/${pingResult.sent})`;

  if (pingResult.received > 0) {
    output += `, round-trip min/avg/max = ${pingResult.rttMin}/${pingResult.rttAvg}/${pingResult.rttMax} ms`;
  }
  output += '\n';

  // Also inject ICMP packet into simulation for visualization
  if (srcInterface.ip) {
    const icmpPacket = createICMPPacket(
      'echo-request',
      srcInterface.ip,
      target,
      srcInterface.mac,
      'FF:FF:FF:FF:FF:FF'
    );

    queue.enqueue({
      id: uuidv4(),
      type: 'packet',
      timestamp: Date.now(),
      data: {
        packet: icmpPacket,
        ingressDevice: device.id,
        ingressInterface: srcInterface.id,
      },
    });
  }

  return {
    success: true,
    output,
    stateChanged: false,
  };
}

// ============================================================================
// OSPF Command Handlers
// ============================================================================

function handleRouterOSPF(device: Device, processId: number): ExecutorResult {
  if (device.type !== 'router') {
    return { success: false, output: '', error: 'OSPF can only be configured on routers', stateChanged: false };
  }
  
  if (device.ospfProcess) {
    return { success: true, output: '', stateChanged: false };
  }
  
  createOSPFProcess(device, processId);
  device.runningConfig.push(`router ospf ${processId}`);
  
  return { success: true, output: '', stateChanged: true };
}

function handleNoRouterOSPF(device: Device): ExecutorResult {
  if (!device.ospfProcess) {
    return { success: false, output: '', error: 'OSPF is not configured', stateChanged: false };
  }
  
  deleteOSPFProcess(device);
  device.runningConfig = device.runningConfig.filter(line => !line.startsWith('router ospf'));
  
  return { success: true, output: '', stateChanged: true };
}

function handleOSPFNetwork(device: Device, network: string, wildcard: string, area: string): ExecutorResult {
  if (!device.ospfProcess) {
    return { success: false, output: '', error: 'OSPF is not configured', stateChanged: false };
  }
  
  if (!isValidIP(network)) {
    return { success: false, output: '', error: `Invalid network address: ${network}`, stateChanged: false };
  }
  
  if (!isValidIP(wildcard)) {
    return { success: false, output: '', error: `Invalid wildcard mask: ${wildcard}`, stateChanged: false };
  }
  
  addOSPFNetwork(device, network, wildcard, area);
  device.runningConfig.push(` network ${network} ${wildcard} area ${area}`);
  
  return { success: true, output: '', stateChanged: true };
}

function handleNoOSPFNetwork(device: Device, network: string, wildcard: string): ExecutorResult {
  if (!device.ospfProcess) {
    return { success: false, output: '', error: 'OSPF is not configured', stateChanged: false };
  }
  
  removeOSPFNetwork(device, network, wildcard);
  
  return { success: true, output: '', stateChanged: true };
}

function handleOSPFRouterId(device: Device, routerId: string): ExecutorResult {
  if (!device.ospfProcess) {
    return { success: false, output: '', error: 'OSPF is not configured', stateChanged: false };
  }
  
  if (!isValidIP(routerId)) {
    return { success: false, output: '', error: `Invalid router ID: ${routerId}`, stateChanged: false };
  }
  
  setOSPFRouterId(device, routerId);
  device.runningConfig.push(` router-id ${routerId}`);
  
  return { success: true, output: '', stateChanged: true };
}

function handleOSPFPassiveInterface(device: Device, interfaceName: string, passive: boolean): ExecutorResult {
  if (!device.ospfProcess) {
    return { success: false, output: '', error: 'OSPF is not configured', stateChanged: false };
  }
  
  setPassiveInterface(device, interfaceName, passive);
  
  if (passive) {
    device.runningConfig.push(` passive-interface ${interfaceName}`);
  } else {
    device.runningConfig.push(` no passive-interface ${interfaceName}`);
  }
  
  return { success: true, output: '', stateChanged: true };
}

function handleOSPFDefaultOriginate(device: Device, originate: boolean): ExecutorResult {
  if (!device.ospfProcess) {
    return { success: false, output: '', error: 'OSPF is not configured', stateChanged: false };
  }
  
  setDefaultOriginate(device, originate);
  
  if (originate) {
    device.runningConfig.push(' default-information originate');
  }
  
  return { success: true, output: '', stateChanged: true };
}

function handleIPOSPFCost(device: Device, interfaceName: string, cost: number): ExecutorResult {
  if (!device.ospfProcess) {
    return { success: false, output: '', error: 'OSPF is not configured', stateChanged: false };
  }
  
  if (cost < 1 || cost > 65535) {
    return { success: false, output: '', error: 'Cost must be between 1 and 65535', stateChanged: false };
  }
  
  setOSPFInterfaceCost(device, interfaceName, cost);
  
  return { success: true, output: '', stateChanged: true };
}

function handleIPOSPFPriority(device: Device, interfaceName: string, priority: number): ExecutorResult {
  if (!device.ospfProcess) {
    return { success: false, output: '', error: 'OSPF is not configured', stateChanged: false };
  }
  
  if (priority < 0 || priority > 255) {
    return { success: false, output: '', error: 'Priority must be between 0 and 255', stateChanged: false };
  }
  
  setOSPFInterfacePriority(device, interfaceName, priority);
  
  return { success: true, output: '', stateChanged: true };
}

function handleIPOSPFHelloInterval(device: Device, interfaceName: string, interval: number): ExecutorResult {
  if (!device.ospfProcess) {
    return { success: false, output: '', error: 'OSPF is not configured', stateChanged: false };
  }
  
  if (interval < 1 || interval > 65535) {
    return { success: false, output: '', error: 'Hello interval must be between 1 and 65535', stateChanged: false };
  }
  
  setOSPFHelloInterval(device, interfaceName, interval);
  
  return { success: true, output: '', stateChanged: true };
}

function handleIPOSPFDeadInterval(device: Device, interfaceName: string, interval: number): ExecutorResult {
  if (!device.ospfProcess) {
    return { success: false, output: '', error: 'OSPF is not configured', stateChanged: false };
  }
  
  if (interval < 1 || interval > 65535) {
    return { success: false, output: '', error: 'Dead interval must be between 1 and 65535', stateChanged: false };
  }
  
  setOSPFDeadInterval(device, interfaceName, interval);
  
  return { success: true, output: '', stateChanged: true };
}

// ============================================================================
// ACL Command Handlers
// ============================================================================

function handleAccessList(device: Device, number: string, action: string, remainder: string[]): ExecutorResult {
  const aclNum = parseInt(number, 10);
  if (isNaN(aclNum) || !isValidACLNumber(aclNum)) {
    return { success: false, output: '', error: `Invalid ACL number: ${number}`, stateChanged: false };
  }
  
  const aclType = getACLType(number);
  
  // Get or create ACL
  let acl: ACL | null | undefined = device.acls.get(number);
  if (!acl) {
    acl = createACL(device, number, aclType);
  }
  if (!acl) {
    return { success: false, output: '', error: 'Failed to create ACL', stateChanged: false };
  }
  
  // Parse remainder based on ACL type
  if (aclType === 'standard') {
    // Standard ACL: access-list <num> permit|deny <source> [wildcard]
    const source = remainder[0];
    if (!source) {
      return { success: false, output: '', error: 'Missing source address', stateChanged: false };
    }
    
    let srcIP: string;
    let srcWildcard: string;
    
    if (source.toLowerCase() === 'any') {
      srcIP = 'any';
      srcWildcard = '255.255.255.255';
    } else if (source.toLowerCase() === 'host') {
      srcIP = remainder[1] || '';
      srcWildcard = '0.0.0.0';
    } else {
      srcIP = source;
      srcWildcard = remainder[1] || '0.0.0.0';
    }
    
    if (!isValidIP(srcIP) && srcIP !== 'any') {
      return { success: false, output: '', error: `Invalid source IP: ${srcIP}`, stateChanged: false };
    }
    
    addACLEntry(device, number, {
      action: action as 'permit' | 'deny',
      source: srcIP,
      sourceWildcard: srcWildcard,
    });
    
    device.runningConfig.push(`access-list ${number} ${action} ${source}${remainder[1] ? ' ' + remainder[1] : ''}`);
    
  } else {
    // Extended ACL: access-list <num> permit|deny <protocol> <source> <dest> [port]
    const protocol = remainder[0] as 'ip' | 'tcp' | 'udp' | 'icmp';
    if (!protocol) {
      return { success: false, output: '', error: 'Missing protocol', stateChanged: false };
    }
    
    // Simplified parsing for extended ACLs
    // Format: access-list num permit/deny protocol source dest [port]
    const src = remainder[1];
    const dest = remainder[2];
    
    if (!src || !dest) {
      return { success: false, output: '', error: 'Missing source or destination', stateChanged: false };
    }
    
    addACLEntry(device, number, {
      action: action as 'permit' | 'deny',
      protocol,
      source: src,
      sourceWildcard: '0.0.0.0',
      destination: dest,
      destWildcard: '0.0.0.0',
    });
    
    device.runningConfig.push(`access-list ${number} ${action} ${remainder.join(' ')}`);
  }
  
  return { success: true, output: '', stateChanged: true };
}

function handleNoAccessList(device: Device, number: string): ExecutorResult {
  deleteACL(device, number);
  device.runningConfig.push(`no access-list ${number}`);
  return { success: true, output: '', stateChanged: true };
}

function handleIPAccessListStandard(device: Device, name: string): ExecutorResult {
  if (device.acls.has(name)) {
    return { success: true, output: '', stateChanged: false };
  }
  
  createACL(device, name, 'standard');
  device.runningConfig.push(`ip access-list standard ${name}`);
  return { success: true, output: '', stateChanged: true };
}

function handleIPAccessListExtended(device: Device, name: string): ExecutorResult {
  if (device.acls.has(name)) {
    return { success: true, output: '', stateChanged: false };
  }
  
  createACL(device, name, 'extended');
  device.runningConfig.push(`ip access-list extended ${name}`);
  return { success: true, output: '', stateChanged: true };
}

function handleNoIPAccessList(device: Device, type: string, name: string): ExecutorResult {
  deleteACL(device, name);
  device.runningConfig.push(`no ip access-list ${type} ${name}`);
  return { success: true, output: '', stateChanged: true };
}

function handleIPAccessGroup(device: Device, interfaceName: string, aclName: string, direction: string): ExecutorResult {
  if (!['in', 'out'].includes(direction)) {
    return { success: false, output: '', error: 'Direction must be "in" or "out"', stateChanged: false };
  }
  
  const result = applyACL(device, interfaceName, aclName, direction as 'in' | 'out');
  if (!result) {
    return { success: false, output: '', error: `ACL ${aclName} does not exist`, stateChanged: false };
  }
  
  device.runningConfig.push(`interface ${interfaceName}`);
  device.runningConfig.push(` ip access-group ${aclName} ${direction}`);
  
  return { success: true, output: '', stateChanged: true };
}

function handleNoIPAccessGroup(device: Device, interfaceName: string): ExecutorResult {
  removeACLApplication(device, interfaceName);
  device.runningConfig.push(`interface ${interfaceName}`);
  device.runningConfig.push(` no ip access-group`);
  return { success: true, output: '', stateChanged: true };
}

function handleNamedACLEntry(device: Device, aclName: string | null, action: 'permit' | 'deny', args: string[]): ExecutorResult {
  if (!aclName) {
    return { success: false, output: '', error: 'Not in ACL configuration mode', stateChanged: false };
  }

  const acl = device.acls.get(aclName);
  if (!acl) {
    return { success: false, output: '', error: `ACL ${aclName} does not exist`, stateChanged: false };
  }

  if (acl.type === 'standard') {
    // Standard: permit/deny <source> [<wildcard>]
    const source = args[0] || 'any';
    const wildcard = args[1] || (source === 'any' ? '255.255.255.255' : '0.0.0.0');
    addACLEntry(device, aclName, {
      action,
      source: source === 'any' ? '0.0.0.0' : source,
      sourceWildcard: source === 'any' ? '255.255.255.255' : wildcard,
    });
    device.runningConfig.push(` ${action} ${args.join(' ')}`);
  } else {
    // Extended: permit/deny <protocol> <src> <srcwild> <dst> <dstwild> [eq <port>]
    const protocol = (args[0] || 'ip') as 'ip' | 'tcp' | 'udp' | 'icmp';
    const src = args[1] || 'any';
    const srcWild = (src === 'any') ? '255.255.255.255' : (args[2] || '0.0.0.0');
    const dstIdx = (src === 'any') ? 2 : 3;
    const dst = args[dstIdx] || 'any';
    const dstWild = (dst === 'any') ? '255.255.255.255' : (args[dstIdx + 1] || '0.0.0.0');
    addACLEntry(device, aclName, {
      action,
      protocol,
      source: src === 'any' ? '0.0.0.0' : src,
      sourceWildcard: src === 'any' ? '255.255.255.255' : srcWild,
      destination: dst === 'any' ? '0.0.0.0' : dst,
      destWildcard: dst === 'any' ? '255.255.255.255' : dstWild,
    });
    device.runningConfig.push(` ${action} ${args.join(' ')}`);
  }

  return { success: true, output: '', stateChanged: true };
}

function handleNamedACLRemark(device: Device, aclName: string | null, text: string): ExecutorResult {
  if (!aclName) {
    return { success: false, output: '', error: 'Not in ACL configuration mode', stateChanged: false };
  }
  device.runningConfig.push(` remark ${text}`);
  return { success: true, output: '', stateChanged: false };
}

// ============================================================================
// NAT Command Handlers
// ============================================================================

function handleIPNatStatic(device: Device, localIP: string, globalIP: string): ExecutorResult {
  if (!isValidIP(localIP) || !isValidIP(globalIP)) {
    return { success: false, output: '', error: 'Invalid IP address', stateChanged: false };
  }
  
  configureStaticNAT(device, localIP, globalIP);
  device.runningConfig.push(`ip nat inside source static ${localIP} ${globalIP}`);
  return { success: true, output: '', stateChanged: true };
}

function handleNoIPNatStatic(device: Device, localIP: string): ExecutorResult {
  removeStaticNAT(device, localIP);
  device.runningConfig.push(`no ip nat inside source static ${localIP}`);
  return { success: true, output: '', stateChanged: true };
}

function handleIPNatPool(
  device: Device, 
  name: string, 
  startIP: string, 
  endIP: string, 
  netmask: string
): ExecutorResult {
  if (!isValidIP(startIP) || !isValidIP(endIP) || !isValidMask(netmask)) {
    return { success: false, output: '', error: 'Invalid IP address or netmask', stateChanged: false };
  }
  
  createNATPool(device, name, startIP, endIP, netmask);
  device.runningConfig.push(`ip nat pool ${name} ${startIP} ${endIP} netmask ${netmask}`);
  return { success: true, output: '', stateChanged: true };
}

function handleNoIPNatPool(device: Device, name: string): ExecutorResult {
  const result = deleteNATPool(device, name);
  if (!result) {
    return { success: false, output: '', error: `Pool ${name} is in use`, stateChanged: false };
  }
  device.runningConfig.push(`no ip nat pool ${name}`);
  return { success: true, output: '', stateChanged: true };
}

function handleIPNatDynamic(device: Device, acl: string, pool: string, overload: boolean): ExecutorResult {
  if (overload) {
    configurePATOverload(device, 'pool', pool);
    device.runningConfig.push(`ip nat inside source list ${acl} pool ${pool} overload`);
  } else {
    configurePATOverload(device, 'pool', pool);
    device.runningConfig.push(`ip nat inside source list ${acl} pool ${pool}`);
  }
  return { success: true, output: '', stateChanged: true };
}

function handleIPNatInside(device: Device, interfaceName: string): ExecutorResult {
  setNATInside(device, interfaceName);
  device.runningConfig.push(`interface ${interfaceName}`);
  device.runningConfig.push(` ip nat inside`);
  return { success: true, output: '', stateChanged: true };
}

function handleNoIPNatInside(device: Device, interfaceName: string): ExecutorResult {
  removeNATInterface(device, interfaceName);
  device.runningConfig.push(`interface ${interfaceName}`);
  device.runningConfig.push(` no ip nat inside`);
  return { success: true, output: '', stateChanged: true };
}

function handleIPNatOutside(device: Device, interfaceName: string): ExecutorResult {
  setNATOutside(device, interfaceName);
  device.runningConfig.push(`interface ${interfaceName}`);
  device.runningConfig.push(` ip nat outside`);
  return { success: true, output: '', stateChanged: true };
}

function handleNoIPNatOutside(device: Device, interfaceName: string): ExecutorResult {
  removeNATInterface(device, interfaceName);
  device.runningConfig.push(`interface ${interfaceName}`);
  device.runningConfig.push(` no ip nat outside`);
  return { success: true, output: '', stateChanged: true };
}

// ============================================================================
// STP Command Handlers
// ============================================================================

function handleShowSTP(device: Device, vlanId?: number): ExecutorResult {
  return { success: true, output: showSTP(device, vlanId), stateChanged: false };
}

function handleShowSTPVLAN(device: Device, vlanId: number): ExecutorResult {
  return { success: true, output: showSTP(device, vlanId), stateChanged: false };
}

function handleShowSTPSummary(device: Device): ExecutorResult {
  if (device.type !== 'switch') {
    return { success: false, output: '', error: 'STP is only available on switches', stateChanged: false };
  }
  
  let output = 'Switch is in ' + (device.stpConfig.enabled ? 'STP' : 'disabled') + ' mode\n';
  output += 'STP instances: ' + device.stpConfig.vlanInstances.size + '\n';
  
  for (const [vlanId, stpVlan] of device.stpConfig.vlanInstances) {
    output += `  VLAN${vlanId}: Root = ${stpVlan.rootBridge === stpVlan.bridgeID ? 'this switch' : stpVlan.rootBridge}\n`;
  }
  
  return { success: true, output, stateChanged: false };
}

function handleSTPVLANPriority(device: Device, vlan: number, priority: number): ExecutorResult {
  if (device.type !== 'switch') {
    return { success: false, output: '', error: 'STP is only available on switches', stateChanged: false };
  }
  
  // Initialize STP for this VLAN if not exists
  if (!device.stpConfig.vlanInstances.has(vlan)) {
    initializeSTP(device, vlan);
  }
  
  setBridgePriority(device, vlan, priority);
  device.runningConfig.push(`spanning-tree vlan ${vlan} priority ${priority}`);
  return { success: true, output: '', stateChanged: true };
}

function handleSTPPortFast(device: Device, interfaceName: string, edge: boolean): ExecutorResult {
  if (device.type !== 'switch') {
    return { success: false, output: '', error: 'STP is only available on switches', stateChanged: false };
  }
  
  // Initialize STP for VLAN 1 if not exists
  if (!device.stpConfig.vlanInstances.has(1)) {
    initializeSTP(device, 1);
  }
  
  setPortFast(device, 1, interfaceName, true);
  device.runningConfig.push(`interface ${interfaceName}`);
  device.runningConfig.push(` spanning-tree portfast` + (edge ? ' edge' : ''));
  return { success: true, output: '', stateChanged: true };
}

function handleNoSTPPortFast(device: Device, interfaceName: string): ExecutorResult {
  if (device.type !== 'switch') {
    return { success: false, output: '', error: 'STP is only available on switches', stateChanged: false };
  }
  
  setPortFast(device, 1, interfaceName, false);
  device.runningConfig.push(`interface ${interfaceName}`);
  device.runningConfig.push(` no spanning-tree portfast`);
  return { success: true, output: '', stateChanged: true };
}

function handleSTPBPDUGuard(device: Device, interfaceName: string, enabled: boolean): ExecutorResult {
  if (device.type !== 'switch') {
    return { success: false, output: '', error: 'STP is only available on switches', stateChanged: false };
  }
  
  // Initialize STP for VLAN 1 if not exists
  if (!device.stpConfig.vlanInstances.has(1)) {
    initializeSTP(device, 1);
  }
  
  setBPDUGuard(device, 1, interfaceName, enabled);
  device.runningConfig.push(`interface ${interfaceName}`);
  device.runningConfig.push(enabled ? ` spanning-tree bpduguard enable` : ` no spanning-tree bpduguard`);
  return { success: true, output: '', stateChanged: true };
}

function handleSTPCost(device: Device, interfaceName: string, cost: number): ExecutorResult {
  if (device.type !== 'switch') {
    return { success: false, output: '', error: 'STP is only available on switches', stateChanged: false };
  }
  
  // Initialize STP for VLAN 1 if not exists
  if (!device.stpConfig.vlanInstances.has(1)) {
    initializeSTP(device, 1);
  }
  
  setPortCost(device, 1, interfaceName, cost);
  device.runningConfig.push(`interface ${interfaceName}`);
  device.runningConfig.push(` spanning-tree cost ${cost}`);
  return { success: true, output: '', stateChanged: true };
}

// ============================================================================
// DHCP Command Handlers
// ============================================================================

function handleShowDHCPPool(device: Device): ExecutorResult {
  return { success: true, output: showDHCPPools(device), stateChanged: false };
}

function handleShowDHCPBinding(device: Device): ExecutorResult {
  return { success: true, output: showDHCPBindings(device), stateChanged: false };
}

function handleShowDHCPStatistics(device: Device): ExecutorResult {
  return { success: true, output: showDHCPStatistics(device), stateChanged: false };
}

function handleIPDHCPPool(device: Device, poolName: string): ExecutorResult {
  createDHCPPool(device, poolName, '0.0.0.0', '255.255.255.0'); // Placeholder, will be configured with network command
  device.runningConfig.push(`ip dhcp pool ${poolName}`);
  return { success: true, output: '', stateChanged: true };
}

function handleNoIPDHCPPool(device: Device, poolName: string): ExecutorResult {
  deleteDHCPPool(device, poolName);
  device.runningConfig.push(`no ip dhcp pool ${poolName}`);
  return { success: true, output: '', stateChanged: true };
}

function handleDHCPNetwork(device: Device, poolName: string, network: string, mask: string): ExecutorResult {
  const pool = device.dhcpConfig.pools.get(poolName);
  if (!pool) {
    return { success: false, output: '', error: `DHCP pool ${poolName} not found`, stateChanged: false };
  }
  
  // Update pool network
  pool.network = network;
  pool.mask = mask;
  
  device.runningConfig.push(` network ${network} ${mask}`);
  return { success: true, output: '', stateChanged: true };
}

function handleDHCPDefaultRouter(device: Device, poolName: string, routers: string[]): ExecutorResult {
  const pool = device.dhcpConfig.pools.get(poolName);
  if (!pool) {
    return { success: false, output: '', error: `DHCP pool ${poolName} not found`, stateChanged: false };
  }
  
  configurePoolOptions(device, poolName, { defaultRouter: routers });
  device.runningConfig.push(` default-router ${routers.join(' ')}`);
  return { success: true, output: '', stateChanged: true };
}

function handleDHCPDNSServer(device: Device, poolName: string, servers: string[]): ExecutorResult {
  const pool = device.dhcpConfig.pools.get(poolName);
  if (!pool) {
    return { success: false, output: '', error: `DHCP pool ${poolName} not found`, stateChanged: false };
  }
  
  configurePoolOptions(device, poolName, { dnsServer: servers });
  device.runningConfig.push(` dns-server ${servers.join(' ')}`);
  return { success: true, output: '', stateChanged: true };
}

function handleDHCPDomainName(device: Device, poolName: string, name: string): ExecutorResult {
  const pool = device.dhcpConfig.pools.get(poolName);
  if (!pool) {
    return { success: false, output: '', error: `DHCP pool ${poolName} not found`, stateChanged: false };
  }
  
  configurePoolOptions(device, poolName, { domainName: name });
  device.runningConfig.push(` domain-name ${name}`);
  return { success: true, output: '', stateChanged: true };
}

function handleDHCPLease(device: Device, poolName: string, days: number, hours: number, minutes: number): ExecutorResult {
  const pool = device.dhcpConfig.pools.get(poolName);
  if (!pool) {
    return { success: false, output: '', error: `DHCP pool ${poolName} not found`, stateChanged: false };
  }
  
  const leaseTime = (days * 86400) + (hours * 3600) + (minutes * 60);
  configurePoolOptions(device, poolName, { leaseTime });
  device.runningConfig.push(` lease ${days} ${hours} ${minutes}`);
  return { success: true, output: '', stateChanged: true };
}

function handleIPDHCPExcluded(device: Device, lowIP: string, highIP: string): ExecutorResult {
  // Add to all pools or track globally
  for (const pool of device.dhcpConfig.pools.values()) {
    // Check if the excluded range is in this pool's network
    addExcludedIP(device, pool.name, lowIP);
    if (highIP !== lowIP) {
      addExcludedIP(device, pool.name, highIP);
    }
  }
  
  if (lowIP === highIP) {
    device.runningConfig.push(`ip dhcp excluded-address ${lowIP}`);
  } else {
    device.runningConfig.push(`ip dhcp excluded-address ${lowIP} ${highIP}`);
  }
  return { success: true, output: '', stateChanged: true };
}

function handleNoIPDHCPExcluded(device: Device, lowIP: string, highIP: string): ExecutorResult {
  for (const pool of device.dhcpConfig.pools.values()) {
    removeExcludedIP(device, pool.name, lowIP);
    if (highIP !== lowIP) {
      removeExcludedIP(device, pool.name, highIP);
    }
  }
  
  if (lowIP === highIP) {
    device.runningConfig.push(`no ip dhcp excluded-address ${lowIP}`);
  } else {
    device.runningConfig.push(`no ip dhcp excluded-address ${lowIP} ${highIP}`);
  }
  return { success: true, output: '', stateChanged: true };
}

function handleIPHelperAddress(device: Device, interfaceName: string, serverIP: string): ExecutorResult {
  configureDHCPRelay(device, interfaceName, serverIP);
  device.runningConfig.push(`interface ${interfaceName}`);
  device.runningConfig.push(` ip helper-address ${serverIP}`);
  return { success: true, output: '', stateChanged: true };
}

function handleNoIPHelperAddress(device: Device, interfaceName: string): ExecutorResult {
  removeDHCPRelay(device, interfaceName);
  device.runningConfig.push(`interface ${interfaceName}`);
  device.runningConfig.push(` no ip helper-address`);
  return { success: true, output: '', stateChanged: true };
}

// ============================================================================
// IPv6 Handlers
// ============================================================================

function handleIPv6Address(
  device: Device,
  interfaceName: string,
  address: string,
  prefixLength: number,
  eui64: boolean
): ExecutorResult {
  const iface = device.interfaces.find(i => i.name === interfaceName);
  if (!iface) {
    return { success: false, output: '', error: 'Interface not found', stateChanged: false };
  }
  
  // Validate IPv6 address format
  if (!validateIPv6(address)) {
    return { success: false, output: '', error: 'Invalid IPv6 address format', stateChanged: false };
  }
  
  // Validate prefix length
  if (prefixLength < 0 || prefixLength > 128) {
    return { success: false, output: '', error: 'Invalid prefix length (must be 0-128)', stateChanged: false };
  }
  
  iface.ipv6 = address;
  iface.ipv6PrefixLength = prefixLength;
  
  // Generate link-local if not exists
  if (!iface.ipv6LinkLocal) {
    const macBytes = iface.mac.split(':').map(b => parseInt(b, 16));
    // EUI-64 link local address
    const linkLocalBytes = [0xFE, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
    // Modified EUI-64
    linkLocalBytes.push(macBytes[0] ^ 0x02);
    linkLocalBytes.push(macBytes[1]);
    linkLocalBytes.push(macBytes[2]);
    linkLocalBytes.push(0xFF);
    linkLocalBytes.push(0xFE);
    linkLocalBytes.push(macBytes[3]);
    linkLocalBytes.push(macBytes[4]);
    linkLocalBytes.push(macBytes[5]);
    
    iface.ipv6LinkLocal = formatEUI64LinkLocal(linkLocalBytes);
  }
  
  device.runningConfig.push(`interface ${interfaceName}`);
  device.runningConfig.push(` ipv6 address ${address}/${prefixLength}${eui64 ? ' eui-64' : ''}`);
  return { success: true, output: '', stateChanged: true };
}

function handleNoIPv6Address(device: Device, interfaceName: string): ExecutorResult {
  const iface = device.interfaces.find(i => i.name === interfaceName);
  if (!iface) {
    return { success: false, output: '', error: 'Interface not found', stateChanged: false };
  }
  
  iface.ipv6 = null;
  iface.ipv6LinkLocal = null;
  
  device.runningConfig.push(`interface ${interfaceName}`);
  device.runningConfig.push(` no ipv6 address`);
  return { success: true, output: '', stateChanged: true };
}

function handleIPv6Enable(device: Device, interfaceName: string, enabled: boolean): ExecutorResult {
  const iface = device.interfaces.find(i => i.name === interfaceName);
  if (!iface) {
    return { success: false, output: '', error: 'Interface not found', stateChanged: false };
  }
  
  if (enabled && !iface.ipv6LinkLocal) {
    // Generate link-local address
    const macBytes = iface.mac.split(':').map(b => parseInt(b, 16));
    const linkLocalBytes = [0xFE, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
    linkLocalBytes.push(macBytes[0] ^ 0x02);
    linkLocalBytes.push(macBytes[1]);
    linkLocalBytes.push(macBytes[2]);
    linkLocalBytes.push(0xFF);
    linkLocalBytes.push(0xFE);
    linkLocalBytes.push(macBytes[3]);
    linkLocalBytes.push(macBytes[4]);
    linkLocalBytes.push(macBytes[5]);
    
    iface.ipv6LinkLocal = formatEUI64LinkLocal(linkLocalBytes);
  }
  
  device.runningConfig.push(`interface ${interfaceName}`);
  device.runningConfig.push(enabled ? ` ipv6 enable` : ` no ipv6 enable`);
  return { success: true, output: '', stateChanged: true };
}

function handleShowIPv6InterfaceBrief(device: Device): ExecutorResult {
  let output = 'Interface              Status      Protocol\n';
  output += `${'Interface'.padEnd(22)}${'IP-Address'.padEnd(18)}${'Status'.padEnd(12)}${'Protocol'.padEnd(10)}\n`;
  
  for (const iface of device.interfaces) {
    if (iface.isSubinterface) continue;
    const status = iface.isShutdown ? 'administratively down' : (iface.connectedTo ? 'up' : 'down');
    const protocol = iface.isShutdown ? 'down' : (iface.connectedTo ? 'up' : 'down');
    const ipv6 = iface.ipv6 || iface.ipv6LinkLocal || 'unassigned';
    output += `${iface.name.padEnd(22)}${ipv6.padEnd(18)}${status.padEnd(12)}${protocol}\n`;
  }
  
  return { success: true, output, stateChanged: false };
}

function handleShowIPv6Interface(device: Device, interfaceName?: string): ExecutorResult {
  if (interfaceName) {
    const iface = device.interfaces.find(i => i.name === interfaceName);
    if (!iface) {
      return { success: false, output: '', error: 'Interface not found', stateChanged: false };
    }
    
    let output = `${iface.name} is ${iface.isShutdown ? 'administratively down' : (iface.connectedTo ? 'up' : 'down')}, line protocol is ${iface.isShutdown ? 'down' : (iface.connectedTo ? 'up' : 'down')}\n`;
    output += `  Hardware is ${device.type === 'router' ? 'Gt96k FE' : 'FastEthernet'}, address is ${iface.mac}\n`;
    if (iface.description) {
      output += `  Description: ${iface.description}\n`;
    }
    if (iface.ipv6) {
      output += `  IPv6 address: ${iface.ipv6}/${iface.ipv6PrefixLength}\n`;
    }
    if (iface.ipv6LinkLocal) {
      output += `  IPv6 link-local address: ${iface.ipv6LinkLocal}\n`;
    }
    
    return { success: true, output, stateChanged: false };
  }
  
  // Show all interfaces
  let output = '';
  for (const iface of device.interfaces) {
    if (iface.isSubinterface) continue;
    if (iface.ipv6 || iface.ipv6LinkLocal) {
      output += `${iface.name}:\n`;
      if (iface.ipv6) {
        output += `  IPv6 address: ${iface.ipv6}/${iface.ipv6PrefixLength}\n`;
      }
      if (iface.ipv6LinkLocal) {
        output += `  IPv6 link-local address: ${iface.ipv6LinkLocal}\n`;
      }
      output += '\n';
    }
  }
  
  return { success: true, output: output || '% No interfaces have IPv6 configured\n', stateChanged: false };
}

function handleShowIPv6Route(device: Device): ExecutorResult {
  // Filter IPv6 routes
  const ipv6Routes = device.routingTable.filter(r => r.isIPv6);
  
  if (ipv6Routes.length === 0) {
    return { success: true, output: 'IPv6 Routing Table is empty\n', stateChanged: false };
  }
  
  let output = `IPv6 Routing Table - default - ${ipv6Routes.length} entries\n`;
  output += 'Codes: C - Connected, L - Local, S - Static, O - OSPF\n\n';
  
  for (const route of ipv6Routes) {
    const via = route.nextHop ? `via ${route.nextHop}` : 'is directly connected';
    output += `${route.protocol}   ${route.network}/${route.mask} [${route.metric}/0]\n`;
    output += `     ${via}${route.interface ? `, ${route.interface}` : ''}\n`;
  }
  
  return { success: true, output, stateChanged: false };
}

function handleIPv6Route(
  device: Device,
  network: string,
  nextHop: string | null,
  iface: string | null
): ExecutorResult {
  const route: Route = {
    network,
    mask: '64', // Simplified, should parse from network
    nextHop,
    interface: iface,
    protocol: 'S',
    metric: 1,
    isLocal: false,
    isIPv6: true,
  };
  
  device.routingTable.push(route);
  device.runningConfig.push(`ipv6 route ${network} ${nextHop || iface}`);
  return { success: true, output: '', stateChanged: true };
}

function handleNoIPv6Route(
  device: Device,
  network: string,
  nextHop: string | null,
  iface: string | null
): ExecutorResult {
  const index = device.routingTable.findIndex(
    r => r.isIPv6 && r.network === network && r.nextHop === nextHop && r.interface === iface
  );
  
  if (index >= 0) {
    device.routingTable.splice(index, 1);
  }
  
  device.runningConfig.push(`no ipv6 route ${network} ${nextHop || iface}`);
  return { success: true, output: '', stateChanged: true };
}

// ============================================================================
// Port Security Handlers
// ============================================================================

function handlePortSecurity(device: Device, interfaceName: string, enabled: boolean): ExecutorResult {
  if (device.type !== 'switch') {
    return { success: false, output: '', error: 'Port Security is only available on switches', stateChanged: false };
  }
  
  const iface = device.interfaces.find(i => i.name === interfaceName);
  if (!iface) {
    return { success: false, output: '', error: 'Interface not found', stateChanged: false };
  }
  
  if (iface.switchportMode !== 'access') {
    return { success: false, output: '', error: 'Port Security requires access port mode', stateChanged: false };
  }
  
  iface.portSecurity.enabled = enabled;
  
  device.runningConfig.push(`interface ${interfaceName}`);
  device.runningConfig.push(enabled ? ` switchport port-security` : ` no switchport port-security`);
  return { success: true, output: '', stateChanged: true };
}

function handlePortSecurityMaximum(device: Device, interfaceName: string, max: number): ExecutorResult {
  const iface = device.interfaces.find(i => i.name === interfaceName);
  if (!iface) {
    return { success: false, output: '', error: 'Interface not found', stateChanged: false };
  }
  
  if (max < 1 || max > 132) {
    return { success: false, output: '', error: 'Maximum MAC addresses must be between 1 and 132', stateChanged: false };
  }
  
  iface.portSecurity.maxMacAddresses = max;
  device.runningConfig.push(`interface ${interfaceName}`);
  device.runningConfig.push(` switchport port-security maximum ${max}`);
  return { success: true, output: '', stateChanged: true };
}

function handlePortSecurityViolation(device: Device, interfaceName: string, mode: string): ExecutorResult {
  const iface = device.interfaces.find(i => i.name === interfaceName);
  if (!iface) {
    return { success: false, output: '', error: 'Interface not found', stateChanged: false };
  }
  
  if (!['protect', 'restrict', 'shutdown'].includes(mode)) {
    return { success: false, output: '', error: 'Violation mode must be protect, restrict, or shutdown', stateChanged: false };
  }
  
  iface.portSecurity.violationMode = mode as 'protect' | 'restrict' | 'shutdown';
  device.runningConfig.push(`interface ${interfaceName}`);
  device.runningConfig.push(` switchport port-security violation ${mode}`);
  return { success: true, output: '', stateChanged: true };
}

function handlePortSecurityMac(device: Device, interfaceName: string, mac: string, vlan?: number): ExecutorResult {
  const iface = device.interfaces.find(i => i.name === interfaceName);
  if (!iface) {
    return { success: false, output: '', error: 'Interface not found', stateChanged: false };
  }
  
  // Validate MAC format
  const macRegex = /^([0-9A-Fa-f]{4}\.){2}[0-9A-Fa-f]{4}$/;
  const macColonRegex = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;
  if (!macRegex.test(mac) && !macColonRegex.test(mac)) {
    return { success: false, output: '', error: 'Invalid MAC address format', stateChanged: false };
  }
  
  // Normalize MAC
  const normalizedMac = mac.toLowerCase().replace(/[.:-]/g, '');
  const formattedMac = `${normalizedMac.slice(0, 4)}.${normalizedMac.slice(4, 8)}.${normalizedMac.slice(8, 12)}`;
  
  if (iface.portSecurity.secureMacAddresses.length >= iface.portSecurity.maxMacAddresses) {
    return { success: false, output: '', error: 'Maximum secure MAC addresses reached', stateChanged: false };
  }
  
  iface.portSecurity.secureMacAddresses.push({
    mac: formattedMac,
    vlan: vlan || iface.accessVlan || 1,
    type: 'static',
    learnedAt: Date.now(),
    lastSeen: Date.now(),
  });
  
  device.runningConfig.push(`interface ${interfaceName}`);
  device.runningConfig.push(` switchport port-security mac-address ${formattedMac}`);
  return { success: true, output: '', stateChanged: true };
}

function handleNoPortSecurityMac(device: Device, interfaceName: string, mac: string, vlan?: number): ExecutorResult {
  const iface = device.interfaces.find(i => i.name === interfaceName);
  if (!iface) {
    return { success: false, output: '', error: 'Interface not found', stateChanged: false };
  }
  
  const normalizedMac = mac.toLowerCase().replace(/[.:-]/g, '');
  const formattedMac = `${normalizedMac.slice(0, 4)}.${normalizedMac.slice(4, 8)}.${normalizedMac.slice(8, 12)}`;
  
  const index = iface.portSecurity.secureMacAddresses.findIndex(m => m.mac === formattedMac);
  if (index >= 0) {
    iface.portSecurity.secureMacAddresses.splice(index, 1);
  }
  
  device.runningConfig.push(`interface ${interfaceName}`);
  device.runningConfig.push(` no switchport port-security mac-address ${formattedMac}`);
  return { success: true, output: '', stateChanged: true };
}

function handlePortSecuritySticky(device: Device, interfaceName: string, enabled: boolean): ExecutorResult {
  const iface = device.interfaces.find(i => i.name === interfaceName);
  if (!iface) {
    return { success: false, output: '', error: 'Interface not found', stateChanged: false };
  }
  
  iface.portSecurity.stickyMacEnabled = enabled;
  device.runningConfig.push(`interface ${interfaceName}`);
  device.runningConfig.push(enabled ? ` switchport port-security mac-address sticky` : ` no switchport port-security mac-address sticky`);
  return { success: true, output: '', stateChanged: true };
}

function handleShowPortSecurity(device: Device, interfaceName?: string): ExecutorResult {
  if (device.type !== 'switch') {
    return { success: false, output: '', error: 'Port Security is only available on switches', stateChanged: false };
  }
  
  let output = 'Secure Port  MaxSecureAddr  CurrentAddr  SecurityViolation  Security Action\n';
  output += '                (Count)       (Count)          (Count)\n';
  output += '--------------------------------------------------------------------\n';
  
  const interfaces = interfaceName 
    ? device.interfaces.filter(i => i.name === interfaceName)
    : device.interfaces.filter(i => i.portSecurity?.enabled);
  
  for (const iface of interfaces) {
    if (!iface.portSecurity?.enabled) continue;
    
    const secureCount = iface.portSecurity.secureMacAddresses.length;
    const action = iface.portSecurity.violationMode;
    output += `${iface.name.padEnd(13)} ${iface.portSecurity.maxMacAddresses.toString().padStart(8)} ${secureCount.toString().padStart(12)} ${iface.portSecurity.violationCount.toString().padStart(14)} ${action.padStart(15)}\n`;
  }
  
  output += '----------------------------------------------------------------------\n';
  output += `Total Addresses in System (excluding one mac per port)     : 0\n`;
  output += `Max Addresses limit in System (excluding one mac per port) : 4096\n`;
  
  return { success: true, output, stateChanged: false };
}

function handleShowPortSecurityInterface(device: Device, interfaceName: string): ExecutorResult {
  const iface = device.interfaces.find(i => i.name === interfaceName);
  if (!iface) {
    return { success: false, output: '', error: 'Interface not found', stateChanged: false };
  }
  
  const ps = iface.portSecurity;
  let output = `Port Security              : ${ps.enabled ? 'Enabled' : 'Disabled'}\n`;
  output += `Port Status                : ${ps.errDisabled ? 'Secure-shutdown' : iface.status}\n`;
  output += `Violation Mode             : ${ps.violationMode}\n`;
  output += `Maximum MAC Addresses      : ${ps.maxMacAddresses}\n`;
  output += `Total MAC Addresses        : ${ps.secureMacAddresses.length}\n`;
  output += `Configured MAC Addresses   : ${ps.secureMacAddresses.filter(m => m.type === 'static').length}\n`;
  output += `Sticky MAC Addresses       : ${ps.secureMacAddresses.filter(m => m.type === 'sticky').length}\n`;
  output += `Last Source Address:Vlan   : ${ps.lastViolationMac || '0000.0000.0000'}:${iface.accessVlan || 1}\n`;
  output += `Security Violation Count   : ${ps.violationCount}\n`;
  
  return { success: true, output, stateChanged: false };
}

function handleShowPortSecurityAddress(device: Device): ExecutorResult {
  let output = 'Secure Mac Address Table\n';
  output += '------------------------------------------------------------------------\n';
  output += `Vlan    Mac Address       Type                          Ports\n`;
  output += '------------------------------------------------------------------------\n';
  
  let hasEntries = false;
  for (const iface of device.interfaces) {
    if (!iface.portSecurity?.enabled) continue;
    
    for (const entry of iface.portSecurity.secureMacAddresses) {
      hasEntries = true;
      output += `${(entry.vlan || 1).toString().padStart(4)}    ${entry.mac.padEnd(18)}${entry.type.padStart(10)}                    ${iface.name}\n`;
    }
  }
  
  output += '------------------------------------------------------------------------\n';
  
  if (!hasEntries) {
    return { success: true, output: '% No secure MAC addresses found\n', stateChanged: false };
  }
  
  return { success: true, output, stateChanged: false };
}

// ============================================================================
// Main Executor
// ============================================================================

export function executeCommand(
  action: CLIAction,
  topology: Topology,
  device: Device,
  currentInterface: string | null,
  queue: EventQueue,
  state?: CLIParserState
): ExecutorResult {
  switch (action.type) {
    case 'SHOW_VERSION':
      return { success: true, output: showVersion(device), stateChanged: false };
      
    case 'SHOW_RUNNING_CONFIG':
      return { success: true, output: showRunningConfig(device), stateChanged: false };
      
    case 'SHOW_STARTUP_CONFIG':
      return { success: true, output: showStartupConfig(device), stateChanged: false };
      
    case 'SHOW_IP_INTERFACE_BRIEF':
      return { success: true, output: showIPInterfaceBrief(device), stateChanged: false };

    case 'SHOW_IP_INTERFACE':
      return { success: true, output: showIPInterface(device, action.params.interface), stateChanged: false };
      
    case 'SHOW_INTERFACES':
      return { success: true, output: showInterfaces(device, action.params.interface), stateChanged: false };
      
    case 'SHOW_IP_ROUTE':
      return { success: true, output: showIPRoute(device), stateChanged: false };
      
    case 'SHOW_ARP':
      return { success: true, output: showARP(device), stateChanged: false };
      
    case 'SHOW_MAC_TABLE':
      return { success: true, output: showMACTable(device), stateChanged: false };

    case 'SHOW_VLAN':
    case 'SHOW_VLAN_BRIEF':
      return { success: true, output: showVlan(device), stateChanged: false };

    case 'SHOW_INTERFACES_TRUNK':
      return { success: true, output: showInterfacesTrunk(device), stateChanged: false };

    case 'SHOW_CDP_NEIGHBORS':
      return { success: true, output: showCDPNeighbors(topology, device), stateChanged: false };

    case 'VLAN_CREATE':
      return createVlan(device, action.params.id);

    case 'VLAN_DELETE':
      return deleteVlan(device, action.params.id);

    case 'SWITCHPORT_MODE':
      if (!currentInterface) {
        return { success: false, output: '', error: 'Not in interface configuration mode', stateChanged: false };
      }
      return setSwitchportMode(device, currentInterface, action.params.mode);

    case 'SWITCHPORT_ACCESS_VLAN':
      if (!currentInterface) {
        return { success: false, output: '', error: 'Not in interface configuration mode', stateChanged: false };
      }
      return setSwitchportAccessVlan(device, currentInterface, action.params.vlan);

    case 'SWITCHPORT_TRUNK_ALLOWED':
      if (!currentInterface) {
        return { success: false, output: '', error: 'Not in interface configuration mode', stateChanged: false };
      }
      return setSwitchportTrunkAllowed(device, currentInterface, action.params.vlans);

    case 'SWITCHPORT_TRUNK_NATIVE':
      if (!currentInterface) {
        return { success: false, output: '', error: 'Not in interface configuration mode', stateChanged: false };
      }
      return setSwitchportTrunkNative(device, currentInterface, action.params.vlan);

    case 'ENCAPSULATION_DOT1Q':
      if (!currentInterface) {
        return { success: false, output: '', error: 'Not in interface configuration mode', stateChanged: false };
      }
      return setEncapsulationDot1Q(device, currentInterface, action.params.vlan);

    case 'IP_ROUTING':
      return enableIPRouting(device);

    case 'NO_IP_ROUTING':
      return disableIPRouting(device);

    case 'INTERFACE':
      return handleInterfaceEntry(device, action.params.interface);

    case 'ENABLE_SECRET':
      device.enableSecret = action.params.password;
      device.runningConfig.push(`enable secret 5 ${action.params.password}`);
      return { success: true, output: '', stateChanged: true };

    case 'ENABLE_PASSWORD':
      device.enablePassword = action.params.password;
      device.runningConfig.push(`enable password ${action.params.password}`);
      return { success: true, output: '', stateChanged: true };

    case 'NO_ENABLE_SECRET':
      device.enableSecret = undefined;
      device.runningConfig.push('no enable secret');
      return { success: true, output: '', stateChanged: true };

    case 'NO_ENABLE_PASSWORD':
      device.enablePassword = undefined;
      device.runningConfig.push('no enable password');
      return { success: true, output: '', stateChanged: true };

    case 'BANNER_MOTD': {
      // Sanitize and limit banner length for security
      const sanitized = sanitizeInput(action.params.text);
      const truncated = truncate(sanitized, LIMITS.BANNER_MAX_LEN);
      device.bannerMotd = truncated;
      device.runningConfig.push(`banner motd ^C${truncated}^C`);
      return { success: true, output: '', stateChanged: true };
    }

    case 'NO_BANNER_MOTD':
      device.bannerMotd = undefined;
      device.runningConfig.push('no banner motd');
      return { success: true, output: '', stateChanged: true };

    case 'HOSTNAME':
      return setHostname(device, action.params.name);
      
    case 'IP_ADDRESS':
      if (!currentInterface) {
        return { success: false, output: '', error: 'Not in interface configuration mode', stateChanged: false };
      }
      return setIPAddress(device, currentInterface, action.params.ip, action.params.mask);
      
    case 'NO_IP_ADDRESS':
      if (!currentInterface) {
        return { success: false, output: '', error: 'Not in interface configuration mode', stateChanged: false };
      }
      return removeIPAddress(device, currentInterface);
      
    case 'SHUTDOWN':
      if (!currentInterface) {
        return { success: false, output: '', error: 'Not in interface configuration mode', stateChanged: false };
      }
      return setShutdown(device, currentInterface, true);
      
    case 'NO_SHUTDOWN':
      if (!currentInterface) {
        return { success: false, output: '', error: 'Not in interface configuration mode', stateChanged: false };
      }
      return setShutdown(device, currentInterface, false);
      
    case 'DESCRIPTION':
      if (!currentInterface) {
        return { success: false, output: '', error: 'Not in interface configuration mode', stateChanged: false };
      }
      return setDescription(device, currentInterface, action.params.text);
      
    case 'NO_DESCRIPTION':
      if (!currentInterface) {
        return { success: false, output: '', error: 'Not in interface configuration mode', stateChanged: false };
      }
      return removeDescription(device, currentInterface);
      
    case 'IP_ROUTE':
      return handleIPRoute(device, action.params.network, action.params.mask, action.params.nextHop, false);
      
    case 'NO_IP_ROUTE':
      return handleIPRoute(device, action.params.network, action.params.mask, action.params.nextHop, true);
      
    case 'WRITE_MEMORY':
    case 'COPY_RUN_START':
      return writeMemory(device);
      
    case 'ERASE_STARTUP':
      return eraseStartup(device);
      
    case 'RELOAD':
      return reload(device);
      
    case 'CLEAR_MAC_TABLE':
      device.macTable.clear();
      return { success: true, output: '', stateChanged: true };

    case 'CLEAR_ARP_CACHE':
      device.arpTable.clear();
      return { success: true, output: '', stateChanged: true };

    case 'PING':
      return executePing(topology, device, action.params.target, queue);
    
    // OSPF show commands
    case 'SHOW_IP_OSPF':
      return { success: true, output: getOSPFProcessInfo(device), stateChanged: false };
    
    case 'SHOW_IP_OSPF_NEIGHBOR':
      return { success: true, output: getOSPFNeighborTable(device), stateChanged: false };
    
    case 'SHOW_IP_OSPF_INTERFACE':
      return { success: true, output: getOSPFInterfaceInfo(device, action.params.interface), stateChanged: false };
    
    case 'SHOW_IP_OSPF_DATABASE':
      return { success: true, output: getOSPFDatabase(device), stateChanged: false };
    
    case 'SHOW_IP_ROUTE_OSPF':
      return { success: true, output: getOSPFRoutes(device), stateChanged: false };
    
    // OSPF router configuration
    case 'ROUTER_OSPF':
      return handleRouterOSPF(device, action.params.processId);
    
    case 'NO_ROUTER_OSPF':
      return handleNoRouterOSPF(device);
    
    case 'OSPF_NETWORK':
      return handleOSPFNetwork(device, action.params.network, action.params.wildcard, action.params.area);
    
    case 'NO_OSPF_NETWORK':
      return handleNoOSPFNetwork(device, action.params.network, action.params.wildcard);
    
    case 'OSPF_ROUTER_ID':
      return handleOSPFRouterId(device, action.params.routerId);
    
    case 'OSPF_PASSIVE_INTERFACE':
      return handleOSPFPassiveInterface(device, action.params.interface, true);
    
    case 'NO_OSPF_PASSIVE_INTERFACE':
      return handleOSPFPassiveInterface(device, action.params.interface, false);
    
    case 'OSPF_DEFAULT_ORIGINATE':
      return handleOSPFDefaultOriginate(device, true);
    
    case 'NO_OSPF_DEFAULT_ORIGINATE':
      return handleOSPFDefaultOriginate(device, false);
    
    // OSPF interface configuration
    case 'IP_OSPF_COST':
      if (!currentInterface) {
        return { success: false, output: '', error: 'Not in interface configuration mode', stateChanged: false };
      }
      return handleIPOSPFCost(device, currentInterface, action.params.cost);
    
    case 'IP_OSPF_PRIORITY':
      if (!currentInterface) {
        return { success: false, output: '', error: 'Not in interface configuration mode', stateChanged: false };
      }
      return handleIPOSPFPriority(device, currentInterface, action.params.priority);
    
    case 'IP_OSPF_HELLO_INTERVAL':
      if (!currentInterface) {
        return { success: false, output: '', error: 'Not in interface configuration mode', stateChanged: false };
      }
      return handleIPOSPFHelloInterval(device, currentInterface, action.params.interval);
    
    case 'IP_OSPF_DEAD_INTERVAL':
      if (!currentInterface) {
        return { success: false, output: '', error: 'Not in interface configuration mode', stateChanged: false };
      }
      return handleIPOSPFDeadInterval(device, currentInterface, action.params.interval);
    
    // ACL show commands
    case 'SHOW_ACCESS_LISTS':
      return { success: true, output: showACL(device, action.params.name), stateChanged: false };
    
    case 'SHOW_IP_ACCESS_LISTS':
      return { success: true, output: showACL(device, action.params.name), stateChanged: false };
    
    // ACL configuration
    case 'ACCESS_LIST':
      return handleAccessList(device, action.params.number, action.params.action, action.params.remainder);
    
    case 'NO_ACCESS_LIST':
      return handleNoAccessList(device, action.params.number);
    
    case 'IP_ACCESS_LIST_STANDARD':
      return handleIPAccessListStandard(device, action.params.name);
    
    case 'IP_ACCESS_LIST_EXTENDED':
      return handleIPAccessListExtended(device, action.params.name);
    
    case 'NO_IP_ACCESS_LIST':
      return handleNoIPAccessList(device, action.params.type, action.params.name);

    case 'ACL_PERMIT':
    case 'ACL_DENY': {
      const aclAction = action.type === 'ACL_PERMIT' ? 'permit' : 'deny';
      const aclName = state?.configTarget || null;
      return handleNamedACLEntry(device, aclName, aclAction, action.params.args);
    }

    case 'ACL_REMARK':
      return handleNamedACLRemark(device, state?.configTarget || null, action.params.text);

    case 'EXIT_ACL':
      return { success: true, output: '', stateChanged: false };
    
    // ACL application
    case 'IP_ACCESS_GROUP':
      if (!currentInterface) {
        return { success: false, output: '', error: 'Not in interface configuration mode', stateChanged: false };
      }
      return handleIPAccessGroup(device, currentInterface, action.params.acl, action.params.direction);
    
    case 'NO_IP_ACCESS_GROUP':
      if (!currentInterface) {
        return { success: false, output: '', error: 'Not in interface configuration mode', stateChanged: false };
      }
      return handleNoIPAccessGroup(device, currentInterface);
    
    // NAT show commands
    case 'SHOW_IP_NAT_TRANSLATIONS':
      return { success: true, output: showNATTranslations(device), stateChanged: false };
    
    case 'SHOW_IP_NAT_STATISTICS':
      return { success: true, output: showNATStatistics(device), stateChanged: false };
    
    // NAT configuration
    case 'IP_NAT_STATIC':
      return handleIPNatStatic(device, action.params.local, action.params.global);
    
    case 'NO_IP_NAT_STATIC':
      return handleNoIPNatStatic(device, action.params.local);
    
    case 'IP_NAT_POOL':
      return handleIPNatPool(device, action.params.name, action.params.start, action.params.end, action.params.netmask);
    
    case 'NO_IP_NAT_POOL':
      return handleNoIPNatPool(device, action.params.name);
    
    case 'IP_NAT_DYNAMIC':
      return handleIPNatDynamic(device, action.params.acl, action.params.pool, action.params.overload);
    
    // NAT interface commands
    case 'IP_NAT_INSIDE':
      if (!currentInterface) {
        return { success: false, output: '', error: 'Not in interface configuration mode', stateChanged: false };
      }
      return handleIPNatInside(device, currentInterface);
    
    case 'NO_IP_NAT_INSIDE':
      if (!currentInterface) {
        return { success: false, output: '', error: 'Not in interface configuration mode', stateChanged: false };
      }
      return handleNoIPNatInside(device, currentInterface);
    
    case 'IP_NAT_OUTSIDE':
      if (!currentInterface) {
        return { success: false, output: '', error: 'Not in interface configuration mode', stateChanged: false };
      }
      return handleIPNatOutside(device, currentInterface);
    
    case 'NO_IP_NAT_OUTSIDE':
      if (!currentInterface) {
        return { success: false, output: '', error: 'Not in interface configuration mode', stateChanged: false };
      }
      return handleNoIPNatOutside(device, currentInterface);
    
    // STP show commands
    case 'SHOW_SPANNING_TREE':
      return handleShowSTP(device, action.params.vlan);
    
    case 'SHOW_SPANNING_TREE_VLAN':
      return handleShowSTPVLAN(device, action.params.vlan);
    
    case 'SHOW_SPANNING_TREE_SUMMARY':
      return handleShowSTPSummary(device);
    
    // STP configuration commands
    case 'SPANNING_TREE_VLAN_PRIORITY':
      return handleSTPVLANPriority(device, action.params.vlan, action.params.priority);
    
    case 'SPANNING_TREE_PORTFAST':
      if (!currentInterface) {
        return { success: false, output: '', error: 'Not in interface configuration mode', stateChanged: false };
      }
      return handleSTPPortFast(device, currentInterface, action.params.edge);
    
    case 'NO_SPANNING_TREE_PORTFAST':
      if (!currentInterface) {
        return { success: false, output: '', error: 'Not in interface configuration mode', stateChanged: false };
      }
      return handleNoSTPPortFast(device, currentInterface);
    
    case 'SPANNING_TREE_BPDUGUARD':
      if (!currentInterface) {
        return { success: false, output: '', error: 'Not in interface configuration mode', stateChanged: false };
      }
      return handleSTPBPDUGuard(device, currentInterface, action.params.enabled);
    
    case 'SPANNING_TREE_COST':
      if (!currentInterface) {
        return { success: false, output: '', error: 'Not in interface configuration mode', stateChanged: false };
      }
      return handleSTPCost(device, currentInterface, action.params.cost);
    
    // DHCP show commands
    case 'SHOW_IP_DHCP_POOL':
      return handleShowDHCPPool(device);
    
    case 'SHOW_IP_DHCP_BINDING':
      return handleShowDHCPBinding(device);
    
    case 'SHOW_IP_DHCP_STATISTICS':
      return handleShowDHCPStatistics(device);
    
    // DHCP configuration commands
    case 'IP_DHCP_POOL':
      return handleIPDHCPPool(device, action.params.name);
    
    case 'NO_IP_DHCP_POOL':
      return handleNoIPDHCPPool(device, action.params.name);
    
    case 'DHCP_NETWORK': {
      const poolName = state?.configTarget;
      if (!poolName) {
        return { success: false, output: '', error: 'Not in DHCP pool configuration mode', stateChanged: false };
      }
      return handleDHCPNetwork(device, poolName, action.params.network, action.params.mask);
    }
    
    case 'DHCP_DEFAULT_ROUTER': {
      const poolName = state?.configTarget;
      if (!poolName) {
        return { success: false, output: '', error: 'Not in DHCP pool configuration mode', stateChanged: false };
      }
      return handleDHCPDefaultRouter(device, poolName, action.params.routers);
    }
    
    case 'DHCP_DNS_SERVER': {
      const poolName = state?.configTarget;
      if (!poolName) {
        return { success: false, output: '', error: 'Not in DHCP pool configuration mode', stateChanged: false };
      }
      return handleDHCPDNSServer(device, poolName, action.params.servers);
    }
    
    case 'DHCP_DOMAIN_NAME': {
      const poolName = state?.configTarget;
      if (!poolName) {
        return { success: false, output: '', error: 'Not in DHCP pool configuration mode', stateChanged: false };
      }
      return handleDHCPDomainName(device, poolName, action.params.name);
    }
    
    case 'DHCP_LEASE': {
      const poolName = state?.configTarget;
      if (!poolName) {
        return { success: false, output: '', error: 'Not in DHCP pool configuration mode', stateChanged: false };
      }
      return handleDHCPLease(device, poolName, action.params.days, action.params.hours, action.params.minutes);
    }
    
    case 'IP_DHCP_EXCLUDED':
      return handleIPDHCPExcluded(device, action.params.low, action.params.high);
    
    case 'NO_IP_DHCP_EXCLUDED':
      return handleNoIPDHCPExcluded(device, action.params.low, action.params.high);
    
    case 'IP_HELPER_ADDRESS':
      if (!currentInterface) {
        return { success: false, output: '', error: 'Not in interface configuration mode', stateChanged: false };
      }
      return handleIPHelperAddress(device, currentInterface, action.params.server);
    
    case 'NO_IP_HELPER_ADDRESS':
      if (!currentInterface) {
        return { success: false, output: '', error: 'Not in interface configuration mode', stateChanged: false };
      }
      return handleNoIPHelperAddress(device, currentInterface);
    
    // IPv6 commands
    case 'IPV6_ADDRESS':
      if (!currentInterface) {
        return { success: false, output: '', error: 'Not in interface configuration mode', stateChanged: false };
      }
      return handleIPv6Address(device, currentInterface, action.params.address, action.params.prefixLength, action.params.eui64);
    
    case 'NO_IPV6_ADDRESS':
      if (!currentInterface) {
        return { success: false, output: '', error: 'Not in interface configuration mode', stateChanged: false };
      }
      return handleNoIPv6Address(device, currentInterface);
    
    case 'IPV6_ENABLE':
      if (!currentInterface) {
        return { success: false, output: '', error: 'Not in interface configuration mode', stateChanged: false };
      }
      return handleIPv6Enable(device, currentInterface, true);
    
    case 'NO_IPV6_ENABLE':
      if (!currentInterface) {
        return { success: false, output: '', error: 'Not in interface configuration mode', stateChanged: false };
      }
      return handleIPv6Enable(device, currentInterface, false);
    
    // IPv6 show commands
    case 'SHOW_IPV6_INTERFACE_BRIEF':
      return handleShowIPv6InterfaceBrief(device);
    
    case 'SHOW_IPV6_INTERFACE':
      return handleShowIPv6Interface(device, action.params.interface);
    
    case 'SHOW_IPV6_ROUTE':
      return handleShowIPv6Route(device);
    
    // IPv6 route commands
    case 'IPV6_ROUTE':
      return handleIPv6Route(device, action.params.network, action.params.nextHop, action.params.interface);
    
    case 'NO_IPV6_ROUTE':
      return handleNoIPv6Route(device, action.params.network, action.params.nextHop, action.params.interface);
    
    // Port Security commands
    case 'SWITCHPORT_PORT_SECURITY':
      if (!currentInterface) {
        return { success: false, output: '', error: 'Not in interface configuration mode', stateChanged: false };
      }
      return handlePortSecurity(device, currentInterface, action.params.enabled);
    
    case 'SWITCHPORT_PORT_SECURITY_MAXIMUM':
      if (!currentInterface) {
        return { success: false, output: '', error: 'Not in interface configuration mode', stateChanged: false };
      }
      return handlePortSecurityMaximum(device, currentInterface, action.params.max);
    
    case 'SWITCHPORT_PORT_SECURITY_VIOLATION':
      if (!currentInterface) {
        return { success: false, output: '', error: 'Not in interface configuration mode', stateChanged: false };
      }
      return handlePortSecurityViolation(device, currentInterface, action.params.mode);
    
    case 'SWITCHPORT_PORT_SECURITY_MAC':
      if (!currentInterface) {
        return { success: false, output: '', error: 'Not in interface configuration mode', stateChanged: false };
      }
      return handlePortSecurityMac(device, currentInterface, action.params.mac, action.params.vlan);
    
    case 'NO_SWITCHPORT_PORT_SECURITY_MAC':
      if (!currentInterface) {
        return { success: false, output: '', error: 'Not in interface configuration mode', stateChanged: false };
      }
      return handleNoPortSecurityMac(device, currentInterface, action.params.mac, action.params.vlan);
    
    case 'SWITCHPORT_PORT_SECURITY_STICKY':
      if (!currentInterface) {
        return { success: false, output: '', error: 'Not in interface configuration mode', stateChanged: false };
      }
      return handlePortSecuritySticky(device, currentInterface, action.params.enabled);
    
    // Port Security show commands
    case 'SHOW_PORT_SECURITY':
      return handleShowPortSecurity(device, action.params.interface);
    
    case 'SHOW_PORT_SECURITY_INTERFACE':
      return handleShowPortSecurityInterface(device, action.params.interface);
    
    case 'SHOW_PORT_SECURITY_ADDRESS':
      return handleShowPortSecurityAddress(device);
      
    case 'HELP':
      return { 
        success: true, 
        output: 'Available commands: enable, disable, show, configure, interface, ip, ping, traceroute\n', 
        stateChanged: false 
      };
      
    case 'HELP_CONTEXT':
      return {
        success: true,
        output: action.params.output,
        stateChanged: false,
      };
      
    default:
      return { 
        success: true, 
        output: '', 
        stateChanged: false 
      };
  }
}
