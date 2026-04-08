/**
 * Topology Engine Tests
 */

import {
  createTopology,
  addDevice,
  removeDevice,
  createLink,
  removeLink,
  serializeTopology,
  deserializeTopology,
  generateMAC,
  findDeviceByName,
} from '../lib/topology/topologyEngine';

describe('Topology Engine', () => {
  describe('createTopology', () => {
    it('should create an empty topology', () => {
      const topology = createTopology();
      expect(topology.devices.size).toBe(0);
      expect(topology.links.size).toBe(0);
      expect(topology.version).toBe(0);
    });
  });

  describe('addDevice', () => {
    it('should add a router device', () => {
      const topology = createTopology();
      const device = addDevice(topology, 'router', 'Router1', { x: 100, y: 100 });
      
      expect(device.name).toBe('Router1');
      expect(device.type).toBe('router');
      expect(device.position).toEqual({ x: 100, y: 100 });
      expect(device.interfaces.length).toBe(4); // Routers have 4 interfaces
      expect(topology.devices.size).toBe(1);
      expect(topology.version).toBe(1);
    });

    it('should add a switch device', () => {
      const topology = createTopology();
      const device = addDevice(topology, 'switch', 'Switch1', { x: 200, y: 200 });
      
      expect(device.name).toBe('Switch1');
      expect(device.type).toBe('switch');
      expect(device.interfaces.length).toBe(24); // Switches have 24 interfaces
      expect(topology.devices.size).toBe(1);
    });
  });

  describe('removeDevice', () => {
    it('should remove a device and its links', () => {
      const topology = createTopology();
      const device1 = addDevice(topology, 'router', 'Router1', { x: 100, y: 100 });
      const device2 = addDevice(topology, 'router', 'Router2', { x: 200, y: 200 });
      
      // Create a link between devices
      createLink(
        topology,
        device1.id,
        device1.interfaces[0].id,
        device2.id,
        device2.interfaces[0].id
      );
      
      expect(topology.links.size).toBe(1);
      
      removeDevice(topology, device1.id);
      
      expect(topology.devices.size).toBe(1);
      expect(topology.links.size).toBe(0);
    });
  });

  describe('createLink', () => {
    it('should create a link between two devices', () => {
      const topology = createTopology();
      const device1 = addDevice(topology, 'router', 'Router1', { x: 100, y: 100 });
      const device2 = addDevice(topology, 'router', 'Router2', { x: 200, y: 200 });
      
      const link = createLink(
        topology,
        device1.id,
        device1.interfaces[0].id,
        device2.id,
        device2.interfaces[0].id
      );
      
      expect(link).not.toBeNull();
      expect(topology.links.size).toBe(1);
      expect(device1.interfaces[0].connectedTo).toBe(`${device2.id}/${device2.interfaces[0].id}`);
      expect(device2.interfaces[0].connectedTo).toBe(`${device1.id}/${device1.interfaces[0].id}`);
    });

    it('should not create a link if interface is already connected', () => {
      const topology = createTopology();
      const device1 = addDevice(topology, 'router', 'Router1', { x: 100, y: 100 });
      const device2 = addDevice(topology, 'router', 'Router2', { x: 200, y: 200 });
      const device3 = addDevice(topology, 'router', 'Router3', { x: 300, y: 300 });
      
      // Connect device1 to device2
      createLink(
        topology,
        device1.id,
        device1.interfaces[0].id,
        device2.id,
        device2.interfaces[0].id
      );
      
      // Try to connect device1 to device3 using same interface
      const link = createLink(
        topology,
        device1.id,
        device1.interfaces[0].id,
        device3.id,
        device3.interfaces[0].id
      );
      
      expect(link).toBeNull();
    });
  });

  describe('removeLink', () => {
    it('should remove a link and disconnect interfaces', () => {
      const topology = createTopology();
      const device1 = addDevice(topology, 'router', 'Router1', { x: 100, y: 100 });
      const device2 = addDevice(topology, 'router', 'Router2', { x: 200, y: 200 });
      
      const link = createLink(
        topology,
        device1.id,
        device1.interfaces[0].id,
        device2.id,
        device2.interfaces[0].id
      );
      
      removeLink(topology, link!.id);
      
      expect(topology.links.size).toBe(0);
      expect(device1.interfaces[0].connectedTo).toBeNull();
      expect(device2.interfaces[0].connectedTo).toBeNull();
    });
  });

  describe('serializeTopology', () => {
    it('should serialize topology to JSON-compatible format', () => {
      const topology = createTopology();
      addDevice(topology, 'router', 'Router1', { x: 100, y: 100 });
      
      const serialized = serializeTopology(topology);
      
      expect(serialized.devices).toHaveLength(1);
      expect(serialized.devices[0].name).toBe('Router1');
      expect(serialized.links).toHaveLength(0);
      expect(serialized.version).toBe(1);
    });
  });

  describe('deserializeTopology', () => {
    it('should deserialize topology from JSON format', () => {
      const topology = createTopology();
      addDevice(topology, 'router', 'Router1', { x: 100, y: 100 });
      
      const serialized = serializeTopology(topology);
      const deserialized = deserializeTopology(serialized);
      
      expect(deserialized.devices.size).toBe(1);
      expect(deserialized.devices.get(serialized.devices[0].id)?.name).toBe('Router1');
    });
  });

  describe('generateMAC', () => {
    it('should generate valid MAC addresses', () => {
      const mac1 = generateMAC();
      const mac2 = generateMAC();
      
      expect(mac1).toMatch(/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/);
      expect(mac2).toMatch(/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/);
      expect(mac1).not.toBe(mac2);
    });
  });

  describe('findDeviceByName', () => {
    it('should find device by name (case insensitive)', () => {
      const topology = createTopology();
      addDevice(topology, 'router', 'Router1', { x: 100, y: 100 });
      
      expect(findDeviceByName(topology, 'Router1')).toBeDefined();
      expect(findDeviceByName(topology, 'router1')).toBeDefined();
      expect(findDeviceByName(topology, 'ROUTEr1')).toBeDefined();
      expect(findDeviceByName(topology, 'Router2')).toBeNull();
    });
  });
});
