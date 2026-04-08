/**
 * CLI Parser Tests
 */

import {
  createParserState,
  parseCommand,
  transitionMode,
  getPrompt,
  getAvailableCommands,
} from '../lib/cli/parser';

describe('CLI Parser', () => {
  describe('createParserState', () => {
    it('should create initial parser state', () => {
      const state = createParserState();
      expect(state.mode).toBe('user');
      expect(state.configTarget).toBeNull();
      expect(state.history).toEqual([]);
      expect(state.historyIndex).toBe(-1);
    });
  });

  describe('parseCommand', () => {
    it('should parse enable command', () => {
      const state = createParserState();
      const result = parseCommand('enable', state, 'Router');
      
      expect(result.success).toBe(true);
      expect(result.command).toBe('enable');
      expect(result.action?.type).toBe('ENABLE');
    });

    it('should parse configure terminal command', () => {
      const state = createParserState();
      state.mode = 'privileged';
      
      const result = parseCommand('configure terminal', state, 'Router');
      
      expect(result.success).toBe(true);
      expect(result.command).toBe('configure terminal');
      expect(result.action?.type).toBe('CONFIGURE_TERMINAL');
    });

    it('should parse hostname command', () => {
      const state = createParserState();
      state.mode = 'config';
      
      const result = parseCommand('hostname NewRouter', state, 'Router');
      
      expect(result.success).toBe(true);
      expect(result.command).toBe('hostname');
      expect(result.action?.type).toBe('HOSTNAME');
      expect(result.action?.params.name).toBe('NewRouter');
    });

    it('should parse ip address command', () => {
      const state = createParserState();
      state.mode = 'interface';
      
      const result = parseCommand('ip address 192.168.1.1 255.255.255.0', state, 'Router');
      
      expect(result.success).toBe(true);
      expect(result.command).toBe('ip address');
      expect(result.action?.type).toBe('IP_ADDRESS');
      expect(result.action?.params.ip).toBe('192.168.1.1');
      expect(result.action?.params.mask).toBe('255.255.255.0');
    });

    it('should reject invalid commands', () => {
      const state = createParserState();
      const result = parseCommand('invalidcommand', state, 'Router');
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid input');
    });

    it('should reject commands in wrong mode', () => {
      const state = createParserState();
      state.mode = 'user';
      
      const result = parseCommand('show running-config', state, 'Router');
      
      expect(result.success).toBe(false);
    });

    it('should handle empty commands', () => {
      const state = createParserState();
      const result = parseCommand('', state, 'Router');
      
      expect(result.success).toBe(true);
      expect(result.command).toBe('');
    });
  });

  describe('transitionMode', () => {
    it('should transition to privileged mode', () => {
      const state = createParserState();
      const { newState } = transitionMode(state, { type: 'ENABLE', params: {} });
      
      expect(newState.mode).toBe('privileged');
    });

    it('should transition to config mode', () => {
      const state = createParserState();
      state.mode = 'privileged';
      
      const { newState } = transitionMode(state, { type: 'CONFIGURE_TERMINAL', params: {} });
      
      expect(newState.mode).toBe('config');
    });

    it('should transition to interface mode', () => {
      const state = createParserState();
      state.mode = 'config';
      
      const { newState } = transitionMode(state, {
        type: 'INTERFACE',
        params: { interface: 'GigabitEthernet0/0' },
      });
      
      expect(newState.mode).toBe('interface');
      expect(newState.configTarget).toBe('GigabitEthernet0/0');
    });

    it('should exit to previous mode', () => {
      const state = createParserState();
      state.mode = 'interface';
      
      const { newState } = transitionMode(state, { type: 'EXIT', params: {} });
      
      expect(newState.mode).toBe('config');
    });

    it('should exit to privileged mode from config', () => {
      const state = createParserState();
      state.mode = 'config';
      
      const { newState } = transitionMode(state, { type: 'END', params: {} });
      
      expect(newState.mode).toBe('privileged');
    });

    it('should disable to user mode', () => {
      const state = createParserState();
      state.mode = 'privileged';
      
      const { newState } = transitionMode(state, { type: 'DISABLE', params: {} });
      
      expect(newState.mode).toBe('user');
    });
  });

  describe('getPrompt', () => {
    it('should return user prompt', () => {
      const state = createParserState();
      state.mode = 'user';
      expect(getPrompt(state, 'Router')).toBe('Router>');
    });

    it('should return privileged prompt', () => {
      const state = createParserState();
      state.mode = 'privileged';
      expect(getPrompt(state, 'Router')).toBe('Router#');
    });

    it('should return config prompt', () => {
      const state = createParserState();
      state.mode = 'config';
      expect(getPrompt(state, 'Router')).toBe('Router(config)#');
    });

    it('should return interface prompt', () => {
      const state = createParserState();
      state.mode = 'interface';
      expect(getPrompt(state, 'Router')).toBe('Router(config-if)#');
    });
  });

  describe('getAvailableCommands', () => {
    it('should list user mode commands', () => {
      const commands = getAvailableCommands('user');
      expect(commands).toContain('enable');
      expect(commands).toContain('help');
      expect(commands).not.toContain('configure terminal');
    });

    it('should list privileged mode commands', () => {
      const commands = getAvailableCommands('privileged');
      expect(commands).toContain('configure terminal');
      expect(commands).toContain('show running-config');
      expect(commands).toContain('show ip route');
      expect(commands).toContain('ping');
    });

    it('should list config mode commands', () => {
      const commands = getAvailableCommands('config');
      expect(commands).toContain('hostname');
      expect(commands).toContain('interface');
      expect(commands).toContain('ip route');
    });

    it('should list interface mode commands', () => {
      const commands = getAvailableCommands('interface');
      expect(commands).toContain('ip address');
      expect(commands).toContain('shutdown');
      expect(commands).toContain('no shutdown');
    });
  });
});
