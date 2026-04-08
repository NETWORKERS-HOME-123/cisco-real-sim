/**
 * Network Canvas Component
 * Konva.js-based network topology visualization
 * OPTIMIZED: Memoized components, reduced re-renders, proper cleanup
 */

'use client';

import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { Stage, Layer, Circle, Line, Text, Group } from 'react-konva';
import { KonvaEventObject } from 'konva/lib/Node';
import { SerializedDevice, SerializedTopology } from '../lib/types';
import { useSimulationStore } from '../stores/simulationStore';

// ============================================================================
// Constants
// ============================================================================

const DEVICE_COLORS = {
  router: '#4A90E2',
  switch: '#7ED321',
  selected: '#F5A623',
};

const INTERFACE_COLORS = {
  up: '#7ED321',
  down: '#D0021B',
  adminDown: '#9B9B9B',
};

const DEVICE_SIZE = 40;
const LINK_STROKE = 2;

// ============================================================================
// Memoized Device Node Component
// ============================================================================

interface DeviceNodeProps {
  device: SerializedDevice;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
}

const DeviceNode: React.FC<DeviceNodeProps> = React.memo(({
  device,
  isSelected,
  onSelect,
  onDragEnd,
}) => {
  const color = isSelected ? DEVICE_COLORS.selected : DEVICE_COLORS[device.type];
  const icon = device.type === 'router' ? 'R' : 'S';

  const handleClick = useCallback(() => {
    onSelect(device.id);
  }, [onSelect, device.id]);

  const handleDragEnd = useCallback((e: KonvaEventObject<DragEvent>) => {
    onDragEnd(device.id, e.target.x(), e.target.y());
  }, [onDragEnd, device.id]);

  return (
    <Group
      x={device.position.x}
      y={device.position.y}
      draggable
      onClick={handleClick}
      onTap={handleClick}
      onDragEnd={handleDragEnd}
    >
      {/* Device shadow */}
      <Circle
        radius={DEVICE_SIZE / 2 + 4}
        fill="rgba(0,0,0,0.2)"
        x={2}
        y={2}
      />
      
      {/* Device body */}
      <Circle
        radius={DEVICE_SIZE / 2}
        fill={color}
        stroke={isSelected ? '#FFFFFF' : '#333333'}
        strokeWidth={isSelected ? 3 : 2}
        shadowColor="black"
        shadowBlur={5}
        shadowOffset={{ x: 2, y: 2 }}
        shadowOpacity={0.3}
      />
      
      {/* Device icon */}
      <Text
        text={icon}
        fontSize={20}
        fontFamily="Arial"
        fontStyle="bold"
        fill="#FFFFFF"
        width={DEVICE_SIZE}
        height={DEVICE_SIZE}
        align="center"
        verticalAlign="middle"
        offsetX={DEVICE_SIZE / 2}
        offsetY={DEVICE_SIZE / 2}
      />
      
      {/* Device name */}
      <Text
        text={device.name}
        fontSize={12}
        fontFamily="Arial"
        fill="#333333"
        width={120}
        align="center"
        offsetX={60}
        offsetY={DEVICE_SIZE / 2 + 20}
        fontStyle={isSelected ? 'bold' : 'normal'}
      />
      
      {/* Interface indicators */}
      {device.interfaces.slice(0, 4).map((iface, index) => {
        const angle = (index * 90 + 45) * (Math.PI / 180);
        const radius = DEVICE_SIZE / 2 + 8;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        
        let statusColor = INTERFACE_COLORS.adminDown;
        if (!iface.isShutdown) {
          statusColor = iface.connectedTo ? INTERFACE_COLORS.up : INTERFACE_COLORS.down;
        }
        
        return (
          <Circle
            key={iface.id}
            x={x}
            y={y}
            radius={4}
            fill={statusColor}
            stroke="#333333"
            strokeWidth={1}
          />
        );
      })}
    </Group>
  );
});

DeviceNode.displayName = 'DeviceNode';

// ============================================================================
// Memoized Link Component
// ============================================================================

interface LinkLineProps {
  from: { x: number; y: number };
  to: { x: number; y: number };
  status: 'up' | 'down';
}

