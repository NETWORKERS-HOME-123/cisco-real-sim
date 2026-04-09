/**
 * Cisco-like CLI Parser
 * Hierarchical command parser with mode support
 */

import {
  CLIMode,
  CLIParseResult,
  CLIAction,
  CLIParserState,
  Interface,
} from '../types';

// ============================================================================
// Command Definitions
// ============================================================================

interface CommandDef {
  pattern: string;
  minArgs: number;
  maxArgs: number;
  allowedModes: CLIMode[];
  action: (args: string[]) => CLIAction;
  description: string;
}

const COMMAND_DEFINITIONS: CommandDef[] = [
  // User EXEC mode commands
  {
    pattern: 'enable',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['user'],
    action: () => ({ type: 'ENABLE', params: {} }),
    description: 'Enter privileged EXEC mode',
  },
  {
    pattern: 'disable',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['privileged', 'config', 'interface'],
    action: () => ({ type: 'DISABLE', params: {} }),
    description: 'Exit to user EXEC mode',
  },
  {
    pattern: 'exit',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['user', 'privileged', 'config'],
    action: () => ({ type: 'EXIT', params: {} }),
    description: 'Exit current mode',
  },
  {
    pattern: 'logout',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['user', 'privileged'],
    action: () => ({ type: 'LOGOUT', params: {} }),
    description: 'Exit session',
  },
  {
    pattern: 'help',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['user', 'privileged', 'config', 'interface'],
    action: () => ({ type: 'HELP', params: {} }),
    description: 'Show help',
  },
  {
    pattern: 'show version',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['user', 'privileged'],
    action: () => ({ type: 'SHOW_VERSION', params: {} }),
    description: 'Show system version',
  },
  {
    pattern: 'show running-config',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['privileged'],
    action: () => ({ type: 'SHOW_RUNNING_CONFIG', params: {} }),
    description: 'Show running configuration',
  },
  {
    pattern: 'show startup-config',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['privileged'],
    action: () => ({ type: 'SHOW_STARTUP_CONFIG', params: {} }),
    description: 'Show startup configuration',
  },
  {
    pattern: 'show ip interface brief',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['privileged'],
    action: () => ({ type: 'SHOW_IP_INTERFACE_BRIEF', params: {} }),
    description: 'Show IP interface brief',
  },
  {
    pattern: 'show ip interface',
    minArgs: 0,
    maxArgs: 1,
    allowedModes: ['privileged'],
    action: (args) => ({ type: 'SHOW_IP_INTERFACE', params: { interface: args[0] } }),
    description: 'Show IP interface details',
  },
  {
    pattern: 'show interfaces',
    minArgs: 0,
    maxArgs: 1,
    allowedModes: ['privileged'],
    action: (args) => ({ type: 'SHOW_INTERFACES', params: { interface: args[0] } }),
    description: 'Show interface details',
  },
  {
    pattern: 'show ip route',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['privileged'],
    action: () => ({ type: 'SHOW_IP_ROUTE', params: {} }),
    description: 'Show IP routing table',
  },
  {
    pattern: 'show arp',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['privileged'],
    action: () => ({ type: 'SHOW_ARP', params: {} }),
    description: 'Show ARP table',
  },
  {
    pattern: 'show mac address-table',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['privileged'],
    action: () => ({ type: 'SHOW_MAC_TABLE', params: {} }),
    description: 'Show MAC address table',
  },
  {
    pattern: 'show cdp neighbors',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['privileged'],
    action: () => ({ type: 'SHOW_CDP_NEIGHBORS', params: {} }),
    description: 'Show CDP neighbor entries',
  },
  {
    pattern: 'ping',
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ['privileged'],
    action: (args) => ({ type: 'PING', params: { target: args[0] } }),
    description: 'Ping a destination',
  },
  {
    pattern: 'traceroute',
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ['privileged'],
    action: (args) => ({ type: 'TRACEROUTE', params: { target: args[0] } }),
    description: 'Trace route to destination',
  },
  
  // Clear commands
  {
    pattern: 'clear mac address-table dynamic',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['privileged'],
    action: () => ({ type: 'CLEAR_MAC_TABLE', params: {} }),
    description: 'Clear dynamic MAC address table entries',
  },
  {
    pattern: 'clear arp-cache',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['privileged'],
    action: () => ({ type: 'CLEAR_ARP_CACHE', params: {} }),
    description: 'Clear ARP cache',
  },

  // Config mode commands
  {
    pattern: 'configure terminal',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['privileged'],
    action: () => ({ type: 'CONFIGURE_TERMINAL', params: {} }),
    description: 'Enter configuration mode',
  },
  {
    pattern: 'hostname',
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ['config'],
    action: (args) => ({ type: 'HOSTNAME', params: { name: args[0] } }),
    description: 'Set hostname',
  },
  {
    pattern: 'enable secret',
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ['config'],
    action: (args) => ({ type: 'ENABLE_SECRET', params: { password: args[0] } }),
    description: 'Set enable secret password',
  },
  {
    pattern: 'enable password',
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ['config'],
    action: (args) => ({ type: 'ENABLE_PASSWORD', params: { password: args[0] } }),
    description: 'Set enable password',
  },
  {
    pattern: 'no enable secret',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['config'],
    action: () => ({ type: 'NO_ENABLE_SECRET', params: {} }),
    description: 'Remove enable secret',
  },
  {
    pattern: 'no enable password',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['config'],
    action: () => ({ type: 'NO_ENABLE_PASSWORD', params: {} }),
    description: 'Remove enable password',
  },
  {
    pattern: 'banner motd',
    minArgs: 1,
    maxArgs: 100,
    allowedModes: ['config'],
    action: (args) => ({ type: 'BANNER_MOTD', params: { text: args.join(' ') } }),
    description: 'Set message of the day banner',
  },
  {
    pattern: 'no banner motd',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['config'],
    action: () => ({ type: 'NO_BANNER_MOTD', params: {} }),
    description: 'Remove banner motd',
  },
  {
    pattern: 'interface',
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ['config'],
    action: (args) => ({ type: 'INTERFACE', params: { interface: args[0] } }),
    description: 'Enter interface configuration mode',
  },
  {
    pattern: 'ip route',
    minArgs: 3,
    maxArgs: 3,
    allowedModes: ['config'],
    action: (args) => ({
      type: 'IP_ROUTE',
      params: { network: args[0], mask: args[1], nextHop: args[2] },
    }),
    description: 'Add static route',
  },
  {
    pattern: 'no ip route',
    minArgs: 2,
    maxArgs: 3,
    allowedModes: ['config'],
    action: (args) => ({
      type: 'NO_IP_ROUTE',
      params: { network: args[0], mask: args[1], nextHop: args[2] },
    }),
    description: 'Remove static route',
  },
  {
    pattern: 'end',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['config', 'interface'],
    action: () => ({ type: 'END', params: {} }),
    description: 'Exit to privileged EXEC mode',
  },
  // OSPF configuration (config mode)
  {
    pattern: 'router ospf',
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ['config'],
    action: (args) => ({ type: 'ROUTER_OSPF', params: { processId: parseInt(args[0], 10) } }),
    description: 'Configure OSPF routing process',
  },
  {
    pattern: 'no router ospf',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['config'],
    action: () => ({ type: 'NO_ROUTER_OSPF', params: {} }),
    description: 'Remove OSPF routing process',
  },
  // OSPF router configuration mode commands
  {
    pattern: 'network',
    minArgs: 3,
    maxArgs: 3,
    allowedModes: ['router'],
    action: (args) => ({ 
      type: 'OSPF_NETWORK', 
      params: { network: args[0], wildcard: args[1], area: args[2] } 
    }),
    description: 'Enable OSPF on network (network wildcard area)',
  },
  {
    pattern: 'no network',
    minArgs: 2,
    maxArgs: 2,
    allowedModes: ['router'],
    action: (args) => ({ 
      type: 'NO_OSPF_NETWORK', 
      params: { network: args[0], wildcard: args[1] } 
    }),
    description: 'Remove OSPF from network',
  },
  {
    pattern: 'router-id',
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ['router'],
    action: (args) => ({ type: 'OSPF_ROUTER_ID', params: { routerId: args[0] } }),
    description: 'Set OSPF router ID',
  },
  {
    pattern: 'passive-interface',
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ['router'],
    action: (args) => ({ type: 'OSPF_PASSIVE_INTERFACE', params: { interface: args[0] } }),
    description: 'Suppress OSPF hellos on interface',
  },
  {
    pattern: 'no passive-interface',
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ['router'],
    action: (args) => ({ type: 'NO_OSPF_PASSIVE_INTERFACE', params: { interface: args[0] } }),
    description: 'Enable OSPF hellos on interface',
  },
  {
    pattern: 'default-information originate',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['router'],
    action: () => ({ type: 'OSPF_DEFAULT_ORIGINATE', params: {} }),
    description: 'Distribute default route',
  },
  {
    pattern: 'no default-information originate',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['router'],
    action: () => ({ type: 'NO_OSPF_DEFAULT_ORIGINATE', params: {} }),
    description: 'Stop distributing default route',
  },
  {
    pattern: 'exit',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['router'],
    action: () => ({ type: 'EXIT_ROUTER', params: {} }),
    description: 'Exit router configuration mode',
  },
  // Layer 3 Switch configuration
  {
    pattern: 'ip routing',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['config'],
    action: () => ({ type: 'IP_ROUTING', params: {} }),
    description: 'Enable IP routing on Layer 3 switch',
  },
  {
    pattern: 'no ip routing',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['config'],
    action: () => ({ type: 'NO_IP_ROUTING', params: {} }),
    description: 'Disable IP routing on Layer 3 switch',
  },
  // ACL configuration (config mode)
  {
    pattern: 'access-list',
    minArgs: 3,
    maxArgs: 100,
    allowedModes: ['config'],
    action: (args) => ({ 
      type: 'ACCESS_LIST', 
      params: { 
        number: args[0],
        action: args[1],
        remainder: args.slice(2),
      } 
    }),
    description: 'Configure numbered ACL (access-list num permit/deny ...)',
  },
  {
    pattern: 'no access-list',
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ['config'],
    action: (args) => ({ type: 'NO_ACCESS_LIST', params: { number: args[0] } }),
    description: 'Delete numbered ACL',
  },
  {
    pattern: 'ip access-list standard',
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ['config'],
    action: (args) => ({ type: 'IP_ACCESS_LIST_STANDARD', params: { name: args[0] } }),
    description: 'Create named standard ACL',
  },
  {
    pattern: 'ip access-list extended',
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ['config'],
    action: (args) => ({ type: 'IP_ACCESS_LIST_EXTENDED', params: { name: args[0] } }),
    description: 'Create named extended ACL',
  },
  {
    pattern: 'no ip access-list',
    minArgs: 2,
    maxArgs: 2,
    allowedModes: ['config'],
    action: (args) => ({ type: 'NO_IP_ACCESS_LIST', params: { type: args[0], name: args[1] } }),
    description: 'Delete named ACL',
  },
  // ACL mode commands (permit/deny rules inside named ACL)
  {
    pattern: 'permit',
    minArgs: 1,
    maxArgs: 10,
    allowedModes: ['acl'],
    action: (args) => ({ type: 'ACL_PERMIT', params: { args } }),
    description: 'Add permit rule to ACL',
  },
  {
    pattern: 'deny',
    minArgs: 1,
    maxArgs: 10,
    allowedModes: ['acl'],
    action: (args) => ({ type: 'ACL_DENY', params: { args } }),
    description: 'Add deny rule to ACL',
  },
  {
    pattern: 'remark',
    minArgs: 1,
    maxArgs: 20,
    allowedModes: ['acl'],
    action: (args) => ({ type: 'ACL_REMARK', params: { text: args.join(' ') } }),
    description: 'Add remark to ACL',
  },
  {
    pattern: 'exit',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['acl'],
    action: () => ({ type: 'EXIT_ACL', params: {} }),
    description: 'Exit ACL configuration mode',
  },
  // NAT configuration (config mode)
  {
    pattern: 'ip nat inside source static',
    minArgs: 2,
    maxArgs: 2,
    allowedModes: ['config'],
    action: (args) => ({ type: 'IP_NAT_STATIC', params: { local: args[0], global: args[1] } }),
    description: 'Configure static NAT',
  },
  {
    pattern: 'no ip nat inside source static',
    minArgs: 1,
    maxArgs: 2,
    allowedModes: ['config'],
    action: (args) => ({ type: 'NO_IP_NAT_STATIC', params: { local: args[0], global: args[1] || undefined } }),
    description: 'Remove static NAT (local [global])',
  },
  {
    pattern: 'ip nat pool',
    minArgs: 4,
    maxArgs: 4,
    allowedModes: ['config'],
    action: (args) => ({ 
      type: 'IP_NAT_POOL', 
      params: { 
        name: args[0], 
        start: args[1], 
        end: args[2], 
        netmask: args[3] 
      } 
    }),
    description: 'Create NAT pool (ip nat pool name start end netmask)',
  },
  {
    pattern: 'no ip nat pool',
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ['config'],
    action: (args) => ({ type: 'NO_IP_NAT_POOL', params: { name: args[0] } }),
    description: 'Delete NAT pool',
  },
  {
    pattern: 'ip nat inside source list',
    minArgs: 3,
    maxArgs: 3,
    allowedModes: ['config'],
    action: (args) => ({ 
      type: 'IP_NAT_DYNAMIC', 
      params: { 
        acl: args[0], 
        pool: args[1],
        overload: args[2] === 'overload'
      } 
    }),
    description: 'Configure dynamic NAT (ip nat inside source list acl pool overload)',
  },
  // STP configuration (config mode)
  {
    pattern: 'spanning-tree vlan',
    minArgs: 2,
    maxArgs: 2,
    allowedModes: ['config'],
    action: (args) => ({ 
      type: 'SPANNING_TREE_VLAN_PRIORITY', 
      params: { vlan: parseInt(args[0], 10), priority: parseInt(args[1], 10) } 
    }),
    description: 'Set STP priority for VLAN (spanning-tree vlan X priority Y)',
  },
  {
    pattern: 'spanning-tree portfast',
    minArgs: 0,
    maxArgs: 1,
    allowedModes: ['interface'],
    action: (args) => ({ type: 'SPANNING_TREE_PORTFAST', params: { edge: args[0] === 'edge' } }),
    description: 'Enable PortFast on interface',
  },
  {
    pattern: 'no spanning-tree portfast',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['interface'],
    action: () => ({ type: 'NO_SPANNING_TREE_PORTFAST', params: {} }),
    description: 'Disable PortFast on interface',
  },
  {
    pattern: 'spanning-tree bpduguard enable',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['interface'],
    action: () => ({ type: 'SPANNING_TREE_BPDUGUARD', params: { enabled: true } }),
    description: 'Enable BPDU Guard on interface',
  },
  {
    pattern: 'no spanning-tree bpduguard',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['interface'],
    action: () => ({ type: 'SPANNING_TREE_BPDUGUARD', params: { enabled: false } }),
    description: 'Disable BPDU Guard on interface',
  },
  {
    pattern: 'spanning-tree cost',
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ['interface'],
    action: (args) => ({ type: 'SPANNING_TREE_COST', params: { cost: parseInt(args[0], 10) } }),
    description: 'Set STP port cost',
  },
  // DHCP configuration (config mode)
  {
    pattern: 'ip dhcp pool',
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ['config'],
    action: (args) => ({ type: 'IP_DHCP_POOL', params: { name: args[0] } }),
    description: 'Create DHCP pool',
  },
  {
    pattern: 'no ip dhcp pool',
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ['config'],
    action: (args) => ({ type: 'NO_IP_DHCP_POOL', params: { name: args[0] } }),
    description: 'Delete DHCP pool',
  },
  {
    pattern: 'network',
    minArgs: 2,
    maxArgs: 2,
    allowedModes: ['dhcp'],
    action: (args) => ({ type: 'DHCP_NETWORK', params: { network: args[0], mask: args[1] } }),
    description: 'Set DHCP pool network (in DHCP config mode)',
  },
  {
    pattern: 'default-router',
    minArgs: 1,
    maxArgs: 8,
    allowedModes: ['dhcp'],
    action: (args) => ({ type: 'DHCP_DEFAULT_ROUTER', params: { routers: args } }),
    description: 'Set default gateway for DHCP clients',
  },
  {
    pattern: 'dns-server',
    minArgs: 1,
    maxArgs: 8,
    allowedModes: ['dhcp'],
    action: (args) => ({ type: 'DHCP_DNS_SERVER', params: { servers: args } }),
    description: 'Set DNS servers for DHCP clients',
  },
  {
    pattern: 'domain-name',
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ['dhcp'],
    action: (args) => ({ type: 'DHCP_DOMAIN_NAME', params: { name: args[0] } }),
    description: 'Set domain name for DHCP clients',
  },
  {
    pattern: 'lease',
    minArgs: 3,
    maxArgs: 3,
    allowedModes: ['dhcp'],
    action: (args) => ({ 
      type: 'DHCP_LEASE', 
      params: { 
        days: parseInt(args[0], 10), 
        hours: parseInt(args[1], 10), 
        minutes: parseInt(args[2], 10) 
      } 
    }),
    description: 'Set lease time (days hours minutes)',
  },
  {
    pattern: 'ip dhcp excluded-address',
    minArgs: 1,
    maxArgs: 2,
    allowedModes: ['config'],
    action: (args) => ({ 
      type: 'IP_DHCP_EXCLUDED', 
      params: { 
        low: args[0], 
        high: args[1] || args[0] 
      } 
    }),
    description: 'Exclude IP address(es) from DHCP pool',
  },
  {
    pattern: 'no ip dhcp excluded-address',
    minArgs: 1,
    maxArgs: 2,
    allowedModes: ['config'],
    action: (args) => ({ 
      type: 'NO_IP_DHCP_EXCLUDED', 
      params: { 
        low: args[0], 
        high: args[1] || args[0] 
      } 
    }),
    description: 'Remove excluded IP address(es)',
  },
  {
    pattern: 'ip helper-address',
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ['interface'],
    action: (args) => ({ type: 'IP_HELPER_ADDRESS', params: { server: args[0] } }),
    description: 'Configure DHCP relay on interface',
  },
  {
    pattern: 'no ip helper-address',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['interface'],
    action: () => ({ type: 'NO_IP_HELPER_ADDRESS', params: {} }),
    description: 'Remove DHCP relay from interface',
  },
  // VLAN configuration (config mode)
  {
    pattern: 'vlan',
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ['config'],
    action: (args) => ({ type: 'VLAN_CREATE', params: { id: parseInt(args[0], 10) } }),
    description: 'Create/enter VLAN configuration',
  },
  {
    pattern: 'no vlan',
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ['config'],
    action: (args) => ({ type: 'VLAN_DELETE', params: { id: parseInt(args[0], 10) } }),
    description: 'Delete a VLAN',
  },
  // Show VLAN commands
  {
    pattern: 'show vlan brief',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['privileged'],
    action: () => ({ type: 'SHOW_VLAN_BRIEF', params: {} }),
    description: 'Show VLAN summary',
  },
  {
    pattern: 'show vlan',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['privileged'],
    action: () => ({ type: 'SHOW_VLAN', params: {} }),
    description: 'Show VLAN information',
  },
  {
    pattern: 'show interfaces trunk',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['privileged'],
    action: () => ({ type: 'SHOW_INTERFACES_TRUNK', params: {} }),
    description: 'Show trunk interfaces',
  },
  // OSPF show commands
  {
    pattern: 'show ip ospf neighbor',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['privileged'],
    action: () => ({ type: 'SHOW_IP_OSPF_NEIGHBOR', params: {} }),
    description: 'Show OSPF neighbors',
  },
  {
    pattern: 'show ip ospf interface',
    minArgs: 0,
    maxArgs: 1,
    allowedModes: ['privileged'],
    action: (args) => ({ type: 'SHOW_IP_OSPF_INTERFACE', params: { interface: args[0] } }),
    description: 'Show OSPF interface status',
  },
  {
    pattern: 'show ip ospf database',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['privileged'],
    action: () => ({ type: 'SHOW_IP_OSPF_DATABASE', params: {} }),
    description: 'Show OSPF link-state database',
  },
  {
    pattern: 'show ip ospf',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['privileged'],
    action: () => ({ type: 'SHOW_IP_OSPF', params: {} }),
    description: 'Show OSPF process information',
  },
  {
    pattern: 'show ip route ospf',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['privileged'],
    action: () => ({ type: 'SHOW_IP_ROUTE_OSPF', params: {} }),
    description: 'Show OSPF routes',
  },

  // ACL show commands
  {
    pattern: 'show access-lists',
    minArgs: 0,
    maxArgs: 1,
    allowedModes: ['privileged'],
    action: (args) => ({ type: 'SHOW_ACCESS_LISTS', params: { name: args[0] } }),
    description: 'Show access lists',
  },
  {
    pattern: 'show ip access-lists',
    minArgs: 0,
    maxArgs: 1,
    allowedModes: ['privileged'],
    action: (args) => ({ type: 'SHOW_IP_ACCESS_LISTS', params: { name: args[0] } }),
    description: 'Show IP access lists',
  },
  // NAT show commands
  {
    pattern: 'show ip nat translations',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['privileged'],
    action: () => ({ type: 'SHOW_IP_NAT_TRANSLATIONS', params: {} }),
    description: 'Show NAT translation table',
  },
  {
    pattern: 'show ip nat statistics',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['privileged'],
    action: () => ({ type: 'SHOW_IP_NAT_STATISTICS', params: {} }),
    description: 'Show NAT statistics',
  },
  // STP show commands
  {
    pattern: 'show spanning-tree',
    minArgs: 0,
    maxArgs: 1,
    allowedModes: ['privileged'],
    action: (args) => ({ type: 'SHOW_SPANNING_TREE', params: { vlan: args[0] ? parseInt(args[0], 10) : undefined } }),
    description: 'Show spanning-tree information',
  },
  {
    pattern: 'show spanning-tree vlan',
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ['privileged'],
    action: (args) => ({ type: 'SHOW_SPANNING_TREE_VLAN', params: { vlan: parseInt(args[0], 10) } }),
    description: 'Show spanning-tree for specific VLAN',
  },
  {
    pattern: 'show spanning-tree summary',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['privileged'],
    action: () => ({ type: 'SHOW_SPANNING_TREE_SUMMARY', params: {} }),
    description: 'Show spanning-tree summary',
  },
  // DHCP show commands
  {
    pattern: 'show ip dhcp pool',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['privileged'],
    action: () => ({ type: 'SHOW_IP_DHCP_POOL', params: {} }),
    description: 'Show DHCP pools',
  },
  {
    pattern: 'show ip dhcp binding',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['privileged'],
    action: () => ({ type: 'SHOW_IP_DHCP_BINDING', params: {} }),
    description: 'Show DHCP bindings',
  },
  {
    pattern: 'show ip dhcp server statistics',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['privileged'],
    action: () => ({ type: 'SHOW_IP_DHCP_STATISTICS', params: {} }),
    description: 'Show DHCP server statistics',
  },

  // Interface config commands
  {
    pattern: 'ip address',
    minArgs: 2,
    maxArgs: 2,
    allowedModes: ['interface'],
    action: (args) => ({
      type: 'IP_ADDRESS',
      params: { ip: args[0], mask: args[1] },
    }),
    description: 'Set IP address',
  },
  {
    pattern: 'no ip address',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['interface'],
    action: () => ({ type: 'NO_IP_ADDRESS', params: {} }),
    description: 'Remove IP address',
  },
  {
    pattern: 'shutdown',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['interface'],
    action: () => ({ type: 'SHUTDOWN', params: {} }),
    description: 'Administratively shutdown interface',
  },
  {
    pattern: 'no shutdown',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['interface'],
    action: () => ({ type: 'NO_SHUTDOWN', params: {} }),
    description: 'Enable interface',
  },
  {
    pattern: 'description',
    minArgs: 1,
    maxArgs: 100,
    allowedModes: ['interface'],
    action: (args) => ({ type: 'DESCRIPTION', params: { text: args.join(' ') } }),
    description: 'Set interface description',
  },
  {
    pattern: 'no description',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['interface'],
    action: () => ({ type: 'NO_DESCRIPTION', params: {} }),
    description: 'Remove interface description',
  },
  // Switchport commands (interface mode, switches only)
  {
    pattern: 'switchport mode access',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['interface'],
    action: () => ({ type: 'SWITCHPORT_MODE', params: { mode: 'access' } }),
    description: 'Set interface as access port',
  },
  {
    pattern: 'switchport mode trunk',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['interface'],
    action: () => ({ type: 'SWITCHPORT_MODE', params: { mode: 'trunk' } }),
    description: 'Set interface as trunk port',
  },
  {
    pattern: 'switchport access vlan',
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ['interface'],
    action: (args) => ({ type: 'SWITCHPORT_ACCESS_VLAN', params: { vlan: parseInt(args[0], 10) } }),
    description: 'Assign access VLAN to port',
  },
  {
    pattern: 'switchport trunk allowed vlan',
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ['interface'],
    action: (args) => ({ type: 'SWITCHPORT_TRUNK_ALLOWED', params: { vlans: args[0] } }),
    description: 'Set allowed VLANs on trunk',
  },
  {
    pattern: 'switchport trunk native vlan',
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ['interface'],
    action: (args) => ({ type: 'SWITCHPORT_TRUNK_NATIVE', params: { vlan: parseInt(args[0], 10) } }),
    description: 'Set native VLAN on trunk',
  },
  // Subinterface commands (Router-on-a-Stick)
  {
    pattern: 'encapsulation dot1q',
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ['interface'],
    action: (args) => ({ type: 'ENCAPSULATION_DOT1Q', params: { vlan: parseInt(args[0], 10) } }),
    description: 'Set 802.1Q encapsulation VLAN',
  },
  // ACL application on interface
  {
    pattern: 'ip access-group',
    minArgs: 2,
    maxArgs: 2,
    allowedModes: ['interface'],
    action: (args) => ({ type: 'IP_ACCESS_GROUP', params: { acl: args[0], direction: args[1] } }),
    description: 'Apply ACL to interface (in/out)',
  },
  {
    pattern: 'no ip access-group',
    minArgs: 0,
    maxArgs: 2,
    allowedModes: ['interface'],
    action: (args) => ({ type: 'NO_IP_ACCESS_GROUP', params: { acl: args[0] || undefined, direction: args[1] || undefined } }),
    description: 'Remove ACL from interface',
  },
  // NAT interface commands
  {
    pattern: 'ip nat inside',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['interface'],
    action: () => ({ type: 'IP_NAT_INSIDE', params: {} }),
    description: 'Mark interface as NAT inside',
  },
  {
    pattern: 'no ip nat inside',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['interface'],
    action: () => ({ type: 'NO_IP_NAT_INSIDE', params: {} }),
    description: 'Remove NAT inside from interface',
  },
  {
    pattern: 'ip nat outside',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['interface'],
    action: () => ({ type: 'IP_NAT_OUTSIDE', params: {} }),
    description: 'Mark interface as NAT outside',
  },
  {
    pattern: 'no ip nat outside',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['interface'],
    action: () => ({ type: 'NO_IP_NAT_OUTSIDE', params: {} }),
    description: 'Remove NAT outside from interface',
  },
  {
    pattern: 'duplex',
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ['interface'],
    action: (args) => ({ type: 'DUPLEX', params: { mode: args[0] } }),
    description: 'Set duplex mode',
  },
  {
    pattern: 'speed',
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ['interface'],
    action: (args) => ({ type: 'SPEED', params: { value: args[0] } }),
    description: 'Set interface speed',
  },
  // OSPF interface commands
  {
    pattern: 'ip ospf cost',
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ['interface'],
    action: (args) => ({ type: 'IP_OSPF_COST', params: { cost: parseInt(args[0], 10) } }),
    description: 'Set OSPF interface cost',
  },
  {
    pattern: 'ip ospf priority',
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ['interface'],
    action: (args) => ({ type: 'IP_OSPF_PRIORITY', params: { priority: parseInt(args[0], 10) } }),
    description: 'Set OSPF interface priority (0-255)',
  },
  {
    pattern: 'ip ospf hello-interval',
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ['interface'],
    action: (args) => ({ type: 'IP_OSPF_HELLO_INTERVAL', params: { interval: parseInt(args[0], 10) } }),
    description: 'Set OSPF hello interval in seconds',
  },
  {
    pattern: 'ip ospf dead-interval',
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ['interface'],
    action: (args) => ({ type: 'IP_OSPF_DEAD_INTERVAL', params: { interval: parseInt(args[0], 10) } }),
    description: 'Set OSPF dead interval in seconds',
  },
  {
    pattern: 'exit',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['interface'],
    action: () => ({ type: 'EXIT_INTERFACE', params: {} }),
    description: 'Exit interface configuration mode',
  },
  
  // IPv6 commands (interface mode)
  {
    pattern: 'ipv6 address',
    minArgs: 2,
    maxArgs: 3,
    allowedModes: ['interface'],
    action: (args) => ({
      type: 'IPV6_ADDRESS',
      params: { 
        address: args[0], 
        prefixLength: parseInt(args[1], 10),
        eui64: args[2] === 'eui-64'
      },
    }),
    description: 'Set IPv6 address (ipv6 address address/prefix-length [eui-64])',
  },
  {
    pattern: 'no ipv6 address',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['interface'],
    action: () => ({ type: 'NO_IPV6_ADDRESS', params: {} }),
    description: 'Remove IPv6 address',
  },
  {
    pattern: 'ipv6 enable',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['interface'],
    action: () => ({ type: 'IPV6_ENABLE', params: {} }),
    description: 'Enable IPv6 processing on interface',
  },
  {
    pattern: 'no ipv6 enable',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['interface'],
    action: () => ({ type: 'NO_IPV6_ENABLE', params: {} }),
    description: 'Disable IPv6 processing on interface',
  },
  // IPv6 show commands
  {
    pattern: 'show ipv6 interface brief',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['privileged'],
    action: () => ({ type: 'SHOW_IPV6_INTERFACE_BRIEF', params: {} }),
    description: 'Show IPv6 interface brief',
  },
  {
    pattern: 'show ipv6 interface',
    minArgs: 0,
    maxArgs: 1,
    allowedModes: ['privileged'],
    action: (args) => ({ type: 'SHOW_IPV6_INTERFACE', params: { interface: args[0] } }),
    description: 'Show IPv6 interface details',
  },
  {
    pattern: 'show ipv6 route',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['privileged'],
    action: () => ({ type: 'SHOW_IPV6_ROUTE', params: {} }),
    description: 'Show IPv6 routing table',
  },
  // IPv6 static routes
  {
    pattern: 'ipv6 route',
    minArgs: 2,
    maxArgs: 3,
    allowedModes: ['config'],
    action: (args) => ({
      type: 'IPV6_ROUTE',
      params: { 
        network: args[0],
        nextHop: args[1] === 'null0' ? null : args[1],
        interface: args[2] || null
      },
    }),
    description: 'Add IPv6 static route',
  },
  {
    pattern: 'no ipv6 route',
    minArgs: 2,
    maxArgs: 3,
    allowedModes: ['config'],
    action: (args) => ({
      type: 'NO_IPV6_ROUTE',
      params: { 
        network: args[0],
        nextHop: args[1] === 'null0' ? null : args[1],
        interface: args[2] || null
      },
    }),
    description: 'Remove IPv6 static route',
  },
  // Port Security commands (interface mode)
  {
    pattern: 'switchport port-security',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['interface'],
    action: () => ({ type: 'SWITCHPORT_PORT_SECURITY', params: { enabled: true } }),
    description: 'Enable port security',
  },
  {
    pattern: 'no switchport port-security',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['interface'],
    action: () => ({ type: 'SWITCHPORT_PORT_SECURITY', params: { enabled: false } }),
    description: 'Disable port security',
  },
  {
    pattern: 'switchport port-security maximum',
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ['interface'],
    action: (args) => ({ type: 'SWITCHPORT_PORT_SECURITY_MAXIMUM', params: { max: parseInt(args[0], 10) } }),
    description: 'Set maximum secure MAC addresses',
  },
  {
    pattern: 'switchport port-security violation',
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ['interface'],
    action: (args) => ({ type: 'SWITCHPORT_PORT_SECURITY_VIOLATION', params: { mode: args[0] } }),
    description: 'Set violation mode (protect/restrict/shutdown)',
  },
  {
    pattern: 'switchport port-security mac-address',
    minArgs: 1,
    maxArgs: 2,
    allowedModes: ['interface'],
    action: (args) => ({ 
      type: 'SWITCHPORT_PORT_SECURITY_MAC', 
      params: { 
        mac: args[0],
        vlan: args[1] ? parseInt(args[1], 10) : undefined 
      } 
    }),
    description: 'Add secure MAC address',
  },
  {
    pattern: 'no switchport port-security mac-address',
    minArgs: 1,
    maxArgs: 2,
    allowedModes: ['interface'],
    action: (args) => ({ 
      type: 'NO_SWITCHPORT_PORT_SECURITY_MAC', 
      params: { 
        mac: args[0],
        vlan: args[1] ? parseInt(args[1], 10) : undefined 
      } 
    }),
    description: 'Remove secure MAC address',
  },
  {
    pattern: 'switchport port-security mac-address sticky',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['interface'],
    action: () => ({ type: 'SWITCHPORT_PORT_SECURITY_STICKY', params: { enabled: true } }),
    description: 'Enable sticky MAC learning',
  },
  {
    pattern: 'no switchport port-security mac-address sticky',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['interface'],
    action: () => ({ type: 'SWITCHPORT_PORT_SECURITY_STICKY', params: { enabled: false } }),
    description: 'Disable sticky MAC learning',
  },
  // Port Security show commands
  {
    pattern: 'show port-security',
    minArgs: 0,
    maxArgs: 1,
    allowedModes: ['privileged'],
    action: (args) => ({ type: 'SHOW_PORT_SECURITY', params: { interface: args[0] } }),
    description: 'Show port security status',
  },
  {
    pattern: 'show port-security interface',
    minArgs: 1,
    maxArgs: 1,
    allowedModes: ['privileged'],
    action: (args) => ({ type: 'SHOW_PORT_SECURITY_INTERFACE', params: { interface: args[0] } }),
    description: 'Show port security for interface',
  },
  {
    pattern: 'show port-security address',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['privileged'],
    action: () => ({ type: 'SHOW_PORT_SECURITY_ADDRESS', params: {} }),
    description: 'Show secure MAC addresses',
  },
  // File operations
  {
    pattern: 'write memory',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['privileged'],
    action: () => ({ type: 'WRITE_MEMORY', params: {} }),
    description: 'Save configuration to startup-config',
  },
  {
    pattern: 'copy running-config startup-config',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['privileged'],
    action: () => ({ type: 'COPY_RUN_START', params: {} }),
    description: 'Copy running-config to startup-config',
  },
  {
    pattern: 'erase startup-config',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['privileged'],
    action: () => ({ type: 'ERASE_STARTUP', params: {} }),
    description: 'Erase startup configuration',
  },
  {
    pattern: 'reload',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['privileged'],
    action: () => ({ type: 'RELOAD', params: {} }),
    description: 'Reload the system',
  },
];

