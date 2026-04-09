'use client';
import React from 'react';
import type { GradeResponse } from '../lib/api/types';

interface Props {
  result: GradeResponse;
  onClose: () => void;
}

export default function GradePanel({ result, onClose }: Props) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#1e1e2e', borderRadius: 16, padding: 32, maxWidth: 500, width: '90%', color: '#cdd6f4', maxHeight: '80vh', overflow: 'auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 48, fontWeight: 'bold', color: result.score >= 80 ? '#a6e3a1' : result.score >= 50 ? '#f9e2af' : '#f38ba8' }}>
            {result.score}%
          </div>
          <p style={{ color: '#a6adc8' }}>{result.passed}/{result.total} objectives passed</p>
        </div>

        {result.results.map(r => (
          <div key={r.id} style={{ display: 'flex', gap: 12, padding: '12px 0', borderBottom: '1px solid #313244' }}>
            <span style={{ fontSize: 20 }}>{r.passed ? '\u2705' : '\u274C'}</span>
            <div>
              <p style={{ margin: 0 }}>{r.description}</p>
              {r.reason && <p style={{ margin: '4px 0 0', fontSize: 13, color: '#f38ba8' }}>{r.reason}</p>}
            </div>
          </div>
        ))}

        <button onClick={onClose} style={{ marginTop: 24, width: '100%', padding: 12, borderRadius: 8, border: 'none', background: '#313244', color: '#cdd6f4', fontSize: 16, cursor: 'pointer' }}>
          Close
        </button>
      </div>
    </div>
  );
}
