/**
 * Properties Panel Component
 * Shows device details and configuration
 */

'use client';

import React from 'react';
import { useSimulationStore } from '../stores/simulationStore';

// ============================================================================
// Interface Row Component
// ============================================================================

interface InterfaceRowProps {
  iface: {
    id: string;
    name: string;
    ip: string | null;
    subnetMask: string | null;
    mac: string;
    status: string;
    connectedTo: string | null;
    isShutdown: boolean;
    description: string;
  };
}

const InterfaceRow: React.FC<InterfaceRowProps> = ({ iface }) => {
  const statusColor = iface.isShutdown
    ? '#9B9B9B'
    : iface.connectedTo
    ? '#7ED321'
    : '#D0021B';

  return (
    <div
      style={{
        padding: '8px 12px',
        borderBottom: '1px solid #E0E0E0',
        fontSize: '12px',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '4px',
        }}
      >
        <span style={{ fontWeight: 'bold' }}>{iface.name}</span>
        <span
          style={{
            color: statusColor,
            fontSize: '10px',
            textTransform: 'uppercase',
          }}
        >
          {iface.status}
        </span>
      </div>
      <div style={{ color: '#666', fontSize: '11px' }}>
        <div>MAC: {iface.mac}</div>
        {iface.ip && (
          <div>
            IP: {iface.ip} / {iface.subnetMask}
          </div>
        )}
        {iface.description && (
          <div style={{ fontStyle: 'italic' }}>{iface.description}</div>
        )}
      </div>
    </div>
  );
};

// ============================================================================
// Route Row Component
// ============================================================================

interface RouteRowProps {
  route: {
    network: string;
    mask: string;
    nextHop: string | null;
    interface: string | null;
    protocol: string;
    metric: number;
  };
}

const RouteRow: React.FC<RouteRowProps> = ({ route }) => {
  const protocolColors: Record<string, string> = {
    C: '#4A90E2',
    S: '#F5A623',
    D: '#7ED321',
    O: '#BD10E0',
  };

  return (
    <div
      style={{
        padding: '8px 12px',
        borderBottom: '1px solid #E0E0E0',
        fontSize: '12px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
      }}
    >
      <span
        style={{
          background: protocolColors[route.protocol] || '#666',
          color: '#FFF',
          padding: '2px 6px',
          borderRadius: '3px',
          fontSize: '10px',
          fontWeight: 'bold',
          minWidth: '20px',
          textAlign: 'center',
        }}
      >
        {route.protocol}
      </span>
      <span>
        {route.network}/{getPrefixLength(route.mask)}
      </span>
      <span style={{ color: '#666' }}>
        {route.nextHop ? `via ${route.nextHop}` : route.interface}
      </span>
    </div>
  );
};

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
// Main Properties Panel
// ============================================================================