// ============================================================================
// Parser State Management
// ============================================================================

export function createParserState(): CLIParserState {
  return {
    mode: 'user',
    configTarget: null,
    history: [],
    historyIndex: -1,
  };
}

export function getPrompt(state: CLIParserState, hostname: string): string {
  switch (state.mode) {
    case 'user':
      return `${hostname}>`;
    case 'privileged':
      return `${hostname}#`;
    case 'config':
      return `${hostname}(config)#`;
    case 'interface':
      return `${hostname}(config-if)#`;
    case 'router':
      return `${hostname}(config-router)#`;
    case 'acl':
      return `${hostname}(config-${state.configTarget?.startsWith('ext-') ? 'ext' : 'std'}-nacl)#`;
    case 'dhcp':
      return `${hostname}(dhcp-config)#`;
    default:
      return `${hostname}>`;
  }
}

// ============================================================================
// Security Constants
// ============================================================================

const MAX_INPUT_LENGTH = 1024;
const MAX_HISTORY_SIZE = 1000;
const MAX_TOKEN_LENGTH = 256;
const ALLOWED_CHARS = /^[\x20-\x7E]*$/; // Printable ASCII only

// ============================================================================
// Command Matching
// ============================================================================

/**
 * Tokenize input string with security validation
 * @throws Error if input contains invalid characters or exceeds limits
 */
