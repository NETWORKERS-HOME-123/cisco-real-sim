/**
 * Simulation Engine Tests
 */

import {
  ipToLong,
  longToIP,
  applySubnetMask,
  isSameNetwork,
  isValidIP,
  isValidMask,
  EventQueue,
  createARPPacket,
  createICMPPacket,
  findRoute,
  addStaticRoute,
  addConnectedRoutes,
} from '../lib/simulation/simulationEngine';
import { createTopology, addDevice } from '../lib/topology/topologyEngine';

describe('Simulation Engine', () => {
  describe('IP Utilities', () => {
    describe('ipToLong', () => {
      it('should convert IP to long integer', () => {
        expect(ipToLong('192.168.1.1')).toBe(3232235777);
        expect(ipToLong('10.0.0.1')).toBe(167772161);
        expect(ipToLong('255.255.255.255')).toBe(4294967295);
      });
    });

    describe('longToIP', () => {
      it('should convert long integer to IP', () => {
        expect(longToIP(3232235777)).toBe('192.168.1.1');
        expect(longToIP(167772161)).toBe('10.0.0.1');
        expect(longToIP(4294967295)).toBe('255.255.255.255');
      });
    });

    describe('applySubnetMask', () => {
      it('should apply subnet mask to IP', () => {
        expect(applySubnetMask('192.168.1.100', '255.255.255.0')).toBe('192.168.1.0');
        expect(applySubnetMask('10.0.50.25', '255.255.0.0')).toBe('10.0.0.0');
        expect(applySubnetMask('172.16.5.1', '255.255.255.128')).toBe('172.16.5.0');
      });
    });

    describe('isSameNetwork', () => {
      it('should determine if IPs are on same network', () => {
        expect(isSameNetwork('192.168.1.1', '192.168.1.100', '255.255.255.0')).toBe(true);
        expect(isSameNetwork('192.168.1.1', '192.168.2.1', '255.255.255.0')).toBe(false);
        expect(isSameNetwork('10.0.1.1', '10.0.2.1', '255.255.0.0')).toBe(true);
      });
    });

    describe('isValidIP', () => {
      it('should validate IP addresses', () => {
        expect(isValidIP('192.168.1.1')).toBe(true);
        expect(isValidIP('10.0.0.1')).toBe(true);
        expect(isValidIP('255.255.255.255')).toBe(true);
        expect(isValidIP('256.1.1.1')).toBe(false);
        expect(isValidIP('192.168.1')).toBe(false);
        expect(isValidIP('192.168.1.1.1')).toBe(false);
        expect(isValidIP('not.an.ip.address')).toBe(false);
      });
    });

    describe('isValidMask', () => {
      it('should validate subnet masks', () => {
        expect(isValidMask('255.255.255.0')).toBe(true);
        expect(isValidMask('255.255.0.0')).toBe(true);
        expect(isValidMask('255.255.255.128')).toBe(true);
        expect(isValidMask('255.255.255.255')).toBe(true);
        expect(isValidMask('0.0.0.0')).toBe(true);
        expect(isValidMask('255.0.255.0')).toBe(false); // Non-contiguous
        expect(isValidMask('256.255.255.0')).toBe(false);
      });
    });
  });

  describe('EventQueue', () => {
    it('should enqueue and dequeue events in order', () => {
      const queue = new EventQueue();
      
      queue.enqueue({
        id: '1',
        type: 'packet',
        timestamp: 100,
        data: {},
      });
      
      queue.enqueue({
        id: '2',
        type: 'packet',
        timestamp: 50,
        data: {},
      });
      
      queue.enqueue({
        id: '3',
        type: 'packet',
        timestamp: 150,
        data: {},
      });
      
      const first = queue.dequeue();
      expect(first?.id).toBe('2'); // Earliest timestamp
      
      const second = queue.dequeue();
      expect(second?.id).toBe('1');
      
      const third = queue.dequeue();
      expect(third?.id).toBe('3');
    });

    it('should report empty queue correctly', () => {
      const queue = new EventQueue();
      expect(queue.isEmpty()).toBe(true);
      
      queue.enqueue({
        id: '1',
        type: 'packet',
        timestamp: 100,
        data: {},
      });
      
      expect(queue.isEmpty()).toBe(false);
      queue.dequeue();
      expect(queue.isEmpty()).toBe(true);
    });
  });

  describe('Packet Creation', () => {
    it('should create ARP request packet', () => {
      const packet = createARPPacket(
        'request',
        '192.168.1.1',
        '00:11:22:33:44:55',
        '192.168.1.2'
      );
      
      expect(packet.protocol).toBe('ARP');
      expect(packet.srcMAC).toBe('00:11:22:33:44:55');
      expect(packet.dstMAC).toBe('FF:FF:FF:FF:FF:FF');
      expect(packet.payload.operation).toBe('request');
      expect(packet.payload.senderIP).toBe('192.168.1.1');
      expect(packet.payload.targetIP).toBe('192.168.1.2');
    });

    it('should create ARP reply packet', () => {
      const packet = createARPPacket(
        'reply',
        '192.168.1.2',
        '00:11:22:33:44:66',
        '192.168.1.1',
        '00:11:22:33:44:55'
      );
      
      expect(packet.protocol).toBe('ARP');
      expect(packet.dstMAC).toBe('00:11:22:33:44:55');
      expect(packet.payload.operation).toBe('reply');
    });

    it('should create ICMP echo request packet', () => {
      const packet = createICMPPacket(
        'echo-request',
        '192.168.1.1',
        '192.168.1.2',
        '00:11:22:33:44:55',
        '00:11:22:33:44:66'
      );
      
      expect(packet.protocol).toBe('ICMP');
      expect(packet.srcIP).toBe('192.168.1.1');
      expect(packet.dstIP).toBe('192.168.1.2');
      expect(packet.payload.type).toBe('echo-request');
      expect(packet.ttl).toBe(64);
    });
  });

  describe('Routing', () => {
    it('should find connected routes', () => {
      const topology = createTopology();
      const device = addDevice(topology, 'router', 'Router1', { x: 100, y: 100 });
      
      // Configure interface
      device.interfaces[0].ip = '192.168.1.1';
      device.interfaces[0].subnetMask = '255.255.255.0';
      device.interfaces[0].isShutdown = false;
      
      addConnectedRoutes(device);
      
      expect(device.routingTable.length).toBeGreaterThan(0);
      expect(device.routingTable[0].protocol).toBe('C');
      expect(device.routingTable[0].network).toBe('192.168.1.0');
    });

    it('should add and find static routes', () => {
      const topology = createTopology();
      const device = addDevice(topology, 'router', 'Router1', { x: 100, y: 100 });
      
      const result = addStaticRoute(
        device,
        '10.0.0.0',
        '255.0.0.0',
        '192.168.1.2',
        null
      );
      
      expect(result).toBe(true);
      expect(device.routingTable.length).toBe(1);
      expect(device.routingTable[0].protocol).toBe('S');
      
      const route = findRoute(device, '10.0.0.100');
      expect(route).not.toBeNull();
      expect(route?.network).toBe('10.0.0.0');
    });

    it('should prefer longer prefix match', () => {
      const topology = createTopology();
      const device = addDevice(topology, 'router', 'Router1', { x: 100, y: 100 });
      
      // Add a /16 route
      addStaticRoute(device, '10.0.0.0', '255.255.0.0', '192.168.1.2', null);
      
      // Add a /24 route
      addStaticRoute(device, '10.0.1.0', '255.255.255.0', '192.168.1.3', null);
      
      const route = findRoute(device, '10.0.1.100');
      expect(route?.network).toBe('10.0.1.0'); // Should prefer /24
    });
  });
});
