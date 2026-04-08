/**
 * Terminal Component
 * Cisco-like CLI terminal using xterm.js
 * OPTIMIZED: Fixed memory leaks, stable callbacks, proper cleanup
 */

'use client';

import React, { useEffect, useRef, useCallback, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { useSimulationStore } from '../stores/simulationStore';

// ============================================================================
// Constants
// ============================================================================

const MAX_OUTPUT_LINES = 1000;
const MAX_INPUT_LENGTH = 1024;

// ============================================================================
// Terminal Component
// ============================================================================

interface TerminalProps {
  deviceId: string | null;
  height?: number;
}

export const Terminal: React.FC<TerminalProps> = React.memo(({ deviceId, height = 400 }) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const inputBufferRef = useRef('');
  const cursorPositionRef = useRef(0);
  const promptRef = useRef('Router>');
  
  // Local state for managing terminal output
  const [outputQueue, setOutputQueue] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Get store values with selective subscription
  const cliOutput = useSimulationStore(useCallback(state => state.currentCLIOutput, []));
  const storePrompt = useSimulationStore(useCallback(state => state.currentPrompt, []));
  const sendCLICommand = useSimulationStore(useCallback(state => state.sendCLICommand, []));

  // Update prompt ref when store prompt changes
  useEffect(() => {
    promptRef.current = storePrompt;
  }, [storePrompt]);

  // Initialize terminal - runs only once
  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new XTerm({
      cols: 80,
      rows: 24,
      fontSize: 14,
      fontFamily: 'Consolas, "Courier New", monospace',
      theme: {
        background: '#1E1E1E',
        foreground: '#CCCCCC',
        cursor: '#FFFFFF',
        selectionBackground: '#264F78',
      },
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: MAX_OUTPUT_LINES,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());

    term.open(terminalRef.current);
    fitAddon.fit();

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Initial banner
    term.writeln('\r\n\x1b[32mCisco Network Simulator\x1b[0m');
    term.writeln('Version 1.0.0 - Browser-Based Network Simulator');
    term.writeln('Copyright (c) 2024. All rights reserved.');
    term.writeln('');
    term.writeln('Type "help" for available commands.');
    term.writeln('');

    // Handle input
    const disposable = term.onData((data) => {
      const code = data.charCodeAt(0);

      // Handle special keys
      if (code === 13) {
        // Enter
        const command = inputBufferRef.current.trim();
        if (command) {
          term.writeln('');
          if (deviceId) {
            sendCLICommand(deviceId, command);
          } else {
            term.writeln('% No device selected. Please select a device first.');
            term.write(`\r\n${promptRef.current} `);
          }
        } else {
          term.write(`\r\n${promptRef.current} `);
        }
        inputBufferRef.current = '';
        cursorPositionRef.current = 0;
      } else if (code === 127) {
        // Backspace
        if (cursorPositionRef.current > 0) {
          inputBufferRef.current =
            inputBufferRef.current.slice(0, cursorPositionRef.current - 1) +
            inputBufferRef.current.slice(cursorPositionRef.current);
          cursorPositionRef.current--;
          refreshLine(term, promptRef.current);
        }
      } else if (code === 27 && data.length === 3) {
        // Arrow keys
        if (data[2] === 'C') {
          // Right arrow
          if (cursorPositionRef.current < inputBufferRef.current.length) {
            cursorPositionRef.current++;
            term.write('\x1b[C');
          }
        } else if (data[2] === 'D') {
          // Left arrow
          if (cursorPositionRef.current > 0) {
            cursorPositionRef.current--;
            term.write('\x1b[D');
          }
        }
      } else if (code === 3) {
        // Ctrl+C
        term.writeln('^C');
        inputBufferRef.current = '';
        cursorPositionRef.current = 0;
        term.write(`\r\n${promptRef.current} `);
      } else if (code >= 32 && code <= 126) {
        // Printable characters
        if (inputBufferRef.current.length < MAX_INPUT_LENGTH) {
          inputBufferRef.current =
            inputBufferRef.current.slice(0, cursorPositionRef.current) +
            data +
            inputBufferRef.current.slice(cursorPositionRef.current);
          cursorPositionRef.current++;
          refreshLine(term, promptRef.current);
        }
      }
    });

    // Initial prompt
    term.write(`\r\n${promptRef.current} `);

    // Handle resize
    const handleResize = () => {
      fitAddon.fit();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      disposable.dispose();
      term.dispose();
    };
  }, [deviceId, sendCLICommand]);

  // Refresh line helper - stable reference
  const refreshLine = useCallback((term: XTerm, prompt: string) => {
    // Clear current line
    term.write('\r\x1b[K');
    // Rewrite prompt and buffer
    term.write(`${prompt} ${inputBufferRef.current}`);
    // Move cursor to correct position
    const cursorOffset = inputBufferRef.current.length - cursorPositionRef.current;
    if (cursorOffset > 0) {
      term.write(`\x1b[${cursorOffset}D`);
    }
  }, []);

  // Process output queue
  useEffect(() => {
    const term = xtermRef.current;
    if (!term) return;

    // Split output by lines and add to queue
    const lines = cliOutput.split('\r\n').filter(line => line.trim());
    if (lines.length > 0) {
      setOutputQueue(prev => [...prev, ...lines]);
    }
  }, [cliOutput]);

  // Process output queue with rate limiting
  useEffect(() => {
    if (isProcessing || outputQueue.length === 0) return;

    setIsProcessing(true);
    const term = xtermRef.current;
    if (!term) {
      setIsProcessing(false);
      return;
    }

    // Process lines in batches
    const processBatch = () => {
      const batch = outputQueue.slice(0, 10);
      if (batch.length === 0) {
        setIsProcessing(false);
        term.write(`\r\n${promptRef.current} `);
        return;
      }

      batch.forEach(line => {
        if (line.trim()) {
          term.writeln(line);
        }
      });

      setOutputQueue(prev => prev.slice(batch.length));
      
      // Continue processing if more items
      if (outputQueue.length > batch.length) {
        setTimeout(processBatch, 10);
      } else {
        setIsProcessing(false);
        term.write(`\r\n${promptRef.current} `);
      }
    };

    processBatch();
  }, [outputQueue, isProcessing]);

  // Handle device selection change
  useEffect(() => {
    const term = xtermRef.current;
    if (!term) return;

    if (deviceId) {
      term.writeln(`\r\n\x1b[32m[Connected to device]\x1b[0m`);
    } else {
      term.writeln(`\r\n\x1b[33m[No device selected]\x1b[0m`);
    }
    term.write(`\r\n${promptRef.current} `);
  }, [deviceId]);

  return (
    <div
      style={{
        height,
        background: '#1E1E1E',
        borderRadius: '4px',
        overflow: 'hidden',
        border: '1px solid #333',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          background: '#333',
          padding: '4px 8px',
          fontSize: '12px',
          color: '#CCC',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0,
        }}
      >
        <span>Console</span>
        <span style={{ fontSize: '10px', color: '#888' }}>
          {deviceId ? 'Connected' : 'Not Connected'}
        </span>
      </div>
      <div
        ref={terminalRef}
        style={{
          flex: 1,
          padding: '4px',
          overflow: 'hidden',
        }}
      />
    </div>
  );
});

Terminal.displayName = 'Terminal';

export default Terminal;
