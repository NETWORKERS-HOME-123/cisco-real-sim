/**
 * Main Page Component
 * Cisco Network Simulator Application
 */

'use client';

import React, { useEffect, useState, Suspense } from 'react';
import dynamicImport from 'next/dynamic';
import { Toolbar } from '../components/Toolbar';
import { Terminal } from '../components/Terminal';
import { PropertiesPanel } from '../components/PropertiesPanel';
import { useSimulationStore } from '../stores/simulationStore';

// Force dynamic rendering - no SSR
export const dynamic = 'force-dynamic';

// Dynamically import NetworkCanvas to avoid SSR issues with Konva
const NetworkCanvas = dynamicImport(() => import('../components/NetworkCanvas'), {
  ssr: false,
  loading: () => (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#F5F5F5',
      }}
    >
      <div>Loading Canvas...</div>
    </div>
  ),
});

// ============================================================================
// Main Page
// ============================================================================

export default function Home() {
  const { initWorker, ui } = useSimulationStore();
  const [canvasSize, setCanvasSize] = useState({ width: 1200, height: 600 });
  const [isClient, setIsClient] = useState(false);

  // Initialize worker on mount
  useEffect(() => {
    setIsClient(true);
    initWorker();
  }, [initWorker]);

  // Update canvas size on resize
  useEffect(() => {
    if (!isClient) return;
    
    const updateSize = () => {
      const container = document.getElementById('canvas-container');
      if (container) {
        setCanvasSize({
          width: container.clientWidth,
          height: container.clientHeight,
        });
      }
    };

    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, [isClient]);

  if (!isClient) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          fontFamily: 'sans-serif',
        }}
      >
        Loading Cisco Network Simulator...
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        overflow: 'hidden',
        background: '#F5F5F5',
      }}
    >
      {/* Toolbar */}
      <Toolbar />

      {/* Main Content */}
      <div
        style={{
          display: 'flex',
          flex: 1,
          overflow: 'hidden',
        }}
      >
        {/* Canvas Area */}
        <div
          id="canvas-container"
          style={{
            flex: 1,
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <Suspense
            fallback={
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                Loading Canvas...
              </div>
            }
          >
            <NetworkCanvas
              width={canvasSize.width}
              height={canvasSize.height}
            />
          </Suspense>
        </div>

        {/* Right Sidebar */}
        <PropertiesPanel />
      </div>

      {/* Bottom Terminal Panel */}
      <div
        style={{
          height: '300px',
          borderTop: '1px solid #E0E0E0',
          display: 'flex',
        }}
      >
        <div style={{ flex: 1 }}>
          <Terminal deviceId={ui.selectedDevice} height={300} />
        </div>
      </div>
    </div>
  );
}
