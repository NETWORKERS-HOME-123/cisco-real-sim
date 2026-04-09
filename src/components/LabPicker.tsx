'use client';
import React, { useEffect, useState } from 'react';
import * as api from '../lib/api/client';
import type { LabSummary, PresetSummary } from '../lib/api/types';

interface Props {
  onLoadLab: (labId: string) => void;
  onLoadPreset: (presetId: string) => void;
  onNewLab: () => void;
}

export default function LabPicker({ onLoadLab, onLoadPreset, onNewLab }: Props) {
  const [labs, setLabs] = useState<LabSummary[]>([]);
  const [presets, setPresets] = useState<PresetSummary[]>([]);
  const [tab, setTab] = useState<'my' | 'presets'>('presets');

  useEffect(() => {
    api.listLabs().then(setLabs).catch(() => {});
    api.listPresets().then(setPresets).catch(() => {});
  }, []);

  const difficultyColor: Record<string, string> = {
    beginner: '#a6e3a1', intermediate: '#f9e2af', advanced: '#f38ba8',
  };

  const tabStyle: React.CSSProperties = {
    background: 'none', border: 'none', color: '#cdd6f4', fontSize: 16, padding: '8px 0', cursor: 'pointer',
  };

  const cardStyle: React.CSSProperties = {
    padding: 20, background: '#1e1e2e', borderRadius: 12, cursor: 'pointer',
    border: '1px solid #313244',
  };

  return (
    <div style={{ padding: 32, maxWidth: 1000, margin: '0 auto', color: '#cdd6f4' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ margin: 0 }}>Labs</h1>
        <button onClick={onNewLab} style={{ padding: '8px 20px', borderRadius: 6, border: 'none', background: '#89b4fa', color: '#1e1e2e', fontWeight: 'bold', cursor: 'pointer' }}>
          + New Lab
        </button>
      </div>

      <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
        <button onClick={() => setTab('presets')} style={{ ...tabStyle, borderBottom: tab === 'presets' ? '2px solid #89b4fa' : 'none' }}>Preset Labs</button>
        <button onClick={() => setTab('my')} style={{ ...tabStyle, borderBottom: tab === 'my' ? '2px solid #89b4fa' : 'none' }}>My Labs ({labs.length})</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
        {tab === 'presets' && presets.map(p => (
          <div key={p.id} onClick={() => onLoadPreset(p.id)} style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: '#a6adc8' }}>{p.category}</span>
              <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 4, background: difficultyColor[p.difficulty] || '#ccc', color: '#1e1e2e' }}>{p.difficulty}</span>
            </div>
            <h3 style={{ margin: '0 0 8px' }}>{p.name}</h3>
            <p style={{ fontSize: 14, color: '#a6adc8', margin: 0 }}>{p.description}</p>
          </div>
        ))}
        {tab === 'my' && labs.map(l => (
          <div key={l.id} onClick={() => onLoadLab(l.id)} style={cardStyle}>
            <h3 style={{ margin: '0 0 8px' }}>{l.name}</h3>
            <p style={{ fontSize: 14, color: '#a6adc8', margin: 0 }}>{l.description || 'No description'}</p>
            <p style={{ fontSize: 12, color: '#585b70', marginTop: 8 }}>Updated: {new Date(l.updatedAt).toLocaleDateString()}</p>
          </div>
        ))}
        {tab === 'my' && labs.length === 0 && (
          <p style={{ color: '#585b70', gridColumn: '1/-1', textAlign: 'center', padding: 40 }}>No saved labs yet. Start a preset or create a new lab!</p>
        )}
      </div>
    </div>
  );
}
