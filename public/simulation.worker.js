/**
 * Simulation Web Worker
 * Runs the simulation in a separate thread
 * Enhanced with: loopback interfaces, CDP, enable secret, banner motd,
 * syslog messages, show ip interface, clear commands, AD display
 */

// Simulation Worker
let topology = { devices: [], links: [], version: 0 };
let cliStates = new Map();

function createParserState() {
  return {
    mode: 'user',
    configTarget: null,
    history: [],
    historyIndex: -1,
  };
}

function getPrompt(state, hostname) {
  switch (state.mode) {
    case 'user': return hostname + '>';
    case 'privileged': return hostname + '#';
    case 'config': return hostname + '(config)#';
    case 'interface': return hostname + '(config-if)#';
    default: return hostname + '>';
  }
}

function isLoopback(iface) {
  return iface.name.toLowerCase().startsWith('loopback');
}

function getIfaceStatus(iface) {
  if (iface.isShutdown) return 'administratively down';
  if (isLoopback(iface)) return 'up';
  return iface.connectedTo ? 'up' : 'down';
}

function getIfaceProtocol(iface) {
  if (iface.isShutdown) return 'down';
  if (isLoopback(iface)) return 'up';
  return iface.connectedTo ? 'up' : 'down';
}

function getPrefixLength(mask) {
  const parts = mask.split('.').map(Number);
  let bits = 0;
  for (const part of parts) {
    let n = part;
    while (n > 0) { bits += n & 1; n >>= 1; }
  }
  return bits;
}

function generateMAC() {
  const hex = '0123456789ABCDEF';
  let mac = '';
  for (let i = 0; i < 6; i++) {
    if (i > 0) mac += ':';
    mac += hex[Math.floor(Math.random() * 16)];
    mac += hex[Math.floor(Math.random() * 16)];
  }
  return mac;
}

function ipToLong(ip) {
  const parts = ip.split('.');
  return ((parseInt(parts[0]) << 24) | (parseInt(parts[1]) << 16) |
          (parseInt(parts[2]) << 8) | parseInt(parts[3])) >>> 0;
}

function applySubnetMask(ip, mask) {
  const ipLong = ipToLong(ip);
  const maskLong = ipToLong(mask);
  const net = ipLong & maskLong;
  return `${(net >>> 24) & 255}.${(net >>> 16) & 255}.${(net >>> 8) & 255}.${net & 255}`;
}

function isSameNetwork(ip1, ip2, mask) {
  return applySubnetMask(ip1, mask) === applySubnetMask(ip2, mask);
}

/**
 * Tokenize and match commands with abbreviation support
 */
function tokenMatches(input, pattern) {
  if (input === pattern) return true;
  return input.length > 0 && pattern.toLowerCase().startsWith(input.toLowerCase()) && input.length < pattern.length;
}

self.onmessage = function(e) {
  const { type, payload } = e.data;

  if (type === 'INIT') {
    self.postMessage({
      type: 'STATE_UPDATE',
      payload: { topology: topology, eventCount: 0 },
      timestamp: Date.now(),
    });
  } else if (type === 'TOPOLOGY_UPDATE') {
    if (payload.topology) {
      topology = payload.topology;
      self.postMessage({
        type: 'STATE_UPDATE',
        payload: { topology: topology, eventCount: 0 },
        timestamp: Date.now(),
      });
    }
  } else if (type === 'CLI_COMMAND') {
    const { deviceId, command } = payload;

    let cliState = cliStates.get(deviceId);
    if (!cliState) {
      cliState = { parserState: createParserState(), currentInterface: null };
      cliStates.set(deviceId, cliState);
    }

    const device = topology.devices.find(d => d.id === deviceId);
    const hostname = device ? device.name : 'Router';

    let output = '';
    let stateChanged = false;
    const parserState = cliState.parserState;

    const trimmed = command.trim();
    const cmd = trimmed.toLowerCase();

    // Handle context help (?)
    if (cmd.endsWith('?')) {
      output = getContextHelp(cmd.slice(0, -1).trim(), parserState.mode);
    }
    // Handle "do" prefix in config/interface mode
    else if ((parserState.mode === 'config' || parserState.mode === 'interface') &&
             cmd.startsWith('do ')) {
      const doCmd = trimmed.substring(3).trim();
      const doCmdLower = doCmd.toLowerCase();
      // Process as if in privileged mode
      const result = processPrivilegedCommand(doCmdLower, doCmd, device, parserState);
      output = result.output;
      stateChanged = result.stateChanged;
    }
    else if (cmd === 'enable') {
      if (parserState.mode === 'user') {
        // Check enable secret/password
        if (device && (device.enableSecret || device.enablePassword)) {
          // In a real terminal we'd prompt for password, but simplified here
          parserState.mode = 'privileged';
        } else {
          parserState.mode = 'privileged';
        }
      }
    } else if (cmd === 'disable') {
      parserState.mode = 'user';
    } else if (tokenMatches(cmd.split(' ')[0], 'configure') &&
               (cmd.split(' ')[1] === undefined || tokenMatches(cmd.split(' ')[1] || '', 'terminal'))) {
      if (parserState.mode === 'privileged') {
        parserState.mode = 'config';
        output = 'Enter configuration commands, one per line.  End with CNTL/Z.';
      } else {
        output = '% Permission denied.';
      }
    } else if (parserState.mode === 'privileged' || parserState.mode === 'user') {
      const result = processPrivilegedCommand(cmd, trimmed, device, parserState);
      output = result.output;
      stateChanged = result.stateChanged;
    } else if (parserState.mode === 'config') {
      const result = processConfigCommand(cmd, trimmed, device, parserState);
      output = result.output;
      stateChanged = result.stateChanged;
    } else if (parserState.mode === 'interface') {
      const result = processInterfaceCommand(cmd, trimmed, device, parserState, cliState);
      output = result.output;
      stateChanged = result.stateChanged;
    }

    self.postMessage({
      type: 'CLI_RESPONSE',
      payload: {
        output,
        prompt: getPrompt(parserState, device ? device.name : hostname),
        stateChanged,
      },
      timestamp: Date.now(),
    });

    if (stateChanged) {
      self.postMessage({
        type: 'STATE_UPDATE',
        payload: { topology: topology, eventCount: 0 },
        timestamp: Date.now(),
      });
    }
  }
};

