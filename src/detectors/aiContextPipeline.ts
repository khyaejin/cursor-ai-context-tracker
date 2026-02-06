import * as vscode from 'vscode';
import { CursorDB } from '../cursor/cursorDB';
import { Bubble } from '../cursor/types';
import { MetadataStore } from '../store/metadataStore';
import { FileChangeTracker, MATCH_WINDOW_MS } from './fileChangeTracker';
import { getDiffLineRanges, lineRangesByFileToFilesArray } from '../utils/gitDiff';
import { ensureAiContextBranch, commitMatchedFiles, restoreBranch, getAiContextBranchName } from '../utils/gitCommit';
import { saveMetadataFromCursorDB } from '../store/saveMetadataFromCursor';

/**
 * 파이프라인: 1-3(파일 변경) → 1-5(라인 범위) → 1-4(Git 커밋) → 1-6(메타데이터 저장)
 * AI 응답 감지 시: ±5초 window 파일 → diff 라인 범위 → ai-context 브랜치에 커밋 → metadata.json 저장
 */
/** Cursor DB createdAt이 초 단위일 수 있음 → ms로 통일 */
function normalizeCreatedAtMs(createdAt: number | undefined): number {
  const t = createdAt ?? Date.now();
  return t < 1e12 ? t * 1000 : t;
}

export async function runAiContextPipeline(
  workspaceRoot: string,
  cursorDB: CursorDB,
  metadataStore: MetadataStore,
  fileChangeTracker: FileChangeTracker,
  bubble: Bubble
): Promise<boolean> {
  const aiResponseTime = normalizeCreatedAtMs(bubble.createdAt);
  let filePaths = fileChangeTracker.getFilePathsInWindow(aiResponseTime, MATCH_WINDOW_MS);
  console.log('[AiContextPipeline] AI 응답 시각(ms)=', aiResponseTime, '±5초 윈도우 내 파일 수=', filePaths.length, filePaths.length ? filePaths.slice(0, 5) : '');

  let lineRangesByFile: Record<string, { start: number; end: number }[]> = {};
  if (filePaths.length > 0) {
    lineRangesByFile = await getDiffLineRanges(workspaceRoot, { filePaths });
  }
  if (Object.keys(lineRangesByFile).length === 0) {
    lineRangesByFile = await getDiffLineRanges(workspaceRoot);
  }
  filePaths = Object.keys(lineRangesByFile);
  if (filePaths.length === 0) {
    console.log('[AiContextPipeline] Git diff 결과가 없어 파이프라인을 중단합니다 (Fallback 저장 경로로 전환).');
    return false;
  }

  let commitHash: string | null = null;
  try {
    await ensureAiContextBranch(workspaceRoot);
    commitHash = await commitMatchedFiles(workspaceRoot, filePaths);
  } catch (gitErr) {
    console.warn('[AiContextPipeline] Git 처리 단계 실패 → 커밋 없이 메타데이터만 저장하도록 Fallback:', gitErr instanceof Error ? gitErr.message : gitErr);
    return false;
  } finally {
    try {
      await restoreBranch(workspaceRoot);
    } catch (e) {
      console.warn('[AiContextPipeline] Git 브랜치 복구 실패:', e instanceof Error ? e.message : e);
    }
  }

  if (!commitHash) return false;

  const files = lineRangesByFileToFilesArray(lineRangesByFile);
  await saveMetadataFromCursorDB(cursorDB, metadataStore, {
    composerId: bubble.composerId,
    bubbleId: bubble.bubbleId,
    files,
    commitHash,
  });

  const branchName = await getAiContextBranchName(workspaceRoot);
  console.log(`[AiContextPipeline] ai-context 브랜치 ${branchName}에 커밋 완료: ${commitHash.substring(0, 7)} (파일 ${filePaths.length}개)`);
  return true;
}
