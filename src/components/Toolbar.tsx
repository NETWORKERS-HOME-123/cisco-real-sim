/**
 * Toolbar Component
 * Device creation and topology management tools
 * SECURITY: All imports validated to prevent prototype pollution
 */

'use client';

import React, { useState, useCallback } from 'react';
import { useSimulationStore } from '../stores/simulationStore';
import { SerializedTopology } from '../lib/types';
import {
  addDevice,
  createLink,
  removeDevice,
  getNextDeviceName,
  serializeTopology,
  deserializeTopology,
} from '../lib/topology/topologyEngine';
import { validateTopology } from '../lib/validation/topologySchema';

// ============================================================================
// Toolbar Button Component
// ============================================================================

interface ToolbarButtonProps {
  onClick: () => void;
  icon: string;
  label: string;
  isActive?: boolean;
  color?: string;
  disabled?: boolean;
}

const ToolbarButton: React.FC<ToolbarButtonProps> = React.memo(({
  onClick,
  icon,
  label,
  isActive = false,
  color = '#4A90E2',
  disabled = false,
}) => (
  <button
    onClick={onClick}
    disabled={disabled}
    style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '8px 16px',
      margin: '0 4px',
      border: isActive ? `2px solid ${color}` : '2px solid transparent',
      borderRadius: '4px',
      background: isActive ? `${color}20` : '#FFF',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      transition: 'all 0.2s',
      minWidth: '60px',
    }}
    onMouseEnter={(e) => {
      if (!isActive && !disabled) {
        e.currentTarget.style.background = '#F0F0F0';
      }
    }}
    onMouseLeave={(e) => {
      if (!isActive && !disabled) {
        e.currentTarget.style.background = '#FFF';
      }
    }}
  >
    <span style={{ fontSize: '24px', marginBottom: '4px' }}>{icon}</span>
    <span style={{ fontSize: '11px', color: '#333' }}>{label}</span>
  </button>
));

ToolbarButton.displayName = 'ToolbarButton';

// ============================================================================
// Main Toolbar Component
// ============================================================================

const MAX_IMPORT_SIZE = 10 * 1024 * 1024; // 10MB limit

