export interface Composer {
  composerId: string;
  conversationId: string;
  createdAt: number;
  updatedAt?: number;
}

export interface Bubble {
  bubbleId: string;
  composerId: string;
  type: 'user' | 'assistant';
  text: string;
  createdAt: number;
  modelType?: string;
  selections?: { text: string; file?: string }[];
}

/** .ai-context 내 context JSON 한 개 (commitHash/contextId 기반 파일) */
export interface AiContextEntry {
  commitHash: string;
  timestamp: number;
  changes: { filePath: string; lineRanges: { start: number; end: number }[] }[];
  /** 선택: prompt/thinking 등 (있으면 Hover에 표시) */
  prompt?: string;
  thinking?: string;
  aiRefs?: { composerId: string; bubbleIds: string[]; time: number }[];
}

export interface AICodeMetadata {
  prompt: string;
  aiResponse: string;
  timestamp: number;
  commitHash?: string;
  filePath: string;
  lineRanges: { start: number; end: number }[];
  composerId: string;
  bubbleId: string;
  modelType?: string;
  userSelections?: { text: string; file?: string }[];
}
