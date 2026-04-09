export interface User {
  id: string;
  username: string;
  displayName: string;
  isAdmin: boolean;
  createdAt: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface Lab {
  id: string;
  userId: string;
  name: string;
  description: string;
  topology: string;
  thumbnail?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LabSummary {
  id: string;
  name: string;
  description: string;
  thumbnail?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Preset {
  id: string;
  name: string;
  category: string;
  difficulty: string;
  description: string;
  objectives: string;
  topology: string;
  answerKey: string;
  sortOrder: number;
}

export interface PresetSummary {
  id: string;
  name: string;
  category: string;
  difficulty: string;
  description: string;
  objectives: string;
  sortOrder: number;
}

export interface GradeResponse {
  score: number;
  total: number;
  passed: number;
  results: ObjectiveResult[];
}

export interface ObjectiveResult {
  id: number;
  passed: boolean;
  description: string;
  reason?: string;
}
