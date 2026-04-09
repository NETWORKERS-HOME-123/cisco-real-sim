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
    case 'router': return hostname + '(config-router)#';
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
    // Handle "do" prefix in config/interface/router mode
    else if ((parserState.mode === 'config' || parserState.mode === 'interface' || parserState.mode === 'router') &&
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
    } else if (parserState.mode === 'router') {
      const result = processRouterCommand(cmd, trimmed, device, parserState);
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
      if (device.macTable instanceof Map) {
        device.macTable.clear();
      } else {
        device.macTable = new Map();
      }
      stateChanged = true;
    }
  } else if (matchCmd(cmd, 'clear arp-cache')) {
    if (device && device.arpTable) {
      if (device.arpTable instanceof Map) {
        device.arpTable.clear();
      } else {
        device.arpTable = new Map();
      }
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
  } else if (matchCmd(cmd, 'show ip ospf neighbor')) {
    output = showOSPFNeighbors(device);
  } else if (matchCmd(cmd, 'show ip ospf interface')) {
    output = showOSPFInterface(device);
  } else if (matchCmd(cmd, 'show ip ospf database')) {
    output = showOSPFDatabase(device);
  } else if (matchCmd(cmd, 'show ip ospf')) {
    output = showOSPFProcess(device);
  } else if (matchCmd(cmd, 'show ip route ospf')) {
    output = showOSPFRoutes(device);
  } else if (matchCmd(cmd, 'show access-lists') || cmd.startsWith('show access-lists ')) {
    const aclName = cmd.split(' ')[2];
    output = showAccessLists(device, aclName);
  } else if (matchCmd(cmd, 'show ip access-lists') || cmd.startsWith('show ip access-lists ')) {
    const aclName = cmd.split(' ')[3];
    output = showIPAccessLists(device, aclName);
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

    // Normalize loopback name: "Loopback 0" → "Loopback0"
    // Handle subinterface: "GigabitEthernet0/0.10" stays as-is
    // Handle SVI: "vlan 10" → "Vlan10"
    const loMatch = ifName.match(/^[Ll]oopback\s*(\d+)$/);
    const vlanMatch = ifName.match(/^[Vv]lan\s*(\d+)$/);
    const subifaceMatch = ifName.match(/^([Gg]igabit[Ee]thernet\d+\/\d+)\.(\d+)$/);
    
    let canonicalName;
    if (loMatch) {
      canonicalName = 'Loopback' + loMatch[1];
    } else if (vlanMatch) {
      canonicalName = 'Vlan' + vlanMatch[1];
    } else {
      canonicalName = ifName;
    }
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
          isSubinterface: false,
          parentInterface: null,
          encapsulation: null,
        });
        stateChanged = true;
      }
    }
    
    // Auto-create subinterfaces (e.g., GigabitEthernet0/0.10)
    if (subifaceMatch && device) {
      const parentName = subifaceMatch[1];
      const vlanId = parseInt(subifaceMatch[2], 10);
      const parent = device.interfaces.find(i => i.name.toLowerCase() === parentName.toLowerCase());
      
      if (parent) {
        const exists = device.interfaces.find(i => i.name.toLowerCase() === canonicalName.toLowerCase());
        if (!exists) {
          device.interfaces.push({
            id: device.id + '-sub-' + parentName.replace(/\//g, '-') + '-' + vlanId,
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
          });
          stateChanged = true;
        }
      }
    }
    
    // Auto-create SVI (Switch Virtual Interface)
    if (vlanMatch && device) {
      const vlanNum = parseInt(vlanMatch[1], 10);
      const exists = device.interfaces.find(i => i.name.toLowerCase() === canonicalName.toLowerCase());
      if (!exists) {
        // For switches, check if VLAN exists
        if (device.type === 'switch' && device.vlanDatabase) {
          const vlan = device.vlanDatabase.find(v => v.id === vlanNum);
          if (!vlan) {
            output = '% VLAN ' + vlanNum + ' does not exist';
          }
        }
        
        if (!output) {
          device.interfaces.push({
            id: device.id + '-vlan' + vlanNum,
            name: canonicalName,
            ip: null,
            subnetMask: null,
            mac: generateMAC(),
            status: 'down',
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
          });
          stateChanged = true;
        }
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
  } else if (cmd === 'ip routing') {
    if (device && device.type === 'switch') {
      device.ipRouting = true;
      stateChanged = true;
    }
  } else if (cmd === 'no ip routing') {
    if (device) {
      device.ipRouting = false;
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
  } else if (cmd.startsWith('router ospf ')) {
    const processId = parseInt(cmd.split(' ')[2], 10);
    if (device && device.type === 'router') {
      if (!device.ospfProcess) {
        device.ospfProcess = {
          processId,
          routerId: getHighestIP(device) || '0.0.0.0',
          areas: new Map([['0', { areaId: '0', lsas: new Map(), transitCapability: false, stubArea: false, defaultCost: 1 }]]),
          interfaces: new Map(),
          lsdb: new Map(),
          neighbors: new Map(),
          isActive: true,
          passiveInterfaces: new Set(),
          defaultOriginate: false,
        };
        device.ospfConfig = {
          processId,
          routerId: device.ospfProcess.routerId,
          networks: [],
          passiveInterfaces: [],
          defaultOriginate: false,
        };
      }
      parserState.mode = 'router';
      parserState.configTarget = `ospf-${processId}`;
      stateChanged = true;
    } else {
      output = '% OSPF can only be configured on routers';
    }
  } else if (cmd === 'no router ospf') {
    if (device) {
      device.ospfProcess = null;
      device.ospfConfig = null;
      device.routingTable = (device.routingTable || []).filter(r => r.protocol !== 'O');
      stateChanged = true;
    }
  } else if (cmd.startsWith('access-list ')) {
    // Parse access-list command
    const parts = original.split(/\s+/);
    if (parts.length >= 4 && device) {
      const aclNum = parts[1];
      const action = parts[2];
      const aclType = (parseInt(aclNum) >= 1 && parseInt(aclNum) <= 99) || 
                      (parseInt(aclNum) >= 1300 && parseInt(aclNum) <= 1999) ? 'standard' : 'extended';
      
      if (!device.acls) device.acls = new Map();
      
      let acl = device.acls.get(aclNum);
      if (!acl) {
        acl = { name: aclNum, type: aclType, entries: [] };
        device.acls.set(aclNum, acl);
      }
      
      // Generate sequence number
      let sequence = 10;
      if (acl.entries.length > 0) {
        const maxSeq = Math.max(...acl.entries.map(e => e.sequence));
        sequence = maxSeq + 10;
      }
      
      // Parse source
      let source, sourceWildcard;
      if (aclType === 'standard') {
        const src = parts[3];
        if (src.toLowerCase() === 'any') {
          source = 'any';
          sourceWildcard = '255.255.255.255';
        } else if (src.toLowerCase() === 'host') {
          source = parts[4] || '';
          sourceWildcard = '0.0.0.0';
        } else {
          source = src;
          sourceWildcard = parts[4] || '0.0.0.0';
        }
      } else {
        // Extended ACL - simplified
        source = parts[4] || 'any';
        sourceWildcard = parts[5] || '0.0.0.0';
      }
      
      acl.entries.push({
        sequence,
        action,
        protocol: aclType === 'extended' ? parts[3] : undefined,
        source,
        sourceWildcard,
      });
      
      // Sort by sequence
      acl.entries.sort((a, b) => a.sequence - b.sequence);
      stateChanged = true;
    }
  } else if (cmd === 'no access-list') {
    const aclNum = cmd.split(' ')[2];
    if (device && device.acls) {
      // Remove ACL applications
      if (device.aclApplications) {
        for (const [ifaceName, app] of device.aclApplications) {
          if (app.aclName === aclNum) {
            device.aclApplications.delete(ifaceName);
          }
        }
      }
      device.acls.delete(aclNum);
      stateChanged = true;
    }
  } else if (cmd.startsWith('ip access-list ')) {
    const parts = original.split(/\s+/);
    if (parts.length >= 3 && device) {
      const aclType = parts[2]; // standard or extended
      const aclName = parts[3];
      
      if (!device.acls) device.acls = new Map();
      
      if (!device.acls.has(aclName)) {
        device.acls.set(aclName, { name: aclName, type: aclType, entries: [] });
      }
      
      parserState.mode = 'acl';
      parserState.configTarget = aclName;
      stateChanged = true;
    }
  } else if (cmd.startsWith('no ip access-list ')) {
    const parts = original.split(/\s+/);
    if (parts.length >= 4 && device) {
      const aclName = parts[3];
      if (device.acls) {
        // Remove ACL applications
        if (device.aclApplications) {
          for (const [ifaceName, app] of device.aclApplications) {
            if (app.aclName === aclName) {
              device.aclApplications.delete(ifaceName);
            }
          }
        }
        device.acls.delete(aclName);
        stateChanged = true;
      }
    }
  } else if (cmd.startsWith('show access-lists')) {
    const aclName = cmd.split(' ')[2];
    output = showAccessLists(device, aclName);
  } else if (cmd.startsWith('show ip access-lists')) {
    const aclName = cmd.split(' ')[3];
    output = showIPAccessLists(device, aclName);
  } else if (cmd === 'exit' && parserState.mode === 'acl') {
    parserState.mode = 'config';
    parserState.configTarget = null;
  } else if (cmd.startsWith('router ospf ')) {
    const processId = parseInt(cmd.split(' ')[2], 10);
    if (device && device.type === 'router') {
      if (!device.ospfProcess) {
        device.ospfProcess = {
          processId,
          routerId: device.interfaces.find(i => i.ip && !i.isShutdown)?.ip || '0.0.0.0',
          networks: [],
          interfaces: new Map(),
          neighbors: new Map(),
          lsdb: new Map(),
          areas: new Map([['0', { id: '0', type: 'normal', lsas: new Map() }]]),
          passiveInterfaces: new Set(),
          defaultOriginate: false,
          referenceBandwidth: 100,
        };
      }
      parserState.mode = 'router';
      parserState.configTarget = `ospf-${processId}`;
      stateChanged = true;
    } else {
      output = '% OSPF can only be configured on routers';
    }
  } else if (cmd === 'no router ospf') {
    if (device) {
      device.ospfProcess = null;
      device.ospfConfig = null;
      device.routingTable = (device.routingTable || []).filter(r => r.protocol !== 'O');
      stateChanged = true;
    }
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
        const MAX_TRUNK_VLANS = 256; // Reasonable limit to prevent memory issues
        const vlanIds = [];
        for (const part of vlansStr.split(',')) {
          if (vlanIds.length >= MAX_TRUNK_VLANS) break;
          if (part.includes('-')) {
            const [start, end] = part.split('-').map(Number);
            for (let v = start; v <= end && v <= 4094 && vlanIds.length < MAX_TRUNK_VLANS; v++) vlanIds.push(v);
          } else {
            const v = parseInt(part, 10);
            if (v >= 1 && v <= 4094) vlanIds.push(v);
          }
        }
        iface.trunkVlans = vlanIds;
      }
      stateChanged = true;
    }
  } else if (cmd.startsWith('ip ospf cost ') && ifaceName && device) {
    const cost = parseInt(cmd.split(' ')[3], 10);
    if (device.ospfProcess) {
      const ospfIface = device.ospfProcess.interfaces.get(ifaceName);
      if (ospfIface) {
        ospfIface.cost = cost;
        stateChanged = true;
      }
    }
  } else if (cmd.startsWith('ip ospf priority ') && ifaceName && device) {
    const priority = parseInt(cmd.split(' ')[3], 10);
    if (device.ospfProcess) {
      const ospfIface = device.ospfProcess.interfaces.get(ifaceName);
      if (ospfIface) {
        ospfIface.priority = priority;
        stateChanged = true;
      }
    }
  } else if (cmd.startsWith('ip ospf hello-interval ') && ifaceName && device) {
    const interval = parseInt(cmd.split(' ')[3], 10);
    if (device.ospfProcess) {
      const ospfIface = device.ospfProcess.interfaces.get(ifaceName);
      if (ospfIface) {
        ospfIface.helloInterval = interval;
        ospfIface.deadInterval = interval * 4;
        stateChanged = true;
      }
    }
  } else if (cmd.startsWith('ip ospf dead-interval ') && ifaceName && device) {
    const interval = parseInt(cmd.split(' ')[3], 10);
    if (device.ospfProcess) {
      const ospfIface = device.ospfProcess.interfaces.get(ifaceName);
      if (ospfIface) {
        ospfIface.deadInterval = interval;
        stateChanged = true;
      }
    }
  } else if (cmd.startsWith('encapsulation dot1q ') && ifaceName && device) {
    const vlanId = parseInt(cmd.split(' ')[2], 10);
    const iface = device.interfaces.find(i => i.name.toLowerCase() === ifaceName.toLowerCase());
    if (iface) {
      iface.encapsulation = vlanId;
      stateChanged = true;
    }
  } else if (cmd.startsWith('ip access-group ') && ifaceName && device) {
    const parts = cmd.split(' ');
    const aclName = parts[2];
    const direction = parts[3];
    if (!device.aclApplications) device.aclApplications = new Map();
    device.aclApplications.set(ifaceName, { aclName, direction });
    stateChanged = true;
  } else if (cmd === 'no ip access-group' && ifaceName && device) {
    if (device.aclApplications) {
      device.aclApplications.delete(ifaceName);
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
    const entries = (device.arpTable instanceof Map) ? Array.from(device.arpTable.entries()) : (Array.isArray(device.arpTable) ? device.arpTable : []);
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
  const entries = (device.macTable instanceof Map) ? Array.from(device.macTable.entries()) : (Array.isArray(device.macTable) ? device.macTable : []);
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

// ============================================================================
// OSPF Show Functions
// ============================================================================

function showOSPFProcess(device) {
  if (!device || !device.ospfProcess) return 'OSPF not enabled\n';
  const proc = device.ospfProcess;
  let output = 'Routing Process "ospf ' + proc.processId + '" with ID ' + proc.routerId + '\n';
  output += 'Supports only single TOS(TOS0) routes\n';
  output += 'Supports opaque LSA\n';
  output += 'It is an area border router\n';
  output += 'SPF schedule delay 5 secs, Hold time between two SPFs 10 secs\n';
  output += 'Minimum LSA interval 5 secs\n';
  output += 'Number of areas in this router is ' + (proc.areas ? proc.areas.size : 0) + '. 1 normal 0 stub 0 nssa\n';
  output += 'External flood list length 0\n';
  return output;
}

function showOSPFNeighbors(device) {
  if (!device || !device.ospfProcess || !device.ospfProcess.neighbors) {
    return '% No OSPF neighbors\n';
  }
  const neighbors = Array.from(device.ospfProcess.neighbors.values());
  if (neighbors.length === 0) return '% No OSPF neighbors\n';
  
  let output = '\nNeighbor ID     Pri   State           Dead Time   Address         Interface\n';
  for (const neighbor of neighbors) {
    const deadTime = Math.max(0, Math.floor((Date.now() - (neighbor.lastHello || 0)) / 1000));
    output += neighbor.neighborId.padEnd(15) + ' ';
    output += String(neighbor.priority || 1).padStart(3) + ' ';
    output += (neighbor.state || 'Down').padEnd(15) + ' ';
    output += String(40 - deadTime).padStart(11) + ' ';
    output += (neighbor.neighborIp || '0.0.0.0').padEnd(15) + ' ';
    output += (neighbor.interface || 'Unknown') + '\n';
  }
  return output;
}

function showOSPFInterface(device) {
  if (!device || !device.ospfProcess || !device.ospfProcess.interfaces) {
    return '% OSPF not enabled\n';
  }
  let output = '';
  for (const [name, ospfIface] of device.ospfProcess.interfaces) {
    const iface = device.interfaces.find(i => i.name === name);
    if (!iface) continue;
    const prefixLen = iface.subnetMask ? getPrefixLength(iface.subnetMask) : 0;
    output += name + ' is ' + (iface.status === 'up' ? 'up' : 'down') + ', line protocol is ' + (iface.status === 'up' ? 'up' : 'down') + '\n';
    output += '  Internet Address ' + (iface.ip || '0.0.0.0') + '/' + prefixLen + ', Area ' + ospfIface.areaId + '\n';
    output += '  Process ID ' + device.ospfProcess.processId + ', Router ID ' + device.ospfProcess.routerId + ', Network Type BROADCAST, Cost: ' + (ospfIface.cost || 10) + '\n';
    output += '  Transmit Delay is 1 sec, State ' + (ospfIface.state || 'DR') + ', Priority ' + (ospfIface.priority || 1) + '\n';
    output += '  Designated Router (ID) ' + (ospfIface.dr || '0.0.0.0') + '\n';
    output += '  Backup Designated router (ID) ' + (ospfIface.bdr || '0.0.0.0') + '\n';
    output += '  Timer intervals configured, Hello ' + (ospfIface.helloInterval || 10) + ', Dead ' + (ospfIface.deadInterval || 40) + '\n';
    output += '  Neighbor Count is ' + (ospfIface.neighbors ? ospfIface.neighbors.size : 0) + '\n';
    output += '\n';
  }
  return output || '% No OSPF interfaces\n';
}

function showOSPFDatabase(device) {
  if (!device || !device.ospfProcess || !device.ospfProcess.lsdb) {
    return '% OSPF not enabled\n';
  }
  let output = '\n            OSPF Router with ID (' + device.ospfProcess.routerId + ') (Process ID ' + device.ospfProcess.processId + ')\n\n';
  output += '                Router Link States (Area 0)\n\n';
  output += 'Link ID         ADV Router      Age         Seq#       Checksum Link count\n';
  for (const [key, lsa] of device.ospfProcess.lsdb) {
    const age = Math.floor((Date.now() - (lsa.header.lsSequenceNumber || 0)) / 1000) % 3600;
    output += (lsa.header.lsId || '').padEnd(15) + ' ';
    output += (lsa.header.advertisingRouter || '').padEnd(15) + ' ';
    output += String(age).padStart(11) + ' ';
    output += '0x' + (lsa.header.lsSequenceNumber || 0).toString(16).padStart(8, '0') + ' ';
    output += '0x0000 ';
    output += (lsa.links ? lsa.links.length : 0) + '\n';
  }
  return output;
}

function showOSPFRoutes(device) {
  if (!device || !device.routingTable) return '% No routes\n';
  const ospfRoutes = device.routingTable.filter(r => r.protocol === 'O');
  if (ospfRoutes.length === 0) return '% No OSPF routes\n';
  
  let output = 'Codes: L - local, C - connected, S - static, R - RIP, M - mobile, B - BGP\n';
  output += '       D - EIGRP, EX - EIGRP external, O - OSPF, IA - OSPF inter area\n\n';
  for (const route of ospfRoutes) {
    const cidr = getPrefixLength(route.mask);
    if (route.nextHop) {
      output += 'O    ' + route.network + '/' + cidr + ' [110/' + route.metric + '] via ' + route.nextHop + ', ' + (route.interface || 'Unknown') + '\n';
    } else {
      output += 'O    ' + route.network + ' is directly connected, ' + (route.interface || 'Unknown') + '\n';
    }
  }
  return output;
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

    // Check inbound ACL on ingress interface
    if (srcIface && srcIface.ip) {
      if (!checkACL(currentDevice, srcIface.name, srcIface.ip, targetIP, 'ip', 'in')) {
        return false; // Denied by inbound ACL
      }
    }

    let outIface;
    if (bestRoute.interface) {
      outIface = currentDevice.interfaces.find(i => i.name === bestRoute.interface);
    } else if (bestRoute.nextHop) {
      outIface = currentDevice.interfaces.find(i =>
        i.ip && i.subnetMask && isSameNetwork(i.ip, bestRoute.nextHop, i.subnetMask)
      );
    }

    if (!outIface || outIface.isShutdown || !outIface.connectedTo) return false;

    // Check outbound ACL on egress interface
    if (outIface.ip) {
      if (!checkACL(currentDevice, outIface.name, srcIface ? srcIface.ip || '' : '', targetIP, 'ip', 'out')) {
        return false; // Denied by outbound ACL
      }
    }

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

// ============================================================================
// OSPF Support (Added for CCNA readiness)
// ============================================================================

const OSPF_HELLO_INTERVAL = 10000; // 10 seconds in ms
const OSPF_DEAD_INTERVAL = 40000;  // 40 seconds in ms

// OSPF state tracking
const ospfState = new Map(); // deviceId -> { lastHello: {}, neighbors: {} }

// Start OSPF timer
setInterval(() => {
  runOSPFTick();
}, 1000); // Check every second

function runOSPFTick() {
  const now = Date.now();

  // Cleanup ospfState for removed devices to prevent memory leak
  const activeDeviceIds = new Set((topology.devices || []).filter(d => d.type === 'router' && d.ospfProcess).map(d => d.id));
  for (const deviceId of ospfState.keys()) {
    if (!activeDeviceIds.has(deviceId)) {
      ospfState.delete(deviceId);
    }
  }

  // Skip if no OSPF devices
  if (activeDeviceIds.size === 0) return;

  for (const device of topology.devices || []) {
    if (device.type !== 'router' || !device.ospfProcess) continue;

    const state = ospfState.get(device.id) || { lastHello: {}, neighbors: {} };

    // Process each OSPF interface
    for (const [ifaceName, ospfIface] of (device.ospfProcess.interfaces || new Map())) {
      const iface = device.interfaces.find(i => i.name === ifaceName);
      if (!iface || iface.isShutdown || !iface.ip) continue;
      
      // Skip passive interfaces
      if (device.ospfProcess.passiveInterfaces && 
          device.ospfProcess.passiveInterfaces.has(ifaceName)) continue;
      
      // Check dead timers
      for (const [neighborId, neighbor] of (ospfIface.neighbors || new Map())) {
        const elapsed = now - (neighbor.lastHello || 0);
        if (elapsed > OSPF_DEAD_INTERVAL) {
          // Neighbor is dead - remove it
          ospfIface.neighbors.delete(neighborId);
          if (device.ospfProcess.neighbors) {
            device.ospfProcess.neighbors.delete(neighborId);
          }
          
          // Re-run DR election if needed
          if (neighborId === ospfIface.dr || neighborId === ospfIface.bdr) {
            performDRElection(device, ifaceName);
          }
          
          // Regenerate LSA and run SPF
          generateRouterLSA(device);
          runSPF(device);
        }
      }
      
      // Send hello if interval elapsed
      const lastHello = state.lastHello[ifaceName] || 0;
      if (now - lastHello >= (ospfIface.helloInterval || 10) * 1000) {
        sendOSPFHello(device, iface, ospfIface);
        state.lastHello[ifaceName] = now;
      }
    }
    
    ospfState.set(device.id, state);
  }
}

function sendOSPFHello(device, iface, ospfIface) {
  // In real implementation, would queue packet for transmission
  // For simulation, we process directly on connected routers
  
  if (!iface.connectedTo) return;
  
  const parts = iface.connectedTo.split('/');
  const neighborDevId = parts[0];
  const neighborIfId = parts.slice(1).join('/');
  const neighborDev = topology.devices.find(d => d.id === neighborDevId);
  
  if (!neighborDev || neighborDev.type !== 'router' || !neighborDev.ospfProcess) return;
  
  const neighborIface = neighborDev.interfaces.find(i => i.id === neighborIfId);
  if (!neighborIface) return;
  
  const neighborOSPFIface = neighborDev.ospfProcess.interfaces.get(neighborIface.name);
  if (!neighborOSPFIface) return;
  
  // Process hello on neighbor
  processHelloOnNeighbor(neighborDev, neighborIface, neighborOSPFIface, device);
  
  // Also process hello response on us
  processHelloOnNeighbor(device, iface, ospfIface, neighborDev);
}

function processHelloOnNeighbor(neighborDev, neighborIface, neighborOSPFIface, senderDevice) {
  const senderRouterId = senderDevice.ospfProcess.routerId;
  const senderIP = neighborDev.interfaces.find(i => i.connectedTo && i.connectedTo.startsWith(senderDevice.id))?.ip;
  
  if (!senderIP) return;
  
  // Get or create neighbor entry
  let neighbor = neighborOSPFIface.neighbors.get(senderRouterId);
  
  if (!neighbor) {
    neighbor = {
      neighborId: senderRouterId,
      neighborIp: senderIP,
      state: 'Init',
      interface: neighborIface.name,
      priority: 1,
      dr: '0.0.0.0',
      bdr: '0.0.0.0',
      deadTime: 40,
      lastHello: Date.now(),
    };
    neighborOSPFIface.neighbors.set(senderRouterId, neighbor);
    neighborDev.ospfProcess.neighbors.set(senderRouterId, neighbor);
  } else {
    neighbor.lastHello = Date.now();
  }
  
  // State machine
  if (neighbor.state === 'Down') {
    neighbor.state = 'Init';
  }
  
  // Check if we see ourselves in neighbor's hello (simplified - always true for directly connected)
  if (neighbor.state === 'Init') {
    neighbor.state = '2-Way';
    performDRElection(neighborDev, neighborIface.name);
  }
  
  // Form full adjacency with DR/BDR
  if (neighbor.state === '2-Way') {
    const isDR = neighborOSPFIface.dr === neighborDev.ospfProcess.routerId;
    const isBDR = neighborOSPFIface.bdr === neighborDev.ospfProcess.routerId;
    const neighborIsDR = senderRouterId === neighborOSPFIface.dr;
    const neighborIsBDR = senderRouterId === neighborOSPFIface.bdr;
    
    if (isDR || isBDR || neighborIsDR || neighborIsBDR || neighborOSPFIface.dr === '0.0.0.0') {
      neighbor.state = 'Full';
      generateRouterLSA(neighborDev);
      runSPF(neighborDev);
    }
  }
}

function performDRElection(device, ifaceName) {
  const ospfIface = device.ospfProcess.interfaces.get(ifaceName);
  if (!ospfIface) return;
  
  const candidates = [
    { routerId: device.ospfProcess.routerId, priority: ospfIface.priority }
  ];
  
  for (const neighbor of ospfIface.neighbors.values()) {
    candidates.push({ routerId: neighbor.neighborId, priority: neighbor.priority });
  }
  
  const eligible = candidates.filter(c => c.priority > 0);
  eligible.sort((a, b) => b.priority - a.priority || ipToLong(b.routerId) - ipToLong(a.routerId));
  
  const newDR = eligible[0]?.routerId || '0.0.0.0';
  const newBDR = eligible[1]?.routerId || '0.0.0.0';
  
  ospfIface.dr = newDR;
  ospfIface.bdr = newBDR;
  
  if (newDR === device.ospfProcess.routerId) {
    ospfIface.state = 'DR';
  } else if (newBDR === device.ospfProcess.routerId) {
    ospfIface.state = 'BDR';
  } else {
    ospfIface.state = 'DROther';
  }
}

function generateRouterLSA(device) {
  if (!device.ospfProcess) return;
  
  const links = [];
  
  for (const [ifaceName, ospfIface] of device.ospfProcess.interfaces) {
    const iface = device.interfaces.find(i => i.name === ifaceName);
    if (!iface || iface.isShutdown || !iface.ip) continue;
    
    // Add transit links for full neighbors
    // RFC 2328 §A.4.2: linkId = IP address of DR on the network
    const networkAddr = (iface.ip && iface.subnetMask) ? applySubnetMask(iface.ip, iface.subnetMask) : null;
    for (const neighbor of ospfIface.neighbors.values()) {
      if (neighbor.state === 'Full') {
        links.push({
          linkId: networkAddr || ospfIface.dr || iface.ip,
          linkData: iface.ip,
          type: 2,
          metric: ospfIface.cost || 10,
        });
        break;
      }
    }

    // Add stub network if no full neighbors
    // RFC 2328 §A.4.3: linkId = network address (ip AND mask)
    const hasFull = Array.from(ospfIface.neighbors.values()).some(n => n.state === 'Full');
    if (!hasFull && iface.ip && iface.subnetMask) {
      links.push({
        linkId: applySubnetMask(iface.ip, iface.subnetMask),
        linkData: iface.subnetMask,
        type: 3,
        metric: ospfIface.cost || 10,
      });
    }
  }
  
  const lsa = {
    header: {
      lsType: 1,
      lsId: device.ospfProcess.routerId,
      advertisingRouter: device.ospfProcess.routerId,
      lsSequenceNumber: Date.now(),
      lsAge: 0,
      checksum: 0,
      length: 0,
    },
    v: false,
    e: device.ospfProcess.defaultOriginate || false,
    b: device.ospfProcess.areas && device.ospfProcess.areas.size > 1,
    links,
  };
  
  const key = `1-${device.ospfProcess.routerId}-${device.ospfProcess.routerId}`;
  device.ospfProcess.lsdb = device.ospfProcess.lsdb || new Map();
  device.ospfProcess.lsdb.set(key, lsa);
  
  // Also store in area
  const area = device.ospfProcess.areas.get('0');
  if (area) {
    area.lsas = area.lsas || new Map();
    area.lsas.set(key, lsa);
  }
  
  // Flood LSA to neighbors
  floodLSA(device, lsa);
}

function floodLSA(device, lsa) {
  // In a real implementation, would queue for transmission
  // For simulation, we directly update neighbor LSDBs
  
  for (const ospfIface of (device.ospfProcess.interfaces || new Map()).values()) {
    for (const neighbor of (ospfIface.neighbors || new Map()).values()) {
      if (neighbor.state !== 'Full') continue;
      
      // Find the neighbor device
      const neighborDev = topology.devices.find(d => d.ospfProcess && d.ospfProcess.routerId === neighbor.neighborId);
      if (!neighborDev || !neighborDev.ospfProcess) continue;
      
      // Update neighbor's LSDB
      const key = `1-${lsa.header.lsId}-${lsa.header.advertisingRouter}`;
      neighborDev.ospfProcess.lsdb = neighborDev.ospfProcess.lsdb || new Map();
      neighborDev.ospfProcess.lsdb.set(key, lsa);
      
      const area = neighborDev.ospfProcess.areas.get('0');
      if (area) {
        area.lsas = area.lsas || new Map();
        area.lsas.set(key, lsa);
      }
      
      // Trigger SPF on neighbor
      runSPF(neighborDev);
    }
  }
}

// Min-heap for O(log n) Dijkstra extract-min
class SPFMinHeap {
  constructor() { this.heap = []; }
  push(node) {
    this.heap.push(node);
    let i = this.heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.heap[parent].distance <= this.heap[i].distance) break;
      [this.heap[parent], this.heap[i]] = [this.heap[i], this.heap[parent]];
      i = parent;
    }
  }
  pop() {
    if (this.heap.length === 0) return null;
    const min = this.heap[0];
    const last = this.heap.pop();
    if (this.heap.length > 0 && last) {
      this.heap[0] = last;
      let i = 0;
      while (true) {
        let smallest = i;
        const l = 2 * i + 1, r = 2 * i + 2;
        if (l < this.heap.length && this.heap[l].distance < this.heap[smallest].distance) smallest = l;
        if (r < this.heap.length && this.heap[r].distance < this.heap[smallest].distance) smallest = r;
        if (smallest === i) break;
        [this.heap[smallest], this.heap[i]] = [this.heap[i], this.heap[smallest]];
        i = smallest;
      }
    }
    return min;
  }
  get size() { return this.heap.length; }
}

function runSPF(device) {
  if (!device.ospfProcess) return;

  const heap = new SPFMinHeap();
  const visited = new Map();
  const bestDist = new Map(); // track best known distance per routerId

  const startNode = {
    routerId: device.ospfProcess.routerId,
    distance: 0,
    parent: null,
    interface: null,
  };
  heap.push(startNode);
  bestDist.set(startNode.routerId, 0);

  while (heap.size > 0) {
    const current = heap.pop();
    if (!current) break;

    // Skip if already visited (stale entry in heap)
    if (visited.has(current.routerId)) continue;
    visited.set(current.routerId, current);

    const key = `1-${current.routerId}-${current.routerId}`;
    const lsa = device.ospfProcess.lsdb?.get(key);
    if (!lsa) continue;

    for (const link of lsa.links || []) {
      if (link.type === 1 || link.type === 2) {
        const neighborId = link.linkId;
        if (!visited.has(neighborId)) {
          const newDist = current.distance + link.metric;
          const known = bestDist.get(neighborId);
          if (known === undefined || newDist < known) {
            bestDist.set(neighborId, newDist);
            heap.push({
              routerId: neighborId,
              distance: newDist,
              parent: current.routerId,
              interface: null,
            });
          }
        }
      }
    }
  }

  installOSPFRoutes(device, visited);
}

function installOSPFRoutes(device, spfTree) {
  // Remove existing OSPF routes
  device.routingTable = (device.routingTable || []).filter(r => r.protocol !== 'O');
  
  for (const [routerId, node] of spfTree) {
    if (routerId === device.ospfProcess.routerId) continue;
    
    const key = `1-${routerId}-${routerId}`;
    const lsa = device.ospfProcess.lsdb?.get(key);
    if (!lsa) continue;
    
    // Find outgoing interface
    let outInterface = null;
    let nextHop = null;
    
    // Trace back to find first hop
    let current = node;
    while (current.parent && current.parent !== device.ospfProcess.routerId) {
      const parent = spfTree.get(current.parent);
      if (!parent) break;
      current = parent;
    }
    
    // Find interface to reach the first hop
    for (const [ifaceName, ospfIface] of (device.ospfProcess.interfaces || new Map())) {
      const neighbor = ospfIface.neighbors.get(current.routerId);
      if (neighbor && neighbor.state === 'Full') {
        outInterface = ifaceName;
        nextHop = neighbor.neighborIp;
        break;
      }
    }
    
    // Add stub network routes
    for (const link of lsa.links || []) {
      if (link.type === 3) {
        const exists = device.routingTable.some(r => r.network === link.linkId && r.mask === link.linkData);
        if (!exists) {
          device.routingTable.push({
            network: link.linkId,
            mask: link.linkData,
            nextHop,
            interface: outInterface,
            protocol: 'O',
            metric: node.distance + link.metric,
            isLocal: false,
          });
        }
      }
    }
  }
  
  // Add default route if default-originate is enabled
  if (device.ospfProcess.defaultOriginate) {
    for (const [key, lsa] of (device.ospfProcess.lsdb || new Map())) {
      if (lsa.e && lsa.header.advertisingRouter !== device.ospfProcess.routerId) {
        const asbrNode = spfTree.get(lsa.header.advertisingRouter);
        if (asbrNode) {
          let nextHop = null;
          for (const [ifaceName, ospfIface] of (device.ospfProcess.interfaces || new Map())) {
            const neighbor = ospfIface.neighbors.get(lsa.header.advertisingRouter);
            if (neighbor && neighbor.state === 'Full') {
              nextHop = neighbor.neighborIp;
              break;
            }
          }
          
          device.routingTable.push({
            network: '0.0.0.0',
            mask: '0.0.0.0',
            nextHop,
            interface: asbrNode.interface,
            protocol: 'O',
            metric: asbrNode.distance + 1,
            isLocal: false,
          });
          break;
        }
      }
    }
  }
}

// Initialize OSPF fields on device creation
const originalCreateDevice = self.createDevice;
self.createDevice = function(type, name, position) {
  const device = originalCreateDevice ? originalCreateDevice(type, name, position) : {
    id: Math.random().toString(36).substr(2, 9),
    name,
    type,
    interfaces: generateInterfaces(type),
    position,
    macTable: new Map(),
    arpTable: new Map(),
    routingTable: [],
    isRunning: true,
    startupConfig: [],
    runningConfig: [],
    vlans: type === 'switch' ? new Map([[1, { id: 1, name: 'default', interfaces: [] }]]) : new Map(),
    vlanDatabase: type === 'switch' ? [{ id: 1, name: 'default', interfaces: [] }] : [],
  };
  
  device.ospfProcess = null;
  device.ospfConfig = null;
  
  return device;
};


// ============================================================================
// OSPF Router Configuration Commands
// ============================================================================

function processRouterCommand(cmd, original, device, parserState) {
  let output = '';
  let stateChanged = false;

  if (cmd === 'end') {
    parserState.mode = 'privileged';
    parserState.configTarget = null;
  } else if (cmd === 'exit') {
    parserState.mode = 'config';
    parserState.configTarget = null;
  } else if (cmd.startsWith('network ')) {
    const parts = original.split(/\s+/);
    if (parts.length >= 5 && parts[3] === 'area') {
      const network = parts[1];
      const wildcard = parts[2];
      const area = parts[4];
      
      if (device && device.ospfProcess) {
        device.ospfProcess.areas.set(area, { areaId: area, lsas: new Map(), transitCapability: false, stubArea: false, defaultCost: 1 });
        
        // Activate OSPF on matching interfaces
        for (const iface of device.interfaces) {
          if (iface.ip && matchesNetwork(iface.ip, network, wildcard)) {
            device.ospfProcess.interfaces.set(iface.name, {
              interfaceName: iface.name,
              areaId: area,
              state: 'Waiting',
              cost: 10,
              helloInterval: 10,
              deadInterval: 40,
              priority: 1,
              dr: '0.0.0.0',
              bdr: '0.0.0.0',
              neighbors: new Map(),
            });
          }
        }
        
        if (device.ospfConfig) {
          device.ospfConfig.networks.push({ network, wildcard, area });
        }
        stateChanged = true;
      }
    }
  } else if (cmd.startsWith('no network ')) {
    const parts = original.split(/\s+/);
    if (parts.length >= 4) {
      const network = parts[2];
      const wildcard = parts[3];
      if (device && device.ospfConfig) {
        device.ospfConfig.networks = device.ospfConfig.networks.filter(n => n.network !== network || n.wildcard !== wildcard);
        stateChanged = true;
      }
    }
  } else if (cmd.startsWith('router-id ')) {
    const routerId = cmd.split(' ')[1];
    if (device && device.ospfProcess) {
      device.ospfProcess.routerId = routerId;
      if (device.ospfConfig) device.ospfConfig.routerId = routerId;
      stateChanged = true;
    }
  } else if (cmd.startsWith('passive-interface ')) {
    const ifaceName = original.split(' ').slice(1).join(' ');
    if (device && device.ospfProcess) {
      device.ospfProcess.passiveInterfaces.add(ifaceName);
      if (device.ospfConfig) device.ospfConfig.passiveInterfaces.push(ifaceName);
      stateChanged = true;
    }
  } else if (cmd.startsWith('no passive-interface ')) {
    const ifaceName = original.split(' ').slice(2).join(' ');
    if (device && device.ospfProcess) {
      device.ospfProcess.passiveInterfaces.delete(ifaceName);
      if (device.ospfConfig) {
        device.ospfConfig.passiveInterfaces = device.ospfConfig.passiveInterfaces.filter(i => i !== ifaceName);
      }
      stateChanged = true;
    }
  } else if (cmd === 'default-information originate') {
    if (device && device.ospfProcess) {
      device.ospfProcess.defaultOriginate = true;
      if (device.ospfConfig) device.ospfConfig.defaultOriginate = true;
      stateChanged = true;
    }
  } else if (cmd === 'no default-information originate') {
    if (device && device.ospfProcess) {
      device.ospfProcess.defaultOriginate = false;
      if (device.ospfConfig) device.ospfConfig.defaultOriginate = false;
      stateChanged = true;
    }
  } else {
    output = '% Invalid input detected.';
  }

  return { output, stateChanged };
}

// Helper functions for OSPF
function getHighestIP(device) {
  let highest = 0;
  let highestIP = null;
  for (const iface of device.interfaces) {
    if (iface.ip) {
      const ipVal = ipToLong(iface.ip);
      if (ipVal > highest) {
        highest = ipVal;
        highestIP = iface.ip;
      }
    }
  }
  return highestIP;
}

function matchesNetwork(ip, network, wildcard) {
  const ipVal = ipToLong(ip);
  const netVal = ipToLong(network);
  const wildVal = ipToLong(wildcard);
  const maskVal = (~wildVal) >>> 0;
  return ((ipVal & maskVal) >>> 0) === ((netVal & maskVal) >>> 0);
}

// Generate interfaces helper (for OSPF init)
function generateInterfaces(type) {
  const interfaces = [];
  if (type === 'router') {
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        interfaces.push({
          id: 'router-' + Math.random().toString(36).substr(2, 9) + '-' + i + '/' + j,
          name: `GigabitEthernet${i}/${j}`,
          ip: null,
          subnetMask: null,
          mac: generateMAC(),
          status: 'down',
          connectedTo: null,
          isShutdown: false,
          description: '',
          switchportMode: 'access',
          accessVlan: 0,
          trunkVlans: [],
          nativeVlan: 0,
        });
      }
    }
  } else {
    for (let i = 0; i < 4; i++) {
      interfaces.push({
        id: 'switch-' + Math.random().toString(36).substr(2, 9) + '-' + i,
        name: `FastEthernet0/${i}`,
        ip: null,
        subnetMask: null,
        mac: generateMAC(),
        status: 'down',
        connectedTo: null,
        isShutdown: false,
        description: '',
        switchportMode: 'access',
        accessVlan: 1,
        trunkVlans: [],
        nativeVlan: 1,
      });
    }
  }
  return interfaces;
}