function tokenize(input: string): string[] {
  // Check input length
  if (input.length > MAX_INPUT_LENGTH) {
    throw new Error(`Input exceeds maximum length of ${MAX_INPUT_LENGTH} characters`);
  }
  
  // Check for invalid characters (potential injection)
  if (!ALLOWED_CHARS.test(input)) {
    throw new Error('Input contains invalid characters');
  }
  
  // Check for potential regex DoS patterns
  if (input.includes('(.)*') || input.includes('(.+)*') || input.includes('(.*)*')) {
    throw new Error('Invalid input pattern detected');
  }
  
  const trimmed = input.trim();
  if (!trimmed) return [];
  
  const tokens = trimmed.split(/\s+/).filter(t => t.length > 0);
  
  // Validate token lengths
  for (const token of tokens) {
    if (token.length > MAX_TOKEN_LENGTH) {
      throw new Error(`Token exceeds maximum length of ${MAX_TOKEN_LENGTH} characters`);
    }
  }
  
  return tokens;
}

/**
 * Check if a token matches a pattern token (exact match or abbreviation)
 * Cisco IOS allows abbreviating commands to the shortest unique prefix
 */
function tokenMatches(inputToken: string, patternToken: string): boolean {
  // Exact match
  if (inputToken === patternToken) return true;
  
  // Abbreviation: input must be prefix of pattern, at least 1 char, 
  // and pattern must be longer than input
  if (inputToken.length > 0 && 
      patternToken.toLowerCase().startsWith(inputToken.toLowerCase()) &&
      inputToken.length < patternToken.length) {
    return true;
  }
  
  return false;
}

