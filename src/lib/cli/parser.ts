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
    allowedModes: ['user', 'privileged', 'config', 'interface'],
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
  {
    pattern: 'exit',
    minArgs: 0,
    maxArgs: 0,
    allowedModes: ['interface'],
    action: () => ({ type: 'EXIT_INTERFACE', params: {} }),
    description: 'Exit interface configuration mode',
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
    default:
      return `${hostname}>`;
  }
}

// ============================================================================
// Security Constants
// ============================================================================

const MAX_INPUT_LENGTH = 1024;
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

  // Check if one is an exact match (all pattern tokens match exactly)
  const exactMatch = matches.find(def => {
    const patternTokens = def.pattern.split(' ');
    return patternTokens.every((pt, i) => tokens[i] === pt);
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
      if (state.history.length >= 1000) state.history.shift();
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
    if (state.history.length >= 1000) {
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
      const ifName = action.params.interface;
      const loMatch = ifName.match(/^[Ll]oopback\s*(\d+)$/);
      state.configTarget = loMatch ? `Loopback${loMatch[1]}` : ifName;
      break;
    }
    case 'EXIT':
      if (state.mode === 'interface') {
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