export const Toolbar: React.FC = React.memo(() => {
  const {
    topology,
    ui,
    updateTopology,
    selectDevice,
  } = useSimulationStore();

  const [showExportModal, setShowExportModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importData, setImportData] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  // Add router - memoized callback
  const handleAddRouter = useCallback(() => {
    if (!topology) return;

    const topologyObj = deserializeTopology(topology);
    const name = getNextDeviceName(topologyObj, 'router');
    const position = {
      x: 100 + Math.random() * 200,
      y: 100 + Math.random() * 200,
    };

    addDevice(topologyObj, 'router', name, position);
    const updatedTopology = serializeTopology(topologyObj);
    updateTopology(updatedTopology);
  }, [topology, updateTopology]);

  // Add switch - memoized callback
  const handleAddSwitch = useCallback(() => {
    if (!topology) return;

    const topologyObj = deserializeTopology(topology);
    const name = getNextDeviceName(topologyObj, 'switch');
    const position = {
      x: 100 + Math.random() * 200,
      y: 100 + Math.random() * 200,
    };

    addDevice(topologyObj, 'switch', name, position);
    const updatedTopology = serializeTopology(topologyObj);
    updateTopology(updatedTopology);
  }, [topology, updateTopology]);

  // Delete selected device - memoized callback
  const handleDelete = useCallback(() => {
    if (!topology || !ui.selectedDevice) return;

    const topologyObj = deserializeTopology(topology);
    removeDevice(topologyObj, ui.selectedDevice);
    const updatedTopology = serializeTopology(topologyObj);
    updateTopology(updatedTopology);
    selectDevice(null);
  }, [topology, ui.selectedDevice, updateTopology, selectDevice]);

  // Clear all - memoized callback
  const handleClear = useCallback(() => {
    if (!confirm('Are you sure you want to clear all devices?')) return;

    const emptyTopology: SerializedTopology = {
      devices: [],
      links: [],
      version: 0,
    };
    updateTopology(emptyTopology);
    selectDevice(null);
  }, [updateTopology, selectDevice]);

  // Export topology - memoized callback
  const handleExport = useCallback(() => {
    if (!topology) return;
    setShowExportModal(true);
  }, [topology]);

  // Import topology - with validation and security checks
  const handleImportConfirm = useCallback(async () => {
    setImportError(null);
    setIsImporting(true);

    try {
      // Check size limit
      if (importData.length > MAX_IMPORT_SIZE) {
        throw new Error('Import data too large (max 10MB)');
      }

      // Validate and sanitize the data
      const validatedData = validateTopology(JSON.parse(importData));
      
      updateTopology(validatedData as SerializedTopology);
      setShowImportModal(false);
      setImportData('');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setImportError(`Import failed: ${errorMessage}`);
      console.error('Import error:', error);
    } finally {
      setIsImporting(false);
    }
  }, [importData, updateTopology]);

  // Toggle grid - memoized callback
  const handleToggleGrid = useCallback(() => {
    const store = useSimulationStore.getState();
    store.toggleGrid();
  }, []);

  // Close modals - memoized callbacks
  const closeExportModal = useCallback(() => setShowExportModal(false), []);
  const closeImportModal = useCallback(() => {
    setShowImportModal(false);
    setImportError(null);
    setImportData('');
  }, []);

  // Stop propagation for modal clicks
  const stopPropagation = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '8px 16px',
        background: '#FFF',
        borderBottom: '1px solid #E0E0E0',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
      }}
    >
      {/* Logo */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          marginRight: '24px',
          paddingRight: '24px',
          borderRight: '1px solid #E0E0E0',
        }}
      >
        <span style={{ fontSize: '20px', marginRight: '8px' }}>🌐</span>
        <span
          style={{
            fontSize: '16px',
            fontWeight: 'bold',
            color: '#333',
          }}
        >
          Cisco Sim
        </span>
      </div>

      {/* Device Tools */}
      <div style={{ display: 'flex', marginRight: '24px' }}>
        <ToolbarButton
          onClick={handleAddRouter}
          icon="🔄"
          label="Add Router"
          color="#4A90E2"
        />
        <ToolbarButton
          onClick={handleAddSwitch}
          icon="🔀"
          label="Add Switch"
          color="#7ED321"
        />
      </div>

      {/* Edit Tools */}
      <div
        style={{
          display: 'flex',
          marginRight: '24px',
          paddingRight: '24px',
          borderRight: '1px solid #E0E0E0',
        }}
      >
        <ToolbarButton
          onClick={() => useSimulationStore.getState().selectTool('select')}
          icon="👆"
          label="Select"
          isActive={ui.selectedTool === 'select'}
        />
        <ToolbarButton
          onClick={() => useSimulationStore.getState().selectTool('link')}
          icon="🔗"
          label="Link"
          isActive={ui.selectedTool === 'link'}
        />
        <ToolbarButton
          onClick={handleDelete}
          icon="🗑️"
          label="Delete"
          color="#D0021B"
          disabled={!ui.selectedDevice}
        />
        <ToolbarButton
          onClick={handleClear}
          icon="🧹"
          label="Clear All"
          color="#D0021B"
        />
      </div>

      {/* View Tools */}
      <div
        style={{
          display: 'flex',
          marginRight: '24px',
          paddingRight: '24px',
          borderRight: '1px solid #E0E0E0',
        }}
      >
        <ToolbarButton
          onClick={handleToggleGrid}
          icon="⊞"
          label="Grid"
          isActive={ui.showGrid}
        />
      </div>

      {/* File Operations */}
      <div style={{ display: 'flex' }}>
        <ToolbarButton
          onClick={handleExport}
          icon="💾"
          label="Export"
        />
        <ToolbarButton
          onClick={() => setShowImportModal(true)}
          icon="📂"
          label="Import"
        />
      </div>

      {/* Export Modal */}
      {showExportModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={closeExportModal}
        >
          <div
            style={{
              background: '#FFF',
              padding: '24px',
              borderRadius: '8px',
              minWidth: '400px',
              maxWidth: '600px',
              maxHeight: '80vh',
              display: 'flex',
              flexDirection: 'column',
            }}
            onClick={stopPropagation}
          >
            <h3 style={{ margin: '0 0 16px' }}>Export Topology</h3>
            <textarea
              readOnly
              value={JSON.stringify(topology, null, 2)}
              style={{
                width: '100%',
                height: '300px',
                fontFamily: 'monospace',
                fontSize: '12px',
                padding: '8px',
                border: '1px solid #CCC',
                borderRadius: '4px',
                resize: 'none',
                flex: 1,
              }}
            />
            <div style={{ marginTop: '16px', textAlign: 'right' }}>
              <button
                onClick={closeExportModal}
                style={{
                  padding: '8px 16px',
                  border: 'none',
                  borderRadius: '4px',
                  background: '#4A90E2',
                  color: '#FFF',
                  cursor: 'pointer',
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import Modal */}
      {showImportModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={closeImportModal}
        >
          <div
            style={{
              background: '#FFF',
              padding: '24px',
              borderRadius: '8px',
              minWidth: '400px',
              maxWidth: '600px',
              maxHeight: '80vh',
              display: 'flex',
              flexDirection: 'column',
            }}
            onClick={stopPropagation}
          >
            <h3 style={{ margin: '0 0 16px' }}>Import Topology</h3>
            {importError && (
              <div
                style={{
                  background: '#FEE',
                  color: '#C00',
                  padding: '12px',
                  borderRadius: '4px',
                  marginBottom: '16px',
                  fontSize: '12px',
                }}
              >
                {importError}
              </div>
            )}
            <textarea
              value={importData}
              onChange={(e) => setImportData(e.target.value)}
              placeholder="Paste JSON topology data here..."
              disabled={isImporting}
              style={{
                width: '100%',
                height: '300px',
                fontFamily: 'monospace',
                fontSize: '12px',
                padding: '8px',
                border: '1px solid #CCC',
                borderRadius: '4px',
                resize: 'none',
                flex: 1,
                opacity: isImporting ? 0.7 : 1,
              }}
            />
            <div style={{ marginTop: '16px', textAlign: 'right' }}>
              <button
                onClick={closeImportModal}
                disabled={isImporting}
                style={{
                  padding: '8px 16px',
                  marginRight: '8px',
                  border: '1px solid #CCC',
                  borderRadius: '4px',
                  background: '#FFF',
                  cursor: isImporting ? 'not-allowed' : 'pointer',
                  opacity: isImporting ? 0.5 : 1,
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleImportConfirm}
                disabled={isImporting || !importData.trim()}
                style={{
                  padding: '8px 16px',
                  border: 'none',
                  borderRadius: '4px',
                  background: '#4A90E2',
                  color: '#FFF',
                  cursor: isImporting || !importData.trim() ? 'not-allowed' : 'pointer',
                  opacity: isImporting || !importData.trim() ? 0.5 : 1,
                }}
              >
                {isImporting ? 'Importing...' : 'Import'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

Toolbar.displayName = 'Toolbar';

export default Toolbar;