function matchCommand(
  tokens: string[],
  definition: CommandDef,
  currentMode: CLIMode
): boolean {
  if (!definition.allowedModes.includes(currentMode)) {
    return false;
  }

  const patternTokens = definition.pattern.split(' ');
  
  if (tokens.length < patternTokens.length) {
    return false;
  }

  // Check if tokens match the pattern (with abbreviation support)
  for (let i = 0; i < patternTokens.length; i++) {
    if (!tokenMatches(tokens[i], patternTokens[i])) {
      return false;
    }
  }

  // Check argument count
  const argCount = tokens.length - patternTokens.length;
  if (argCount < definition.minArgs || argCount > definition.maxArgs) {
    return false;
  }

  return true;
}

function findCommand(tokens: string[], currentMode: CLIMode): CommandDef | 'ambiguous' | null {
  const matches: CommandDef[] = [];
  for (const def of COMMAND_DEFINITIONS) {
    if (matchCommand(tokens, def, currentMode)) {
      matches.push(def);
    }
  }

  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];

  // Check if one is an exact match (all pattern tokens match exactly, case-insensitive)
  const exactMatch = matches.find(def => {
    const patternTokens = def.pattern.split(' ');
    return patternTokens.every((pt, i) => tokens[i]?.toLowerCase() === pt.toLowerCase());
  });
  if (exactMatch) return exactMatch;

  return 'ambiguous';
}

