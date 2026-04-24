export enum TranscriptionMode {
  VERBATIM = 'VERBATIM',
  READABLE = 'READABLE',
  SUMMARY = 'SUMMARY'
}

export enum TranscriptionLanguage {
  DUTCH = 'DUTCH',
  ENGLISH = 'ENGLISH',
  AUTO = 'AUTO'
}

export interface DebugInfo {
  modelName: string;
  temperature: number;
  thinkingLevel?: string;
  chunksCount: number;
  chunkDuration?: number;
  isStructuredOutput: boolean;
  needsFollowup: boolean;
}

export interface TranscriptionResult {
  transcript: string;
  mode: string;
  language: string;
  continued_from: string | null;
  needs_followup: boolean;
  minutes?: string;
  actionPoints?: string;
  shortSummary?: string;
  debugInfo?: DebugInfo;
}

export enum ProcessingStatus {
  IDLE = 'IDLE',
  READING_FILE = 'READING_FILE',
  CHUNKING = 'CHUNKING',
  UPLOADING = 'UPLOADING',
  TRANSCRIBING = 'TRANSCRIBING',
  MERGING = 'MERGING',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR',
  CANCELLED = 'CANCELLED'
}

export interface ProcessingProgress {
  current: number;
  total: number;
  percentage: number;
  retryCount?: number;
  maxRetries?: number;
  cooldownSeconds?: number;
  isOverloaded?: boolean;
}

export interface FileData {
  name: string;
  size: number;
  type: string;
  blob?: Blob;
  url?: string;
}

declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}
