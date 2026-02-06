import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import parseDiff = require('parse-diff');

const execFileAsync = promisify(execFile);

/** 기능 1-5: 출력 형태 { [filepath]: [{ start, end }, ...] } */
export type LineRangesByFile = Record<string, { start: number; end: number }[]>;

/**
 * Git diff 실행 후 parse-diff로 파싱 → 파일별 라인 범위 + 인접 병합
 * - commitHash 있으면: git show commitHash (해당 커밋의 diff)
 * - 없으면: git diff (working dir, staged + unstaged)
 * - filePaths 있으면: 해당 파일만 포함 (parse 후 필터)
 */
export async function getDiffLineRanges(
  workspaceRoot: string,
  options?: { commitHash?: string; filePaths?: string[] }
): Promise<LineRangesByFile> {
  let raw: string;
  try {
    if (options?.commitHash) {
      const { stdout } = await execFileAsync(
        'git',
        ['show', options.commitHash, '--no-color', '-U0'],
        { cwd: workspaceRoot, maxBuffer: 10 * 1024 * 1024 }
      );
      raw = stdout;
    } else {
      const { stdout } = await execFileAsync(
        'git',
        ['diff', '--no-color', '-U0'],
        { cwd: workspaceRoot, maxBuffer: 10 * 1024 * 1024 }
      );
      raw = stdout;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('not a git repository') || msg.includes('fatal')) {
      return {};
    }
    throw err;
  }

  if (!raw.trim()) return {};

  const files = parseDiff(raw);
  const filePaths = options?.filePaths ? new Set(options.filePaths.map((p) => path.normalize(p))) : null;
  const result: LineRangesByFile = {};

  for (const file of files) {
    const filePath = (file.to ?? file.from ?? '').trim();
    if (!filePath) continue;

    const relative = path.relative(workspaceRoot, filePath) || filePath;
    const normalized = path.normalize(relative).replace(/\\/g, '/');
    if (filePaths && !filePaths.has(normalized) && !Array.from(filePaths).some((fp) => fp.endsWith(normalized) || normalized.endsWith(fp))) continue;

    const ranges: { start: number; end: number }[] = [];
    for (const chunk of file.chunks ?? []) {
      const newStart = chunk.newStart ?? 0;
      const newLines = chunk.newLines ?? 0;
      if (newLines > 0) {
        ranges.push({
          start: newStart,
          end: newStart + newLines - 1,
        });
      }
    }

    if (ranges.length > 0) {
      const merged = mergeAdjacentRanges(ranges);
      result[normalized] = merged;
    }
  }

  return result;
}

function mergeAdjacentRanges(ranges: { start: number; end: number }[]): { start: number; end: number }[] {
  if (ranges.length <= 1) return ranges;
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = sorted[i];
    if (curr.start <= prev.end + 1) {
      prev.end = Math.max(prev.end, curr.end);
    } else {
      merged.push({ ...curr });
    }
  }
  return merged;
}

/** LineRangesByFile → AICodeMetadata.files 형태 */
export function lineRangesByFileToFilesArray(
  lineRangesByFile: LineRangesByFile
): { filePath: string; lineRanges: { start: number; end: number }[] }[] {
  return Object.entries(lineRangesByFile).map(([filePath, lineRanges]) => ({
    filePath,
    lineRanges,
  }));
}
