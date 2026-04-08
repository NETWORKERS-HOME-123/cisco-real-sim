/**
 * Zustand Store for Simulation State
 * Manages UI state and communicates with the Web Worker
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import {
  UIState,
  SerializedTopology,
  PacketAnimation,
  Device,
  SerializedDevice,
} from '../lib/types';

// ============================================================================
// Store State Interface
// ============================================================================

interface SimulationState {
  // Topology data
  topology: SerializedTopology | null;
  
  // UI State
  ui: UIState;
  
  // Simulation status
  isConnected: boolean;
  eventCount: number;
  
  // Web Worker
  worker: Worker | null;
  
  // CLI State
  cliHistory: Map<string, string[]>; // deviceId -> command history
  currentCLIOutput: string;
  currentPrompt: string;
  
  // Actions
  initWorker: () => void;
  updateTopology: (topology: SerializedTopology) => void;
  sendCLICommand: (deviceId: string, command: string) => void;
  selectDevice: (deviceId: string | null) => void;
  selectTool: (tool: UIState['selectedTool']) => void;
  updateZoom: (zoom: number) => void;
  updatePan: (pan: { x: number; y: number }) => void;
  toggleGrid: () => void;
  addPacketAnimation: (animation: PacketAnimation) => void;
  removePacketAnimation: (animationId: string) => void;
  setCLIOutput: (output: string, append?: boolean) => void;
  setPrompt: (prompt: string) => void;
}

// ============================================================================
// Initial State
// ============================================================================

const createInitialUIState = (): UIState => ({
  selectedDevice: null,
  selectedTool: 'select',
  zoom: 1,
  pan: { x: 0, y: 0 },
  showGrid: true,
  packetAnimations: new Map(),
});

const createInitialTopology = (): SerializedTopology => ({
  devices: [],
  links: [],
  version: 0,
});

// ============================================================================
// Worker Creation - Client-side only
// ============================================================================

function createWorker(): Worker | null {
  if (typeof window === 'undefined') return null;
  try {
    // Load worker from public folder
    return new Worker('/simulation.worker.js');
  } catch (error) {
    console.error('Failed to create worker:', error);
    return null;
  }
}

// ============================================================================
// Store Creation
// ============================================================================

export const useSimulationStore = create<SimulationState>()(
  immer((set, get) => ({
    // Initial state
    topology: createInitialTopology(),
    ui: createInitialUIState(),
    isConnected: false,
    eventCount: 0,
    worker: null,
    cliHistory: new Map(),
    currentCLIOutput: '',
    currentPrompt: 'Router>',

    // Initialize Web Worker
    initWorker: () => {
      if (typeof window === 'undefined') return;

      set((state) => {
        if (state.worker) {
          state.worker.terminate();
        }

        const worker = createWorker();

        if (worker) {
          worker.onmessage = (event) => {
            const { type, payload } = event.data;

            switch (type) {
              case 'STATE_UPDATE':
                set((s) => {
                  s.topology = payload.topology;
                  s.eventCount = payload.eventCount;
                });
                break;

              case 'CLI_RESPONSE':
                set((s) => {
                  if (payload.output) {
                    s.currentCLIOutput += payload.output + '\r\n';
                  }
                  if (payload.prompt) {
                    s.currentPrompt = payload.prompt;
                  }
                  if (payload.stateChanged) {
                    s.worker?.postMessage({
                      type: 'TOPOLOGY_UPDATE',
                      payload: { topology: s.topology },
                    });
                  }
                });
                break;

              case 'ANIMATION_EVENT':
                if (payload.type === 'packet_start') {
                  const animation: PacketAnimation = {
                    id: `anim-${payload.packetId}`,
                    packetId: payload.packetId,
                    srcDevice: payload.srcDevice,
                    dstDevice: '',
                    progress: 0,
                    status: 'in-transit',
                    color: '#FF6B6B',
                  };
                  set((s) => {
                    s.ui.packetAnimations.set(animation.id, animation);
                  });
                } else if (payload.type === 'packet_end') {
                  set((s) => {
                    s.ui.packetAnimations.delete(`anim-${payload.packetId}`);
                  });
                }
                break;

              case 'ERROR':
                console.error('Worker error:', payload);
                break;
            }
          };

          worker.onerror = (error) => {
            console.error('Worker error:', error);
          };

          worker.postMessage({ type: 'INIT', payload: {} });
        }

        state.worker = worker;
        state.isConnected = !!worker;
      });
    },

    // Update topology
    updateTopology: (topology: SerializedTopology) => {
      set((state) => {
        state.topology = topology;
        state.worker?.postMessage({
          type: 'TOPOLOGY_UPDATE',
          payload: { topology },
        });
      });
    },

    // Send CLI command
    sendCLICommand: (deviceId: string, command: string) => {
      set((state) => {
        const history = state.cliHistory.get(deviceId) || [];
        history.push(command);
        state.cliHistory.set(deviceId, history);

        state.worker?.postMessage({
          type: 'CLI_COMMAND',
          payload: { deviceId, command },
        });
      });
    },

    // Select device
    selectDevice: (deviceId: string | null) => {
      set((state) => {
        state.ui.selectedDevice = deviceId;
        if (deviceId && state.topology) {
          const device = state.topology.devices.find((d) => d.id === deviceId);
          if (device) {
            state.currentPrompt = `${device.name}>`;
          }
        }
      });
    },

    // Select tool
    selectTool: (tool: UIState['selectedTool']) => {
      set((state) => {
        state.ui.selectedTool = tool;
      });
    },

    // Update zoom
    updateZoom: (zoom: number) => {
      set((state) => {
        state.ui.zoom = Math.max(0.1, Math.min(5, zoom));
      });
    },

    // Update pan
    updatePan: (pan: { x: number; y: number }) => {
      set((state) => {
        state.ui.pan = pan;
      });
    },

    // Toggle grid
    toggleGrid: () => {
      set((state) => {
        state.ui.showGrid = !state.ui.showGrid;
      });
    },

    // Add packet animation
    addPacketAnimation: (animation: PacketAnimation) => {
      set((state) => {
        state.ui.packetAnimations.set(animation.id, animation);
      });
    },

    // Remove packet animation
    removePacketAnimation: (animationId: string) => {
      set((state) => {
        state.ui.packetAnimations.delete(animationId);
      });
    },

    // Set CLI output
    setCLIOutput: (output: string, append = false) => {
      set((state) => {
        if (append) {
          state.currentCLIOutput += output;
        } else {
          state.currentCLIOutput = output;
        }
      });
    },

    // Set prompt
    setPrompt: (prompt: string) => {
      set((state) => {
        state.currentPrompt = prompt;
      });
    },
  }))
);

// ============================================================================
// Selectors
// ============================================================================

export const selectDevices = (state: SimulationState): SerializedDevice[] => {
  return state.topology?.devices || [];
};

export const selectLinks = (state: SimulationState) => {
  return state.topology?.links || [];
};

export const selectSelectedDevice = (
  state: SimulationState
): SerializedDevice | null => {
  if (!state.topology || !state.ui.selectedDevice) return null;
  return (
    state.topology.devices.find((d) => d.id === state.ui.selectedDevice) || null
  );
};

export const selectDeviceById = (
  state: SimulationState,
  deviceId: string
): SerializedDevice | null => {
  if (!state.topology) return null;
  return state.topology.devices.find((d) => d.id === deviceId) || null;
};