const LinkLine: React.FC<LinkLineProps> = React.memo(({ from, to, status }) => {
  const color = status === 'up' ? '#4A90E2' : '#D0021B';

  return (
    <Line
      points={[from.x, from.y, to.x, to.y]}
      stroke={color}
      strokeWidth={LINK_STROKE}
      lineCap="round"
      lineJoin="round"
    />
  );
});

LinkLine.displayName = 'LinkLine';

// ============================================================================
// Memoized Grid Component - Only re-renders when dimensions change
// ============================================================================

interface GridProps {
  width: number;
  height: number;
  gridSize?: number;
}

const Grid: React.FC<GridProps> = React.memo(({ width, height, gridSize = 20 }) => {
  const lines = useMemo(() => {
    const result: React.ReactElement[] = [];
    
    // Vertical lines
    for (let i = 0; i < width; i += gridSize) {
      result.push(
        <Line
          key={`v-${i}`}
          points={[i, 0, i, height]}
          stroke="#E0E0E0"
          strokeWidth={1}
        />
      );
    }
    
    // Horizontal lines
    for (let i = 0; i < height; i += gridSize) {
      result.push(
        <Line
          key={`h-${i}`}
          points={[0, i, width, i]}
          stroke="#E0E0E0"
          strokeWidth={1}
        />
      );
    }
    
    return result;
  }, [width, height, gridSize]);
  
  return <>{lines}</>;
});

Grid.displayName = 'Grid';

// ============================================================================
// Main Canvas Component
// ============================================================================

interface NetworkCanvasProps {
  width?: number;
  height?: number;
}