export const PropertiesPanel: React.FC = () => {
  const { ui, topology } = useSimulationStore();

  const selectedDevice = ui.selectedDevice
    ? topology?.devices.find((d) => d.id === ui.selectedDevice)
    : null;

  if (!selectedDevice) {
    return (
      <div
        style={{
          width: '300px',
          height: '100%',
          background: '#F5F5F5',
          borderLeft: '1px solid #E0E0E0',
          padding: '16px',
          overflow: 'auto',
        }}
      >
        <div
          style={{
            textAlign: 'center',
            color: '#999',
            marginTop: '50%',
          }}
        >
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>📋</div>
          <div>Select a device to view its properties</div>
        </div>
      </div>
    );
  }

  const isRouter = selectedDevice.type === 'router';

  return (
    <div
      style={{
        width: '300px',
        height: '100%',
        background: '#FFF',
        borderLeft: '1px solid #E0E0E0',
        overflow: 'auto',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '16px',
          background: isRouter ? '#4A90E2' : '#7ED321',
          color: '#FFF',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <span style={{ fontSize: '24px' }}>
            {isRouter ? '🔄' : '🔀'}
          </span>
          <div>
            <div style={{ fontSize: '18px', fontWeight: 'bold' }}>
              {selectedDevice.name}
            </div>
            <div style={{ fontSize: '12px', opacity: 0.9 }}>
              {isRouter ? 'Router' : 'Switch'}
            </div>
          </div>
        </div>
      </div>

      {/* Status */}
      <div
        style={{
          padding: '12px 16px',
          background: '#FAFAFA',
          borderBottom: '1px solid #E0E0E0',
          fontSize: '12px',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginBottom: '4px',
          }}
        >
          <span style={{ color: '#666' }}>Status:</span>
          <span
            style={{
              color: selectedDevice.isRunning ? '#7ED321' : '#D0021B',
              fontWeight: 'bold',
            }}
          >
            {selectedDevice.isRunning ? 'Running' : 'Stopped'}
          </span>
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <span style={{ color: '#666' }}>Interfaces:</span>
          <span>{selectedDevice.interfaces.length}</span>
        </div>
      </div>

      {/* Interfaces Section */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <div
          style={{
            padding: '12px 16px',
            background: '#F0F0F0',
            fontWeight: 'bold',
            fontSize: '12px',
            textTransform: 'uppercase',
            borderBottom: '1px solid #E0E0E0',
          }}
        >
          Interfaces
        </div>
        <div>
          {selectedDevice.interfaces.map((iface) => (
            <InterfaceRow key={iface.id} iface={iface} />
          ))}
        </div>

        {/* Routing Table (Routers only) */}
        {isRouter && selectedDevice.routingTable.length > 0 && (
          <>
            <div
              style={{
                padding: '12px 16px',
                background: '#F0F0F0',
                fontWeight: 'bold',
                fontSize: '12px',
                textTransform: 'uppercase',
                borderBottom: '1px solid #E0E0E0',
                borderTop: '1px solid #E0E0E0',
              }}
            >
              Routing Table
            </div>
            <div>
              {selectedDevice.routingTable.map((route, index) => (
                <RouteRow key={index} route={route} />
              ))}
            </div>
          </>
        )}

        {/* ARP Table (Routers only) */}
        {isRouter && selectedDevice.arpTable.length > 0 && (
          <>
            <div
              style={{
                padding: '12px 16px',
                background: '#F0F0F0',
                fontWeight: 'bold',
                fontSize: '12px',
                textTransform: 'uppercase',
                borderBottom: '1px solid #E0E0E0',
                borderTop: '1px solid #E0E0E0',
              }}
            >
              ARP Table
            </div>
            <div>
              {selectedDevice.arpTable.map(([ip, mac], index) => (
                <div
                  key={index}
                  style={{
                    padding: '8px 12px',
                    borderBottom: '1px solid #E0E0E0',
                    fontSize: '12px',
                  }}
                >
                  <div>{ip}</div>
                  <div style={{ color: '#666', fontSize: '11px' }}>{mac}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* MAC Table (Switches only) */}
        {!isRouter && selectedDevice.macTable.length > 0 && (
          <>
            <div
              style={{
                padding: '12px 16px',
                background: '#F0F0F0',
                fontWeight: 'bold',
                fontSize: '12px',
                textTransform: 'uppercase',
                borderBottom: '1px solid #E0E0E0',
                borderTop: '1px solid #E0E0E0',
              }}
            >
              MAC Address Table
            </div>
            <div>
              {selectedDevice.macTable.map(([mac, interfaceId], index) => {
                const iface = selectedDevice.interfaces.find(
                  (i) => i.id === interfaceId
                );
                return (
                  <div
                    key={index}
                    style={{
                      padding: '8px 12px',
                      borderBottom: '1px solid #E0E0E0',
                      fontSize: '12px',
                    }}
                  >
                    <div style={{ fontSize: '11px', fontFamily: 'monospace' }}>
                      {mac}
                    </div>
                    <div style={{ color: '#666' }}>
                      {iface?.name || interfaceId}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Quick Help */}
      <div
        style={{
          padding: '12px 16px',
          background: '#FAFAFA',
          borderTop: '1px solid #E0E0E0',
          fontSize: '11px',
          color: '#666',
        }}
      >
        <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
          CLI Quick Reference:
        </div>
        <div>enable - Enter privileged mode</div>
        <div>configure terminal - Enter config mode</div>
        <div>interface [name] - Configure interface</div>
        <div>ip address [ip] [mask] - Set IP address</div>
        <div>no shutdown - Enable interface</div>
        <div>show ip route - View routing table</div>
      </div>
    </div>
  );
};

export default PropertiesPanel;