function getContextHelp(partial, mode) {
  const commands = {
    user: ['enable', 'exit', 'help', 'logout', 'show version', 'ping'],
    privileged: [
      'configure terminal', 'disable', 'exit', 'show version', 'show running-config',
      'show startup-config', 'show ip interface brief', 'show ip interface', 'show interfaces',
      'show ip route', 'show arp', 'show mac address-table', 'show vlan', 'show vlan brief',
      'show interfaces trunk', 'show cdp neighbors', 'ping', 'traceroute',
      'write memory', 'copy running-config startup-config', 'erase startup-config', 'reload',
      'clear mac address-table dynamic', 'clear arp-cache',
    ],
    config: [
      'hostname', 'interface', 'ip route', 'no ip route', 'vlan', 'no vlan',
      'enable secret', 'enable password', 'banner motd', 'end', 'exit',
    ],
    interface: [
      'ip address', 'no ip address', 'shutdown', 'no shutdown', 'description', 'no description',
      'switchport mode access', 'switchport mode trunk', 'switchport access vlan',
      'switchport trunk allowed vlan', 'switchport trunk native vlan',
      'duplex', 'speed', 'exit', 'end',
    ],
  };

  const available = commands[mode] || [];
  if (!partial) {
    return '\n' + available.map(c => '  ' + c).join('\n') + '\n';
  }
  const matching = available.filter(c => c.toLowerCase().startsWith(partial.toLowerCase()));
  if (matching.length === 0) return '% Unrecognized command';
  return '\n' + matching.map(c => '  ' + c).join('\n') + '\n';
}