// ============================================================================
// Main Parser
// ============================================================================

export function parseCommand(
  input: string,
  state: CLIParserState,
  hostname: string
): CLIParseResult {
  const trimmed = input.trim();
  
  if (trimmed === '') {
    return {
      success: true,
      command: '',
      args: [],
      mode: state.mode,
    };
  }

  // Handle context help (?) - check if input ends with ?
  const isHelpRequest = trimmed.endsWith('?');
  const commandInput = isHelpRequest ? trimmed.slice(0, -1).trim() : trimmed;
  
  let tokens: string[];
  
  try {
    tokens = tokenize(commandInput);
  } catch (error) {
    return {
      success: false,
      command: '',
      args: [],
      mode: state.mode,
      error: error instanceof Error ? `% ${error.message}` : '% Invalid input',
    };
  }

  // Handle context help
  if (isHelpRequest) {
    const helpOutput = getContextHelp(tokens, state.mode);
    return {
      success: true,
      command: '',
      args: [],
      mode: state.mode,
      action: {
        type: 'HELP_CONTEXT',
        params: { output: helpOutput },
      },
    };
  }

  // Handle "do" prefix in config/interface mode
  // "do show ip route" executes "show ip route" as if in privileged mode
  if ((state.mode === 'config' || state.mode === 'interface') &&
      tokens.length > 0 && tokens[0].toLowerCase() === 'do') {
    const doTokens = tokens.slice(1);
    if (doTokens.length === 0) {
      return {
        success: false,
        command: 'do',
        args: [],
        mode: state.mode,
        error: '% Incomplete command.',
      };
    }

    const doCommandDef = findCommand(doTokens, 'privileged');

    if (doCommandDef === 'ambiguous') {
      return {
        success: false,
        command: doTokens[0] || '',
        args: doTokens.slice(1),
        mode: state.mode,
        error: `% Ambiguous command:  "do ${doTokens.join(' ')}"`,
      };
    }

    if (!doCommandDef) {
      return {
        success: false,
        command: doTokens[0] || '',
        args: doTokens.slice(1),
        mode: state.mode,
        error: `Invalid input detected at '^' marker.\r\ndo ${doTokens.join(' ')}\r\n   ^`,
      };
    }

    const doPatternTokens = doCommandDef.pattern.split(' ');
    const doArgs = doTokens.slice(doPatternTokens.length);
    const doAction = doCommandDef.action(doArgs);

    // Add to history
    if (trimmed !== '' && state.history[state.history.length - 1] !== trimmed) {
      if (state.history.length >= MAX_HISTORY_SIZE) state.history.shift();
      state.history.push(trimmed);
    }
    state.historyIndex = state.history.length;

    return {
      success: true,
      command: doCommandDef.pattern,
      args: doArgs,
      mode: state.mode,
      action: doAction,
    };
  }

  // Add to history (after successful tokenization)
  if (trimmed !== '' && state.history[state.history.length - 1] !== trimmed) {
    // Limit history size to prevent memory issues
    if (state.history.length >= MAX_HISTORY_SIZE) {
      state.history.shift();
    }
    state.history.push(trimmed);
  }
  state.historyIndex = state.history.length;

  const commandDef = findCommand(tokens, state.mode);

  if (commandDef === 'ambiguous') {
    return {
      success: false,
      command: tokens[0] || '',
      args: tokens.slice(1),
      mode: state.mode,
      error: `% Ambiguous command:  "${trimmed}"`,
    };
  }

  if (!commandDef) {
    return {
      success: false,
      command: tokens[0] || '',
      args: tokens.slice(1),
      mode: state.mode,
      error: `Invalid input detected at '^' marker.\r\n${trimmed}\r\n${'^'.padStart((tokens[0]?.length || 0) + 1, ' ')}`,
    };
  }

  // Extract arguments
  const patternTokens = commandDef.pattern.split(' ');
  const args = tokens.slice(patternTokens.length);

  // Create action
  const action = commandDef.action(args);

  return {
    success: true,
    command: commandDef.pattern,
    args,
    mode: state.mode,
    action,
  };
}

