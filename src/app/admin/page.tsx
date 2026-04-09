'use client';
import React, { useEffect, useState } from 'react';
import * as api from '../../lib/api/client';

interface Stats {
  users: number;
  labs: number;
  presets: number;
  grades: number;
}

interface AdminUser {
  id: string;
  username: string;
  displayName: string;
  isAdmin: boolean;
  createdAt: string;
  labCount: number;
  gradeCount: number;
}

interface AdminLab {
  id: string;
  name: string;
  description: string;
  owner: string;
  createdAt: string;
  updatedAt: string;
}

interface AdminGrade {
  id: string;
  score: number;
  total: number;
  passed: number;
  gradedAt: string;
  username: string;
  presetName: string;
}

export default function AdminPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [labs, setLabs] = useState<AdminLab[]>([]);
  const [grades, setGrades] = useState<AdminGrade[]>([]);
  const [tab, setTab] = useState<'overview' | 'users' | 'labs' | 'grades'>('overview');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!api.isLoggedIn()) {
      window.location.href = '/login';
      return;
    }
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [dash, u, l, g] = await Promise.all([
        api.getAdminDashboard(),
        api.getAdminUsers(),
        api.getAdminLabs(),
        api.getAdminGrades(),
      ]);
      setStats(dash.stats);
      setUsers(u);
      setLabs(l);
      setGrades(g);
      setError('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteUser = async (id: string, username: string) => {
    if (!confirm(`Delete user "${username}" and all their data?`)) return;
    try {
      await api.deleteUser(id);
      await loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Delete failed';
      alert(msg);
    }
  };

  const handleLogout = () => {
    api.logout();
    window.location.href = '/login';
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#11111b', color: '#cdd6f4', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p>Loading admin dashboard...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ minHeight: '100vh', background: '#11111b', color: '#cdd6f4', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16 }}>
        <p style={{ color: '#f38ba8' }}>{error}</p>
        <button onClick={() => window.location.href = '/login'} style={btnStyle}>Go to Login</button>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#11111b', color: '#cdd6f4' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 32px', background: '#1e1e2e', borderBottom: '1px solid #313244' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontWeight: 'bold', fontSize: 18 }}>Admin Dashboard</span>
          <a href="/labs" style={{ color: '#89b4fa', textDecoration: 'none', fontSize: 14 }}>Back to Labs</a>
        </div>
        <span onClick={handleLogout} style={{ color: '#f38ba8', cursor: 'pointer' }}>Logout</span>
      </div>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: 32 }}>
        {/* Stats Cards */}
        {stats && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 32 }}>
            <StatCard label="Users" value={stats.users} color="#89b4fa" />
            <StatCard label="Saved Labs" value={stats.labs} color="#a6e3a1" />
            <StatCard label="Preset Labs" value={stats.presets} color="#f9e2af" />
            <StatCard label="Grades" value={stats.grades} color="#cba6f7" />
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
          {(['overview', 'users', 'labs', 'grades'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '8px 20px', borderRadius: 6, border: 'none', cursor: 'pointer',
              background: tab === t ? '#89b4fa' : '#313244',
              color: tab === t ? '#1e1e2e' : '#cdd6f4',
              fontWeight: tab === t ? 'bold' : 'normal',
            }}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {tab === 'overview' && (
          <div style={cardStyle}>
            <h3 style={{ marginTop: 0 }}>System Overview</h3>
            <p>Cisco Lab Server is running. All systems operational.</p>
            <p style={{ color: '#a6adc8', fontSize: 14 }}>
              {stats?.users} registered users have created {stats?.labs} labs and submitted {stats?.grades} grading attempts across {stats?.presets} preset labs.
            </p>
            <h4>Quick Actions</h4>
            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={() => setTab('users')} style={btnStyle}>Manage Users</button>
              <button onClick={() => setTab('grades')} style={btnStyle}>View Grades</button>
              <button onClick={loadData} style={{ ...btnStyle, background: '#313244', color: '#cdd6f4' }}>Refresh Data</button>
            </div>
          </div>
        )}

        {tab === 'users' && (
          <div style={cardStyle}>
            <h3 style={{ marginTop: 0 }}>Users ({users.length})</h3>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #45475a' }}>
                  <th style={thStyle}>Username</th>
                  <th style={thStyle}>Display Name</th>
                  <th style={thStyle}>Role</th>
                  <th style={thStyle}>Labs</th>
                  <th style={thStyle}>Grades</th>
                  <th style={thStyle}>Joined</th>
                  <th style={thStyle}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} style={{ borderBottom: '1px solid #313244' }}>
                    <td style={tdStyle}>{u.username}</td>
                    <td style={tdStyle}>{u.displayName}</td>
                    <td style={tdStyle}>
                      <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 12, background: u.isAdmin ? '#cba6f7' : '#313244', color: u.isAdmin ? '#1e1e2e' : '#a6adc8' }}>
                        {u.isAdmin ? 'Admin' : 'User'}
                      </span>
                    </td>
                    <td style={tdStyle}>{u.labCount}</td>
                    <td style={tdStyle}>{u.gradeCount}</td>
                    <td style={tdStyle}>{new Date(u.createdAt).toLocaleDateString()}</td>
                    <td style={tdStyle}>
                      {!u.isAdmin && (
                        <button onClick={() => handleDeleteUser(u.id, u.username)} style={{ background: '#f38ba8', color: '#1e1e2e', border: 'none', padding: '4px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'labs' && (
          <div style={cardStyle}>
            <h3 style={{ marginTop: 0 }}>All Labs ({labs.length})</h3>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #45475a' }}>
                  <th style={thStyle}>Name</th>
                  <th style={thStyle}>Owner</th>
                  <th style={thStyle}>Description</th>
                  <th style={thStyle}>Created</th>
                  <th style={thStyle}>Updated</th>
                </tr>
              </thead>
              <tbody>
                {labs.map(l => (
                  <tr key={l.id} style={{ borderBottom: '1px solid #313244' }}>
                    <td style={tdStyle}>{l.name}</td>
                    <td style={tdStyle}>{l.owner}</td>
                    <td style={tdStyle}>{l.description || '-'}</td>
                    <td style={tdStyle}>{new Date(l.createdAt).toLocaleDateString()}</td>
                    <td style={tdStyle}>{new Date(l.updatedAt).toLocaleDateString()}</td>
                  </tr>
                ))}
                {labs.length === 0 && (
                  <tr><td colSpan={5} style={{ ...tdStyle, textAlign: 'center', color: '#585b70' }}>No labs saved yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'grades' && (
          <div style={cardStyle}>
            <h3 style={{ marginTop: 0 }}>Recent Grades ({grades.length})</h3>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #45475a' }}>
                  <th style={thStyle}>User</th>
                  <th style={thStyle}>Preset</th>
                  <th style={thStyle}>Score</th>
                  <th style={thStyle}>Passed</th>
                  <th style={thStyle}>Date</th>
                </tr>
              </thead>
              <tbody>
                {grades.map(g => (
                  <tr key={g.id} style={{ borderBottom: '1px solid #313244' }}>
                    <td style={tdStyle}>{g.username}</td>
                    <td style={tdStyle}>{g.presetName}</td>
                    <td style={tdStyle}>
                      <span style={{ color: g.score >= 80 ? '#a6e3a1' : g.score >= 50 ? '#f9e2af' : '#f38ba8', fontWeight: 'bold' }}>
                        {g.score}%
                      </span>
                    </td>
                    <td style={tdStyle}>{g.passed}/{g.total}</td>
                    <td style={tdStyle}>{new Date(g.gradedAt).toLocaleString()}</td>
                  </tr>
                ))}
                {grades.length === 0 && (
                  <tr><td colSpan={5} style={{ ...tdStyle, textAlign: 'center', color: '#585b70' }}>No grades yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ background: '#1e1e2e', borderRadius: 12, padding: 24, border: '1px solid #313244' }}>
      <p style={{ margin: 0, fontSize: 14, color: '#a6adc8' }}>{label}</p>
      <p style={{ margin: '8px 0 0', fontSize: 36, fontWeight: 'bold', color }}>{value}</p>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: '#1e1e2e', borderRadius: 12, padding: 24, border: '1px solid #313244',
};

const btnStyle: React.CSSProperties = {
  padding: '8px 20px', borderRadius: 6, border: 'none', background: '#89b4fa',
  color: '#1e1e2e', fontWeight: 'bold', cursor: 'pointer',
};

const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '12px 8px', color: '#a6adc8', fontSize: 13, fontWeight: 600,
};

const tdStyle: React.CSSProperties = {
  padding: '10px 8px', fontSize: 14,
};