function processPrivilegedCommand(cmd, original, device, parserState) {
  let output = '';
  let stateChanged = false;

  if (cmd === '' || cmd === '\n') {
    // empty
  } else if (cmd === 'exit' || cmd === 'logout') {
    if (parserState.mode === 'privileged') {
      parserState.mode = 'user';
    }
  } else if (matchCmd(cmd, 'show version')) {
    output = 'Cisco IOS Software, C800 Software (C800-UNIVERSALK9-M), Version 15.7(3)M4\n';
    output += 'Technical Support: http://www.cisco.com/techsupport\n';
    if (device) {
      output += device.name + ' uptime is 0 hours, 0 minutes\n';
      output += device.interfaces.length + ' interfaces\n';
    }
  } else if (matchCmd(cmd, 'show running-config') || matchCmd(cmd, 'show run')) {
    if (parserState.mode === 'privileged') {
      output = buildRunningConfig(device);
    } else {
      output = '% Invalid input detected.';
    }
  } else if (matchCmd(cmd, 'show startup-config')) {
    output = device && device.startupConfig && device.startupConfig.length > 0
      ? 'Using [Startup Config]\n'
      : 'startup-config is not present';
  } else if (matchCmd(cmd, 'show ip interface brief') || matchCmd(cmd, 'show ip int br')) {
    output = showIPInterfaceBrief(device);
  } else if (matchCmd(cmd, 'show ip interface')) {
    output = showIPInterface(device);
  } else if (matchCmd(cmd, 'show interfaces trunk')) {
    output = showInterfacesTrunk(device);
  } else if (matchCmd(cmd, 'show interfaces')) {
    output = showInterfaces(device);
  } else if (matchCmd(cmd, 'show ip route')) {
    output = showIPRoute(device);
  } else if (matchCmd(cmd, 'show arp')) {
    output = showARP(device);
  } else if (matchCmd(cmd, 'show mac address-table') || matchCmd(cmd, 'show mac add')) {
    output = showMACTable(device);
  } else if (matchCmd(cmd, 'show vlan brief') || matchCmd(cmd, 'show vlan')) {
    output = showVlan(device);
  } else if (matchCmd(cmd, 'show cdp neighbors') || matchCmd(cmd, 'show cdp nei')) {
    output = showCDPNeighbors(device);
  } else if (matchCmd(cmd, 'clear mac address-table dynamic')) {
    if (device && device.macTable) {
      if (Array.isArray(device.macTable)) {
        device.macTable = [];
      } else {
        device.macTable = [];
      }
      stateChanged = true;
    }
  } else if (matchCmd(cmd, 'clear arp-cache')) {
    if (device && device.arpTable) {
      device.arpTable = [];
      stateChanged = true;
    }
  } else if (cmd.startsWith('ping ')) {
    const target = cmd.split(' ')[1];
    output = simulatePing(device, target);
  } else if (matchCmd(cmd, 'write memory') || matchCmd(cmd, 'wr')) {
    if (device) {
      device.startupConfig = JSON.parse(JSON.stringify(device.runningConfig || []));
      output = 'Building configuration...\n[OK]';
      stateChanged = true;
    }
  } else if (matchCmd(cmd, 'copy running-config startup-config')) {
    if (device) {
      device.startupConfig = JSON.parse(JSON.stringify(device.runningConfig || []));
      output = 'Building configuration...\n[OK]';
      stateChanged = true;
    }
  } else if (matchCmd(cmd, 'reload')) {
    output = 'System Bootstrap, Version 15.4(1r)T\nBooting ' + (device ? device.name : 'Router') + '...\n\nPress RETURN to get started!';
  } else if (matchCmd(cmd, 'erase startup-config')) {
    if (device) {
      device.startupConfig = [];
      output = 'Erasing the nvram filesystem...\n[OK]\nErase of nvram: complete';
      stateChanged = true;
    }
  } else {
    output = "% Unknown command or computer name, or unable to find computer address.";
  }

  return { output, stateChanged };
}

function processConfigCommand(cmd, original, device, parserState) {
  let output = '';
  let stateChanged = false;

  if (cmd === 'end') {
    parserState.mode = 'privileged';
    parserState.configTarget = null;
  } else if (cmd === 'exit') {
    parserState.mode = 'privileged';
    parserState.configTarget = null;
  } else if (cmd.startsWith('hostname ')) {
    const newName = original.split(' ')[1];
    if (device && newName) {
      device.name = newName;
      stateChanged = true;
    }
  } else if (cmd.startsWith('interface ')) {
    const ifName = original.split(' ').slice(1).join(' ');
    parserState.mode = 'interface';

    // Normalize loopback name
    const loMatch = ifName.match(/^[Ll]oopback\s*(\d+)$/);
    const canonicalName = loMatch ? 'Loopback' + loMatch[1] : ifName;
    parserState.configTarget = canonicalName;

    // Auto-create loopback interfaces
    if (loMatch && device) {
      const exists = device.interfaces.find(i => i.name.toLowerCase() === canonicalName.toLowerCase());
      if (!exists) {
        device.interfaces.push({
          id: device.id + '-lo' + loMatch[1],
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
        });
        stateChanged = true;
      }
    }
  } else if (cmd.startsWith('ip route ')) {
    const parts = original.split(/\s+/);
    if (parts.length >= 5 && device) {
      const network = parts[2];
      const mask = parts[3];
      const nextHop = parts[4];
      if (!device.routingTable) device.routingTable = [];
      // Remove existing
      device.routingTable = device.routingTable.filter(r =>
        !(r.network === network && r.mask === mask && r.protocol === 'S')
      );
      device.routingTable.push({
        network, mask, nextHop, interface: null, protocol: 'S', metric: 0, isLocal: false,
      });
      stateChanged = true;
    }
  } else if (cmd.startsWith('no ip route ')) {
    const parts = original.split(/\s+/);
    if (parts.length >= 5 && device) {
      const network = parts[3];
      const mask = parts[4];
      device.routingTable = (device.routingTable || []).filter(r =>
        !(r.network === network && r.mask === mask && r.protocol === 'S')
      );
      stateChanged = true;
    }
  } else if (cmd.startsWith('vlan ') && !cmd.startsWith('vlan name')) {
    const vlanId = parseInt(cmd.split(' ')[1], 10);
    if (device && vlanId >= 1 && vlanId <= 4094) {
      if (!device.vlanDatabase) device.vlanDatabase = [];
      if (!device.vlanDatabase.find(v => v.id === vlanId)) {
        device.vlanDatabase.push({ id: vlanId, name: 'VLAN' + String(vlanId).padStart(4, '0'), interfaces: [] });
        stateChanged = true;
      }
    }
  } else if (cmd.startsWith('no vlan ')) {
    const vlanId = parseInt(cmd.split(' ')[2], 10);
    if (device && vlanId !== 1 && device.vlanDatabase) {
      device.vlanDatabase = device.vlanDatabase.filter(v => v.id !== vlanId);
      stateChanged = true;
    }
  } else if (cmd.startsWith('enable secret ')) {
    if (device) {
      device.enableSecret = original.split(' ').slice(2).join(' ');
      stateChanged = true;
    }
  } else if (cmd.startsWith('enable password ')) {
    if (device) {
      device.enablePassword = original.split(' ').slice(2).join(' ');
      stateChanged = true;
    }
  } else if (cmd === 'no enable secret') {
    if (device) { device.enableSecret = undefined; stateChanged = true; }
  } else if (cmd === 'no enable password') {
    if (device) { device.enablePassword = undefined; stateChanged = true; }
  } else if (cmd.startsWith('banner motd ')) {
    if (device) {
      device.bannerMotd = original.split(' ').slice(2).join(' ');
      stateChanged = true;
    }
  } else if (cmd === 'no banner motd') {
    if (device) { device.bannerMotd = undefined; stateChanged = true; }
  } else {
    output = '% Invalid input detected.';
  }

  return { output, stateChanged };
}