// ============================================================================
// Mode Transitions
// ============================================================================

export function transitionMode(
  state: CLIParserState,
  action: CLIAction,
  currentInterface?: string
): { newState: CLIParserState; output: string } {
  let output = '';

  switch (action.type) {
    case 'ENABLE':
      state.mode = 'privileged';
      break;
    case 'DISABLE':
      state.mode = 'user';
      state.configTarget = null;
      break;
    case 'CONFIGURE_TERMINAL':
      state.mode = 'config';
      break;
    case 'INTERFACE': {
      state.mode = 'interface';
      // Normalize loopback name: "Loopback 0" or "loopback0" → "Loopback0"
      // Handle subinterface: "GigabitEthernet0/0.10" stays as-is
      // Handle SVI: "vlan 10" → "Vlan10"
      const ifName = action.params.interface;
      const loMatch = ifName.match(/^[Ll]oopback\s*(\d+)$/);
      const vlanMatch = ifName.match(/^[Vv]lan\s*(\d+)$/);
      if (loMatch) {
        state.configTarget = `Loopback${loMatch[1]}`;
      } else if (vlanMatch) {
        state.configTarget = `Vlan${vlanMatch[1]}`;
      } else {
        state.configTarget = ifName;
      }
      break;
    }
    case 'ROUTER_OSPF': {
      state.mode = 'router';
      state.configTarget = `ospf-${action.params.processId}`;
      break;
    }
    case 'IP_ACCESS_LIST_STANDARD':
    case 'IP_ACCESS_LIST_EXTENDED': {
      state.mode = 'acl';
      state.configTarget = action.params.name;
      break;
    }
    case 'IP_DHCP_POOL': {
      state.mode = 'dhcp';
      state.configTarget = action.params.name;
      break;
    }
    case 'EXIT':
      if (state.mode === 'interface') {
        state.mode = 'config';
        state.configTarget = null;
      } else if (state.mode === 'router') {
        state.mode = 'config';
        state.configTarget = null;
      } else if (state.mode === 'acl') {
        state.mode = 'config';
        state.configTarget = null;
      } else if (state.mode === 'dhcp') {
        state.mode = 'config';
        state.configTarget = null;
      } else if (state.mode === 'config') {
        state.mode = 'privileged';
        state.configTarget = null;
      } else if (state.mode === 'privileged') {
        state.mode = 'user';
      }
      break;
    case 'EXIT_INTERFACE':
      state.mode = 'config';
      state.configTarget = null;
      break;
    case 'EXIT_ROUTER':
      state.mode = 'config';
      state.configTarget = null;
      break;
    case 'EXIT_ACL':
      state.mode = 'config';
      state.configTarget = null;
      break;
    case 'END':
      state.mode = 'privileged';
      state.configTarget = null;
      break;
  }

  return { newState: state, output };
}

