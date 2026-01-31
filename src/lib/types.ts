export interface FileContent {
  path: string;
  content: string;
}

export interface CodeLocation {
  file: string;
  line: number;
  context?: string;
  confidence?: number;
  hint?: string;
}

export interface ProductProfile {
  mission: string;
  valueProposition: string;
  businessGoals: string[];
  userPersonas: string[];
  keyMetrics: string[];
  confidence: number; // 0-1
}

export interface DetectedEvent {
  name: string;
  locations: CodeLocation[];
  properties?: string[];
  framework?: string;
}