const NetworkCanvas: React.FC<NetworkCanvasProps> = ({
  width = 1200,
  height = 800,
}) => {
  // Use selective subscriptions to prevent unnecessary re-renders
  const topology = useSimulationStore(useCallback(state => state.topology, []));
  const selectedDevice = useSimulationStore(useCallback(state => state.ui.selectedDevice, []));
  const zoom = useSimulationStore(useCallback(state => state.ui.zoom, []));
  const pan = useSimulationStore(useCallback(state => state.ui.pan, []));
  const showGrid = useSimulationStore(useCallback(state => state.ui.showGrid, []));
  const packetAnimations = useSimulationStore(useCallback(state => state.ui.packetAnimations, []));
  
  // Get actions separately to avoid re-renders
  const selectDevice = useSimulationStore(useCallback(state => state.selectDevice, []));
  const updateTopology = useSimulationStore(useCallback(state => state.updateTopology, []));
  const updatePan = useSimulationStore(useCallback(state => state.updatePan, []));
  const updateZoom = useSimulationStore(useCallback(state => state.updateZoom, []));

  const stageRef = useRef<any>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [lastPos, setLastPos] = useState({ x: 0, y: 0 });

  // Memoize device positions lookup
  const devicePositions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    if (topology) {
      topology.devices.forEach(device => {
        map.set(device.id, device.position);
      });
    }
    return map;
  }, [topology]);

  // Get device position by ID - memoized
  const getDevicePosition = useCallback((deviceId: string) => {
    return devicePositions.get(deviceId) || null;
  }, [devicePositions]);

  // Handle device drag end - stable callback
  const handleDeviceDragEnd = useCallback(
    (deviceId: string, x: number, y: number) => {
      if (!topology) return;

      const updatedTopology: SerializedTopology = {
        ...topology,
        devices: topology.devices.map((d) =>
          d.id === deviceId ? { ...d, position: { x, y } } : d
        ),
        version: topology.version + 1,
      };

      updateTopology(updatedTopology);
    },
    [topology, updateTopology]
  );

  // Handle device selection - stable callback
  const handleSelectDevice = useCallback((id: string) => {
    selectDevice(id);
  }, [selectDevice]);

  // Handle stage mouse down for panning
  const handleStageMouseDown = useCallback((e: KonvaEventObject<MouseEvent>) => {
    const stage = e.target.getStage();
    if (!stage) return;

    // Only pan if clicking on empty space
    if (e.target === stage) {
      setIsDragging(true);
      setLastPos({ x: e.evt.clientX, y: e.evt.clientY });
    }
  }, []);

  // Handle stage mouse move for panning
  const handleStageMouseMove = useCallback((e: KonvaEventObject<MouseEvent>) => {
    if (!isDragging) return;

    const dx = e.evt.clientX - lastPos.x;
    const dy = e.evt.clientY - lastPos.y;

    updatePan({
      x: pan.x + dx,
      y: pan.y + dy,
    });

    setLastPos({ x: e.evt.clientX, y: e.evt.clientY });
  }, [isDragging, lastPos, pan.x, pan.y, updatePan]);

  // Handle stage mouse up
  const handleStageMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Handle wheel for zooming
  const handleWheel = useCallback((e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const scaleBy = 1.1;
    const stage = stageRef.current;
    if (!stage) return;

    const oldScale = zoom;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    
    const mousePointTo = {
      x: pointer.x / oldScale - pan.x,
      y: pointer.y / oldScale - pan.y,
    };

    const newScale = e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;
    const clampedScale = Math.max(0.1, Math.min(5, newScale));

    updateZoom(clampedScale);
    updatePan({
      x: pointer.x / clampedScale - mousePointTo.x,
      y: pointer.y / clampedScale - mousePointTo.y,
    });
  }, [zoom, pan.x, pan.y, updateZoom, updatePan]);

  // Memoize device nodes to prevent unnecessary re-renders
  const deviceNodes = useMemo(() => {
    if (!topology) return null;
    return topology.devices.map((device) => (
      <DeviceNode
        key={device.id}
        device={device}
        isSelected={selectedDevice === device.id}
        onSelect={handleSelectDevice}
        onDragEnd={handleDeviceDragEnd}
      />
    ));
  }, [topology, selectedDevice, handleSelectDevice, handleDeviceDragEnd]);

  // Memoize link lines
  const linkLines = useMemo(() => {
    if (!topology) return null;
    return topology.links.map((link) => {
      const fromParts = link.from.split('/');
      const toParts = link.to.split('/');
      const fromPos = getDevicePosition(fromParts[0]);
      const toPos = getDevicePosition(toParts[0]);

      if (!fromPos || !toPos) return null;

      return (
        <LinkLine
          key={link.id}
          from={fromPos}
          to={toPos}
          status={link.status}
        />
      );
    });
  }, [topology, getDevicePosition]);

  // Memoize packet animations
  const packetAnimationNodes = useMemo(() => {
    return Array.from(packetAnimations.values()).map((anim) => {
      const srcPos = getDevicePosition(anim.srcDevice);
      if (!srcPos) return null;

      return (
        <Circle
          key={anim.id}
          x={srcPos.x}
          y={srcPos.y}
          radius={6}
          fill={anim.color}
          shadowColor={anim.color}
          shadowBlur={10}
        />
      );
    });
  }, [packetAnimations, getDevicePosition]);

  if (!topology) {
    return (
      <div
        style={{
          width,
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#F5F5F5',
        }}
      >
        <div>Loading...</div>
      </div>
    );
  }

  return (
    <Stage
      width={width}
      height={height}
      ref={stageRef}
      onMouseDown={handleStageMouseDown}
      onMouseMove={handleStageMouseMove}
      onMouseUp={handleStageMouseUp}
      onWheel={handleWheel}
      scaleX={zoom}
      scaleY={zoom}
      x={pan.x}
      y={pan.y}
      style={{
        background: '#FAFAFA',
        border: '1px solid #E0E0E0',
        cursor: isDragging ? 'grabbing' : 'default',
      }}
    >
      {/* Grid Layer - only renders when showGrid is true */}
      {showGrid && (
        <Layer>
          <Grid width={width * 2} height={height * 2} />
        </Layer>
      )}

      {/* Links Layer */}
      <Layer>
        {linkLines}
      </Layer>

      {/* Devices Layer */}
      <Layer>
        {deviceNodes}
      </Layer>

      {/* Packet Animation Layer */}
      <Layer>
        {packetAnimationNodes}
      </Layer>
    </Stage>
  );
};

export default React.memo(NetworkCanvas);
