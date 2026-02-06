import * as vscode from 'vscode';
import * as path from 'path';

const RETENTION_MS = 30 * 1000; // 30초 메모리 유지 (AI active window)
const WINDOW_SEC = 5; // AI 응답 시간 ±5초 매칭
export const MATCH_WINDOW_MS = WINDOW_SEC * 1000;

const EXCLUDE_SEGMENTS = ['node_modules', '.git', '.ai-context'];

export interface FileChangeEvent {
  filePath: string;
  timestamp: number;
}

/**
 * 기능 1-3: 파일 변경 추적
 * - FileSystemWatcher로 워크스페이스 모든 파일 변경 기록
 * - 30초 메모리 유지 + 자동 cleanup
 * - AI 응답 시간 ±5초 window로 파일 목록 조회
 */
export class FileChangeTracker {
  private watcher: vscode.FileSystemWatcher | null = null;
  private events: FileChangeEvent[] = [];
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  start(): void {
    if (this.watcher) return;

    const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(this.workspaceRoot));
    const pattern = folder
      ? new vscode.RelativePattern(folder, '**/*')
      : new vscode.RelativePattern(this.workspaceRoot, '**/*');
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);

    const record = (uri: vscode.Uri) => {
      const relative = path.relative(this.workspaceRoot, uri.fsPath);
      if (this.shouldExclude(relative)) return;
      this.events.push({
        filePath: relative.replace(/\\/g, '/'),
        timestamp: Date.now(),
      });
      this.pruneOld();
    };

    this.watcher.onDidChange(record);
    this.watcher.onDidCreate(record);
    this.watcher.onDidDelete(record);

    console.log('[FileChangeTracker] 시작됨 (30초 메모리 유지, ±5초 매칭 윈도우)');
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.dispose();
      this.watcher = null;
    }
    this.events = [];
    console.log('[FileChangeTracker] 중지됨');
  }

  private shouldExclude(relativePath: string): boolean {
    const normalized = relativePath.replace(/\\/g, '/');
    return EXCLUDE_SEGMENTS.some((seg) => normalized.includes(seg));
  }

  private pruneOld(): void {
    const cutoff = Date.now() - RETENTION_MS;
    this.events = this.events.filter((e) => e.timestamp >= cutoff);
  }

  /**
   * AI 응답 시간 ±5초(또는 지정 ms) 구간에 변경된 파일 경로 목록 (중복 제거)
   */
  getFilePathsInWindow(aiResponseTime: number, windowMs: number = MATCH_WINDOW_MS): string[] {
    this.pruneOld();
    const start = aiResponseTime - windowMs;
    const end = aiResponseTime + windowMs;
    const set = new Set<string>();
    for (const e of this.events) {
      if (e.timestamp >= start && e.timestamp <= end) set.add(e.filePath);
    }
    return Array.from(set);
  }
}