function processInterfaceCommand(cmd, original, device, parserState, cliState) {
  let output = '';
  let stateChanged = false;
  const ifaceName = parserState.configTarget;

  if (cmd === 'exit') {
    parserState.mode = 'config';
    parserState.configTarget = null;
  } else if (cmd === 'end') {
    parserState.mode = 'privileged';
    parserState.configTarget = null;
  } else if (cmd.startsWith('ip address ') && ifaceName && device) {
    const parts = original.split(/\s+/);
    const ip = parts[2];
    const mask = parts[3];
    const iface = device.interfaces.find(i => i.name.toLowerCase() === ifaceName.toLowerCase());
    if (iface && ip && mask) {
      iface.ip = ip;
      iface.subnetMask = mask;
      stateChanged = true;
      // Update connected routes
      updateConnectedRoutes(device);
    }
  } else if (cmd === 'no ip address' && ifaceName && device) {
    const iface = device.interfaces.find(i => i.name.toLowerCase() === ifaceName.toLowerCase());
    if (iface) {
      iface.ip = null;
      iface.subnetMask = null;
      stateChanged = true;
      updateConnectedRoutes(device);
    }
  } else if (cmd === 'no shutdown' && ifaceName && device) {
    const iface = device.interfaces.find(i => i.name.toLowerCase() === ifaceName.toLowerCase());
    if (iface) {
      const wasUp = !iface.isShutdown && (isLoopback(iface) || !!iface.connectedTo);
      iface.isShutdown = false;
      iface.status = isLoopback(iface) || iface.connectedTo ? 'up' : 'down';
      const isUp = isLoopback(iface) || !!iface.connectedTo;
      stateChanged = true;
      updateConnectedRoutes(device);
      // Syslog messages
      if (!wasUp && isUp) {
        const ts = new Date().toISOString().replace('T', ' ').substring(0, 23);
        output = ts + ': %LINK-3-UPDOWN: Interface ' + iface.name + ', changed state to up\n';
        output += ts + ': %LINEPROTO-5-UPDOWN: Line protocol on Interface ' + iface.name + ', changed state to up';
      }
    }
  } else if (cmd === 'shutdown' && ifaceName && device) {
    const iface = device.interfaces.find(i => i.name.toLowerCase() === ifaceName.toLowerCase());
    if (iface) {
      const wasUp = !iface.isShutdown && (isLoopback(iface) || !!iface.connectedTo);
      iface.isShutdown = true;
      iface.status = 'administratively down';
      stateChanged = true;
      updateConnectedRoutes(device);
      if (wasUp) {
        const ts = new Date().toISOString().replace('T', ' ').substring(0, 23);
        output = ts + ': %LINK-3-UPDOWN: Interface ' + iface.name + ', changed state to down\n';
        output += ts + ': %LINEPROTO-5-UPDOWN: Line protocol on Interface ' + iface.name + ', changed state to down';
      }
    }
  } else if (cmd.startsWith('description ') && ifaceName && device) {
    const iface = device.interfaces.find(i => i.name.toLowerCase() === ifaceName.toLowerCase());
    if (iface) {
      iface.description = original.split(' ').slice(1).join(' ');
      stateChanged = true;
    }
  } else if (cmd === 'no description' && ifaceName && device) {
    const iface = device.interfaces.find(i => i.name.toLowerCase() === ifaceName.toLowerCase());
    if (iface) { iface.description = ''; stateChanged = true; }
  } else if (cmd.startsWith('switchport mode ') && ifaceName && device) {
    const mode = cmd.split(' ')[2];
    const iface = device.interfaces.find(i => i.name.toLowerCase() === ifaceName.toLowerCase());
    if (iface && (mode === 'access' || mode === 'trunk')) {
      iface.switchportMode = mode;
      if (mode === 'trunk') iface.trunkVlans = [];
      stateChanged = true;
    }
  } else if (cmd.startsWith('switchport access vlan ') && ifaceName && device) {
    const vlanId = parseInt(cmd.split(' ')[3], 10);
    const iface = device.interfaces.find(i => i.name.toLowerCase() === ifaceName.toLowerCase());
    if (iface && vlanId >= 1 && vlanId <= 4094) {
      iface.accessVlan = vlanId;
      iface.switchportMode = 'access';
      stateChanged = true;
    }
  } else if (cmd.startsWith('switchport trunk native vlan ') && ifaceName && device) {
    const vlanId = parseInt(cmd.split(' ')[4], 10);
    const iface = device.interfaces.find(i => i.name.toLowerCase() === ifaceName.toLowerCase());
    if (iface) { iface.nativeVlan = vlanId; stateChanged = true; }
  } else if (cmd.startsWith('switchport trunk allowed vlan ') && ifaceName && device) {
    const vlansStr = cmd.split(' ').slice(4).join(' ');
    const iface = device.interfaces.find(i => i.name.toLowerCase() === ifaceName.toLowerCase());
    if (iface) {
      if (vlansStr === 'all') {
        iface.trunkVlans = [];
      } else {
        const vlanIds = [];
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
      stateChanged = true;
    }
  } else {
    output = '% Invalid input detected.';
  }

  return { output, stateChanged };
}

function updateConnectedRoutes(device) {
  if (!device || device.type === 'switch') return;
  if (!device.routingTable) device.routingTable = [];
  device.routingTable = device.routingTable.filter(r => r.protocol !== 'C');
  for (const iface of device.interfaces) {
    if (iface.ip && iface.subnetMask && !iface.isShutdown) {
      const network = applySubnetMask(iface.ip, iface.subnetMask);
      device.routingTable.push({
        network, mask: iface.subnetMask, nextHop: null, interface: iface.name,
        protocol: 'C', metric: 0, isLocal: true,
      });
    }
  }
}

function matchCmd(input, pattern) {
  // Simple prefix-based abbreviation matching
  if (input === pattern) return true;
  const inputTokens = input.split(/\s+/);
  const patternTokens = pattern.split(/\s+/);
  if (inputTokens.length < patternTokens.length) return false;
  if (inputTokens.length > patternTokens.length) return false;
  for (let i = 0; i < patternTokens.length; i++) {
    if (!tokenMatches(inputTokens[i], patternTokens[i])) return false;
  }
  return true;
}

// ============================================================================
// Show Commands
// ============================================================================

function showIPInterfaceBrief(device) {
  let output = 'Interface                  IP-Address      OK? Method Status                Protocol\n';
  if (device) {
    device.interfaces.forEach(function(iface) {
      const ip = iface.ip || 'unassigned';
      const status = getIfaceStatus(iface);
      const protocol = getIfaceProtocol(iface);
      output += iface.name.padEnd(26) + ' ' + ip.padEnd(15) + ' YES manual  ' + status.padEnd(21) + ' ' + protocol + '\n';
    });
  }
  return output;
}

function showIPInterface(device) {
  let output = '';
  if (!device) return output;
  for (const iface of device.interfaces) {
    const status = getIfaceStatus(iface);
    const protocol = getIfaceProtocol(iface);
    output += iface.name + ' is ' + status + ', line protocol is ' + protocol + '\n';
    if (iface.ip && iface.subnetMask) {
      output += '  Internet address is ' + iface.ip + '/' + getPrefixLength(iface.subnetMask) + '\n';
      output += '  Broadcast address is 255.255.255.255\n';
    } else {
      output += '  Internet protocol processing disabled\n';
    }
    output += '  MTU is 1500 bytes\n';
    output += '  Directed broadcast forwarding is disabled\n';
    output += '  Outgoing access list is not set\n';
    output += '  Inbound  access list is not set\n';
    output += '  Proxy ARP is enabled\n';
    output += '  Security level is default\n';
    output += '  Split horizon is enabled\n';
    output += '  ICMP redirects are always sent\n';
    output += '  IP fast switching is enabled\n';
    output += '  IP CEF switching is enabled\n';
    output += '  Network address translation is disabled\n\n';
  }
  return output;
}

function showInterfaces(device) {
  let output = '';
  if (!device) return output;
  for (const iface of device.interfaces) {
    const status = getIfaceStatus(iface);
    const protocol = getIfaceProtocol(iface);
    const isUp = !iface.isShutdown && (isLoopback(iface) || !!iface.connectedTo);
    const hwType = isLoopback(iface) ? 'Loopback' : (device.type === 'router' ? 'CN Gigabit Ethernet' : 'EtherSVI');
    output += iface.name + ' is ' + status + ', line protocol is ' + protocol + '\n';
    output += '  Hardware is ' + hwType + ', address is ' + iface.mac + '\n';
    if (iface.description) output += '  Description: ' + iface.description + '\n';
    if (iface.ip && iface.subnetMask) {
      output += '  Internet address is ' + iface.ip + '/' + getPrefixLength(iface.subnetMask) + '\n';
    }
    output += '  MTU 1500 bytes, BW 100000 Kbit/sec, DLY 100 usec\n';
    if (isUp) {
      output += '  Full-duplex, 100Mb/s\n';
    } else {
      output += '  ' + (iface.isShutdown ? 'Administratively down' : 'Disconnected') + '\n';
    }
    output += '\n';
  }
  return output;
}

function showIPRoute(device) {
  if (!device || device.type === 'switch') return 'IP routing not enabled on this switch\n';
  let output = 'Codes: C - connected, S - static, R - RIP, O - OSPF, D - EIGRP\n\n';

  // Default route detection
  const defaultRoute = (device.routingTable || []).find(r => r.network === '0.0.0.0' && r.mask === '0.0.0.0');
  if (defaultRoute) {
    const via = defaultRoute.nextHop || defaultRoute.interface || 'unknown';
    output += 'Gateway of last resort is ' + via + ' to network 0.0.0.0\n\n';
  } else {
    output += 'Gateway of last resort is not set\n\n';
  }

  // Connected routes from active interfaces
  for (const iface of device.interfaces) {
    if (iface.ip && iface.subnetMask && !iface.isShutdown) {
      const network = applySubnetMask(iface.ip, iface.subnetMask);
      const prefix = getPrefixLength(iface.subnetMask);
      output += 'C        ' + network + '/' + prefix + ' is directly connected, ' + iface.name + '\n';
      output += 'L        ' + iface.ip + '/32 is directly connected, ' + iface.name + '\n';
    }
  }

  // Static routes with AD
  for (const route of (device.routingTable || [])) {
    if (route.protocol === 'S') {
      const prefix = getPrefixLength(route.mask);
      const via = route.nextHop ? 'via ' + route.nextHop : 'is directly connected, ' + route.interface;
      output += 'S        ' + route.network + '/' + prefix + ' [1/' + route.metric + '] ' + via + '\n';
    }
  }

  return output + '\n';
}

function showARP(device) {
  if (!device || device.type === 'switch') return 'This command is available only on routers.\n';
  let output = 'Protocol  Address          Age (min)  Hardware Addr   Type   Interface\n';
  for (const iface of device.interfaces) {
    if (iface.ip && !iface.isShutdown) {
      output += 'Internet  ' + iface.ip.padEnd(15) + '  -          ' + iface.mac + '  ARPA   ' + iface.name + '\n';
    }
  }
  if (device.arpTable) {
    const entries = Array.isArray(device.arpTable) ? device.arpTable : [];
    for (const [ip, mac] of entries) {
      const matchIface = device.interfaces.find(i =>
        i.ip && i.subnetMask && isSameNetwork(i.ip, ip, i.subnetMask)
      );
      output += 'Internet  ' + ip.padEnd(15) + '  0          ' + mac + '  ARPA   ' + (matchIface ? matchIface.name : 'Unknown') + '\n';
    }
  }
  return output + '\n';
}

function showMACTable(device) {
  if (!device || device.type === 'router') return 'MAC address table is only available on switches.\n';
  let output = '\n          Mac Address Table\n';
  output += '-------------------------------------------\n';
  output += 'Vlan    Mac Address       Type        Ports\n';
  output += '----    -----------       --------    -----\n';
  const entries = Array.isArray(device.macTable) ? device.macTable : [];
  for (const [mac, ifaceId] of entries) {
    const iface = device.interfaces.find(i => i.id === ifaceId);
    const port = iface ? iface.name.replace('FastEthernet', 'Fa') : 'Unknown';
    output += '  1    ' + mac + '    DYNAMIC     ' + port + '\n';
  }
  output += '-------------------------------------------\n';
  output += 'Total Mac Addresses for this criterion: ' + entries.length + '\n';
  return output;
}

function showVlan(device) {
  if (!device || device.type !== 'switch') return '% This command is only available on switches.\n';
  let output = '\nVLAN Name                             Status    Ports\n';
  output += '---- -------------------------------- --------- -------------------------------\n';
  const vlans = device.vlanDatabase || [];
  const sorted = [...vlans].sort((a, b) => a.id - b.id);
  for (const vlan of sorted) {
    const ports = device.interfaces
      .filter(i => i.switchportMode === 'access' && i.accessVlan === vlan.id)
      .map(i => i.name.replace('FastEthernet', 'Fa'))
      .join(', ');
    output += String(vlan.id).padEnd(4) + ' ' + vlan.name.padEnd(32) + ' active    ' + ports + '\n';
  }
  return output + '\n';
}

function showInterfacesTrunk(device) {
  if (!device || device.type !== 'switch') return '% This command is only available on switches.\n';
  const trunkPorts = device.interfaces.filter(i => i.switchportMode === 'trunk');
  if (trunkPorts.length === 0) return '\nNo trunk interfaces configured.\n\n';
  let output = '\nPort        Mode         Encapsulation  Status        Native vlan\n';
  output += '----------- ------------ -------------- ------------- -----------\n';
  for (const iface of trunkPorts) {
    const portName = iface.name.replace('FastEthernet', 'Fa');
    const status = iface.isShutdown ? 'not-connect' : (iface.connectedTo ? 'trunking' : 'not-connect');
    output += portName.padEnd(11) + ' on           802.1q         ' + status.padEnd(13) + ' ' + iface.nativeVlan + '\n';
  }
  output += '\nPort        Vlans allowed on trunk\n';
  output += '----------- ---------------------------------------------------------------------\n';
  for (const iface of trunkPorts) {
    const portName = iface.name.replace('FastEthernet', 'Fa');
    const allowed = (!iface.trunkVlans || iface.trunkVlans.length === 0) ? '1-4094' : iface.trunkVlans.join(',');
    output += portName.padEnd(11) + ' ' + allowed + '\n';
  }
  return output + '\n';
}

function showCDPNeighbors(device) {
  if (!device) return '';
  let output = 'Capability Codes: R - Router, S - Switch, H - Host\n\n';
  output += 'Device ID        Local Intrfce     Holdtme    Capability  Platform  Port ID\n';
  let count = 0;
  for (const iface of device.interfaces) {
    if (!iface.connectedTo || iface.isShutdown) continue;
    const parts = iface.connectedTo.split('/');
    const connDeviceId = parts[0];
    const connInterfaceId = parts.slice(1).join('/');
    const connDevice = topology.devices.find(d => d.id === connDeviceId);
    if (!connDevice) continue;
    const connIface = connDevice.interfaces.find(i => i.id === connInterfaceId);
    if (!connIface) continue;
    const cap = connDevice.type === 'router' ? 'R' : 'S';
    const platform = connDevice.type === 'router' ? 'C881-K9' : 'WS-C2960';
    const localPort = iface.name.replace('GigabitEthernet', 'Gig ').replace('FastEthernet', 'Fas ');
    const remotePort = connIface.name.replace('GigabitEthernet', 'Gig ').replace('FastEthernet', 'Fas ');
    output += connDevice.name.padEnd(16) + ' ' + localPort.padEnd(17) + ' 180        ' + cap.padEnd(11) + ' ' + platform.padEnd(9) + ' ' + remotePort + '\n';
    count++;
  }
  output += '\nTotal cdp entries displayed : ' + count + '\n';
  return output;
}

function buildRunningConfig(device) {
  if (!device) return '';
  let output = 'Building configuration...\n\nCurrent configuration:\n!\n';
  output += 'hostname ' + device.name + '\n!\n';
  if (device.enableSecret) output += 'enable secret 5 ' + device.enableSecret + '\n';
  if (device.enablePassword) output += 'enable password ' + device.enablePassword + '\n';
  output += '!\n';
  if (device.bannerMotd) output += 'banner motd ^C' + device.bannerMotd + '^C\n!\n';
  for (const iface of device.interfaces) {
    output += 'interface ' + iface.name + '\n';
    if (iface.description) output += ' description ' + iface.description + '\n';
    if (iface.ip) output += ' ip address ' + iface.ip + ' ' + iface.subnetMask + '\n';
    if (iface.isShutdown) output += ' shutdown\n';
    else output += ' no shutdown\n';
    output += '!\n';
  }
  for (const route of (device.routingTable || [])) {
    if (route.protocol === 'S') {
      output += 'ip route ' + route.network + ' ' + route.mask + ' ' + (route.nextHop || route.interface) + '\n';
    }
  }
  output += '!\nend';
  return output;
}

function simulatePing(device, target) {
  if (!device) return '% No device selected';
  if (device.type === 'switch') return '% Ping is not available on switches';

  // Check self-ping (including loopback IPs)
  const isSelf = device.interfaces.some(i => i.ip === target && !i.isShutdown);
  if (isSelf) {
    return 'Type escape sequence to abort.\nSending 5, 100-byte ICMP Echos to ' + target +
           ', timeout is 2 seconds:\n!!!!!\nSuccess rate is 100 percent (5/5), round-trip min/avg/max = 0/0/1 ms';
  }

  // Trace path through topology
  let reachable = false;
  const srcIface = device.interfaces.find(i => i.ip && !i.isShutdown);
  if (srcIface) {
    reachable = tracePacket(device, srcIface, target, new Set());
  }

  const count = 5;
  let received = 0;
  let results = '';
  for (let i = 0; i < count; i++) {
    if (reachable) { results += '!'; received++; }
    else { results += '.'; }
  }

  let output = 'Type escape sequence to abort.\nSending 5, 100-byte ICMP Echos to ' + target + ', timeout is 2 seconds:\n';
  output += results + '\n';
  const pct = Math.round((received / count) * 100);
  output += 'Success rate is ' + pct + ' percent (' + received + '/' + count + ')';
  if (received > 0) {
    output += ', round-trip min/avg/max = 1/2/4 ms';
  }
  return output;
}

function tracePacket(currentDevice, srcIface, targetIP, visited) {
  if (visited.has(currentDevice.id)) return false;
  visited.add(currentDevice.id);
  if (visited.size > 30) return false;

  if (currentDevice.type === 'router') {
    if (currentDevice.interfaces.some(i => i.ip === targetIP && !i.isShutdown)) return true;

    // Find route
    let bestRoute = null;
    let longestPrefix = -1;

    // Check connected networks
    for (const iface of currentDevice.interfaces) {
      if (iface.ip && iface.subnetMask && !iface.isShutdown && isSameNetwork(iface.ip, targetIP, iface.subnetMask)) {
        bestRoute = { interface: iface.name, nextHop: null, mask: iface.subnetMask };
        longestPrefix = 999;
        break;
      }
    }

    // Check routing table
    if (!bestRoute) {
      for (const route of (currentDevice.routingTable || [])) {
        if (isSameNetwork(targetIP, route.network, route.mask)) {
          const pl = ipToLong(route.mask).toString(2).replace(/0/g, '').length;
          if (pl > longestPrefix) { longestPrefix = pl; bestRoute = route; }
        }
      }
    }

    if (!bestRoute) return false;

    let outIface;
    if (bestRoute.interface) {
      outIface = currentDevice.interfaces.find(i => i.name === bestRoute.interface);
    } else if (bestRoute.nextHop) {
      outIface = currentDevice.interfaces.find(i =>
        i.ip && i.subnetMask && isSameNetwork(i.ip, bestRoute.nextHop, i.subnetMask)
      );
    }

    if (!outIface || outIface.isShutdown || !outIface.connectedTo) return false;

    const parts = outIface.connectedTo.split('/');
    const nextDevId = parts[0];
    const nextIfId = parts.slice(1).join('/');
    const nextDev = topology.devices.find(d => d.id === nextDevId);
    if (!nextDev) return false;
    const nextIf = nextDev.interfaces.find(i => i.id === nextIfId);
    if (!nextIf || nextIf.isShutdown) return false;

    if (nextDev.type === 'switch') return traceThroughSwitch(nextDev, nextIf, targetIP, visited);
    if (nextDev.interfaces.some(i => i.ip === targetIP && !i.isShutdown)) return true;
    return tracePacket(nextDev, nextIf, targetIP, visited);
  }

  if (currentDevice.type === 'switch') {
    return traceThroughSwitch(currentDevice, srcIface, targetIP, visited);
  }

  return false;
}

function traceThroughSwitch(switchDev, ingressIface, targetIP, visited) {
  for (const iface of switchDev.interfaces) {
    if (iface.id === ingressIface.id || !iface.connectedTo || iface.isShutdown) continue;
    const parts = iface.connectedTo.split('/');
    const connDevId = parts[0];
    const connIfId = parts.slice(1).join('/');
    const connDev = topology.devices.find(d => d.id === connDevId);
    if (!connDev || visited.has(connDev.id)) continue;
    const connIf = connDev.interfaces.find(i => i.id === connIfId);
    if (!connIf || connIf.isShutdown) continue;

    if (connDev.type === 'router') {
      if (connDev.interfaces.some(i => i.ip === targetIP && !i.isShutdown)) return true;
      if (tracePacket(connDev, connIf, targetIP, new Set(visited))) return true;
    } else if (connDev.type === 'switch') {
      if (traceThroughSwitch(connDev, connIf, targetIP, new Set(visited))) return true;
    }
  }
  return false;
}