// ============================================================================
// ACL Functions
// ============================================================================

function showAccessLists(device, name) {
  if (!device || !device.acls || device.acls.size === 0) {
    return '% No ACLs configured\n';
  }
  
  let output = '';
  const aclsToShow = name 
    ? [device.acls.get(name)].filter(Boolean)
    : Array.from(device.acls.values());
  
  if (name && aclsToShow.length === 0) {
    return '% ACL ' + name + ' not found\n';
  }
  
  for (const acl of aclsToShow) {
    output += (acl.type === 'standard' ? 'Standard' : 'Extended') + ' IP access list ' + acl.name + '\n';
    
    for (const entry of (acl.entries || [])) {
      output += '    ' + entry.sequence + ' ' + entry.action;
      
      if (entry.protocol && entry.protocol !== 'ip') {
        output += ' ' + entry.protocol;
      }
      
      // Source
      if (entry.source === 'any') {
        output += ' any';
      } else if (entry.sourceWildcard === '0.0.0.0') {
        output += ' host ' + entry.source;
      } else {
        output += ' ' + entry.source + ' ' + entry.sourceWildcard;
      }
      
      // Destination (for extended)
      if (entry.destination) {
        if (entry.destination === 'any') {
          output += ' any';
        } else if (entry.destWildcard === '0.0.0.0') {
          output += ' host ' + entry.destination;
        } else {
          output += ' ' + entry.destination + ' ' + entry.destWildcard;
        }
      }
      
      output += '\n';
    }
    
    output += '\n';
  }
  
  return output;
}