// ============================================================================
// Command Help
// ============================================================================

export function getAvailableCommands(mode: CLIMode): string[] {
  const commands: string[] = [];
  
  for (const def of COMMAND_DEFINITIONS) {
    if (def.allowedModes.includes(mode) && !commands.includes(def.pattern)) {
      commands.push(def.pattern);
    }
  }
  
  return commands.sort();
}

export function getCommandDescription(pattern: string): string {
  const def = COMMAND_DEFINITIONS.find(d => d.pattern === pattern);
  return def?.description || 'No description available';
}

// ============================================================================
// Context Help (? command)
// ============================================================================

/**
 * Get context-sensitive help based on current mode and partial input
 * This mimics Cisco IOS '?' behavior
 */
function getContextHelp(tokens: string[], mode: CLIMode): string {
  const lines: string[] = [];
  
  // Get all commands available in current mode
  const availableCommands = COMMAND_DEFINITIONS.filter(
    def => def.allowedModes.includes(mode)
  );
  
  if (tokens.length === 0) {
    // Show all available commands at this level
    lines.push('');
    const commands = availableCommands.map(def => def.pattern);
    const uniqueCommands = [...new Set(commands)].sort();
    
    for (const cmd of uniqueCommands) {
      const def = COMMAND_DEFINITIONS.find(d => d.pattern === cmd);
      lines.push(`  ${cmd.padEnd(30)} ${def?.description || ''}`);
    }
    lines.push('');
  } else {
    // Show commands matching the partial input
    const partial = tokens.join(' ').toLowerCase();
    const matching = availableCommands.filter(def => 
      def.pattern.toLowerCase().startsWith(partial)
    );
    
    if (matching.length === 0) {
      lines.push('% Unrecognized command');
    } else {
      lines.push('');
      for (const def of matching) {
        lines.push(`  ${def.pattern.padEnd(30)} ${def.description}`);
      }
      lines.push('');
    }
  }
  
  return lines.join('\n');
}

// ============================================================================
// Tab Completion
// ============================================================================

export function getCompletions(input: string, mode: CLIMode): string[] {
  const trimmed = input.trim().toLowerCase();
  const commands = getAvailableCommands(mode);
  
  return commands.filter(cmd => cmd.toLowerCase().startsWith(trimmed));
}

// ============================================================================
// History Navigation
// ============================================================================

export function getPreviousCommand(state: CLIParserState): string | null {
  if (state.history.length === 0) return null;
  
  if (state.historyIndex > 0) {
    state.historyIndex--;
  }
  
  return state.history[state.historyIndex] || null;
}

export function getNextCommand(state: CLIParserState): string | null {
  if (state.history.length === 0) return null;
  
  if (state.historyIndex < state.history.length - 1) {
    state.historyIndex++;
    return state.history[state.historyIndex];
  }
  
  state.historyIndex = state.history.length;
  return null;
}
