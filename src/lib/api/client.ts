import type { AuthResponse, User, Lab, LabSummary, Preset, PresetSummary, GradeResponse } from './types';

const BASE = '/api/v1';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('auth_token');
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || res.statusText);
  }
  return res.json();
}

export async function register(username: string, password: string, displayName?: string): Promise<AuthResponse> {
  const data = await request<AuthResponse>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password, displayName }),
  });
  localStorage.setItem('auth_token', data.token);
  return data;
}

export async function login(username: string, password: string): Promise<AuthResponse> {
  const data = await request<AuthResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  localStorage.setItem('auth_token', data.token);
  return data;
}

export async function getMe(): Promise<User> {
  return request<User>('/auth/me');
}

export function logout(): void {
  localStorage.removeItem('auth_token');
}

export function isLoggedIn(): boolean {
  return !!getToken();
}

export async function listLabs(): Promise<LabSummary[]> {
  return request<LabSummary[]>('/labs');
}

export async function getLab(id: string): Promise<Lab> {
  return request<Lab>(`/labs/${id}`);
}

export async function createLab(name: string, description: string, topology: string): Promise<Lab> {
  return request<Lab>('/labs', {
    method: 'POST',
    body: JSON.stringify({ name, description, topology }),
  });
}

export async function updateLab(id: string, data: Partial<{ name: string; description: string; topology: string; thumbnail: string }>): Promise<void> {
  await request(`/labs/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export async function deleteLab(id: string): Promise<void> {
  await request(`/labs/${id}`, { method: 'DELETE' });
}

export async function exportLab(id: string): Promise<Blob> {
  const token = getToken();
  const res = await fetch(`${BASE}/labs/${id}/export`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return res.blob();
}

export async function importLab(file: File): Promise<Lab> {
  const text = await file.text();
  const json = JSON.parse(text);
  return request<Lab>('/labs/import', { method: 'POST', body: JSON.stringify(json) });
}

export async function listPresets(): Promise<PresetSummary[]> {
  return request<PresetSummary[]>('/presets');
}

export async function getPreset(id: string): Promise<Preset> {
  return request<Preset>(`/presets/${id}`);
}

export async function gradeLab(labId: string, presetId: string): Promise<GradeResponse> {
  return request<GradeResponse>(`/labs/${labId}/grade`, {
    method: 'POST',
    body: JSON.stringify({ presetId }),
  });
}