function showIPAccessLists(device, name) {
  return showAccessLists(device, name);
}

// Check if packet matches ACL entry
function matchesACE(entry, srcIP, dstIP, protocol) {
  // Check source
  if (entry.source !== 'any' && !ipMatchesWildcard(srcIP, entry.source, entry.sourceWildcard)) {
    return false;
  }
  
  // Check destination (for extended)
  if (entry.destination && entry.destination !== 'any') {
    if (!ipMatchesWildcard(dstIP, entry.destination, entry.destWildcard)) {
      return false;
    }
  }
  
  // Check protocol
  if (entry.protocol && entry.protocol !== 'ip') {
    // Simplified protocol matching
    if (entry.protocol === 'icmp' && protocol !== 'ICMP') return false;
    // TCP/UDP matching would need more detailed payload inspection
  }
  
  return true;
}

function ipMatchesWildcard(ip, network, wildcard) {
  const ipVal = ipToLong(ip);
  const netVal = ipToLong(network);
  const wildVal = ipToLong(wildcard);
  const maskVal = (~wildVal) >>> 0;
  return ((ipVal & maskVal) >>> 0) === ((netVal & maskVal) >>> 0);
}

// Check packet against ACL applied to interface
function checkACL(device, interfaceName, srcIP, dstIP, protocol, direction) {
  if (!device.aclApplications) return true; // Permit if no ACLs
  
  const app = device.aclApplications.get(interfaceName);
  if (!app || app.direction !== direction) return true; // Permit if no ACL in this direction
  
  const acl = device.acls.get(app.aclName);
  if (!acl) return true;
  
  // Check entries in order
  for (const entry of (acl.entries || [])) {
    if (matchesACE(entry, srcIP, dstIP, protocol)) {
      return entry.action === 'permit';
    }
  }
  
  // Implicit deny
  return false;
}
