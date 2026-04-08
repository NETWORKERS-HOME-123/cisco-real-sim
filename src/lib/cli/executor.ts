/**
 * CLI Command Executor
 * Executes parsed CLI commands against the simulation engine
 */

import { Topology, Device, Interface, Route, CLIAction } from '../types';
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
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(name)) {
    return {
      success: false,
      output: '',
      error: 'Invalid hostname format',
      stateChanged: false,
    };
  }
  
  const oldName = device.name;
  device.name = name;
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
  
  iface.description = description;
  device.runningConfig.push(`interface ${interfaceName}`);
  device.runningConfig.push(` description ${description}`);
  
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
// Main Executor
// ============================================================================

export function executeCommand(
  action: CLIAction,
  topology: Topology,
  device: Device,
  currentInterface: string | null,
  queue: EventQueue
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

    case 'BANNER_MOTD':
      device.bannerMotd = action.params.text;
      device.runningConfig.push(`banner motd ^C${action.params.text}^C`);
      return { success: true, output: '', stateChanged: true };

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
