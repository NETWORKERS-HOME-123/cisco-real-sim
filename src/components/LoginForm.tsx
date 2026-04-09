'use client';
import React, { useState } from 'react';
import { useAuthStore } from '../stores/authStore';

export default function LoginForm({ onSuccess }: { onSuccess: () => void }) {
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const { login, register, isLoading, error } = useAuthStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (isRegister) {
        await register(username, password, displayName || undefined);
      } else {
        await login(username, password);
      }
      onSuccess();
    } catch {
      // error is set in store
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 12px', marginBottom: 12, borderRadius: 6,
    border: '1px solid #45475a', background: '#313244', color: '#cdd6f4',
    fontSize: 14, boxSizing: 'border-box' as const,
  };

  const btnStyle: React.CSSProperties = {
    width: '100%', padding: 12, borderRadius: 6, border: 'none',
    background: '#89b4fa', color: '#1e1e2e', fontWeight: 'bold',
    fontSize: 16, cursor: 'pointer',
  };

  return (
    <div style={{ maxWidth: 400, margin: '100px auto', padding: 32, background: '#1e1e2e', borderRadius: 12, color: '#cdd6f4' }}>
      <h2 style={{ textAlign: 'center', marginBottom: 24 }}>
        {isRegister ? 'Create Account' : 'Sign In'}
      </h2>
      <form onSubmit={handleSubmit}>
        <input
          type="text" placeholder="Username" value={username}
          onChange={e => setUsername(e.target.value)} required
          style={inputStyle}
        />
        {isRegister && (
          <input
            type="text" placeholder="Display Name (optional)" value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            style={inputStyle}
          />
        )}
        <input
          type="password" placeholder="Password" value={password}
          onChange={e => setPassword(e.target.value)} required minLength={6}
          style={inputStyle}
        />
        {error && <p style={{ color: '#f38ba8', fontSize: 14 }}>{error}</p>}
        <button type="submit" disabled={isLoading} style={btnStyle}>
          {isLoading ? '...' : isRegister ? 'Register' : 'Login'}
        </button>
      </form>
      <p style={{ textAlign: 'center', marginTop: 16, fontSize: 14 }}>
        {isRegister ? 'Already have an account?' : "Don't have an account?"}{' '}
        <span onClick={() => setIsRegister(!isRegister)} style={{ color: '#89b4fa', cursor: 'pointer' }}>
          {isRegister ? 'Sign In' : 'Register'}
        </span>
      </p>
    </div>
  );
}
