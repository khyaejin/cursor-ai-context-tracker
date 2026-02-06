import * as vscode from 'vscode';
import { MetadataStore } from '../store/metadataStore';
import { AiContextEntry, AICodeMetadata } from '../cursor/types';

const PROMPT_PREVIEW_LEN = 200;
const THINKING_PREVIEW_LEN = 150;

/**
 * Hover Tooltip (기능 1-7)
 * - 입력: 파일 경로, 라인 번호 → .ai-context만 조회 (metadata.json 우선, 없으면 context 파일)
 * - 출력: Markdown Hover (프롬프트, thinking, 메타 정보, 액션)
 */
export class AIContextHoverProvider implements vscode.HoverProvider {
  constructor(private metadataStore: MetadataStore) {}

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.Hover> {
    const relativePath = vscode.workspace.asRelativePath(document.uri);
    const lineNumber = position.line + 1;

    // 기능 1-6: metadata.json 우선 (prompt/thinking 있음)
    const metadataEntries = this.metadataStore.getMetadataByFileAndLine(
      relativePath,
      lineNumber
    );
    if (metadataEntries.length > 0) {
      return this.createHoverFromMetadata(metadataEntries, relativePath, lineNumber);
    }

    // fallback: context 파일 (commitHash.json)
    const contexts = this.metadataStore.getContextsForFileAndLine(
      relativePath,
      lineNumber
    );
    if (contexts.length === 0) return null;

    return this.createHoverFromContexts(contexts, relativePath, lineNumber);
  }

  /** metadata.json 항목 기준 Hover (prompt, thinking 표시) */
  private createHoverFromMetadata(
    entries: AICodeMetadata[],
    filePath: string,
    lineNumber: number
  ): vscode.Hover {
    const markdown = new vscode.MarkdownString();
    markdown.isTrusted = true;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (i > 0) markdown.appendMarkdown('---\n\n');

      markdown.appendMarkdown('### AI Context\n\n');

      markdown.appendMarkdown('**프롬프트**\n\n');
      markdown.appendMarkdown(`> ${this.truncate(entry.prompt, PROMPT_PREVIEW_LEN)}\n\n`);

      markdown.appendMarkdown('**AI Thinking**\n\n');
      markdown.appendMarkdown(`> ${this.truncate(entry.thinking ?? '(없음)', THINKING_PREVIEW_LEN)}\n\n`);

      const fileEntry = entry.files?.find((f) => this.sameFileForEntry(f.filePath, filePath))
        ?? (entry.filePath && entry.lineRanges ? { filePath: entry.filePath, lineRanges: entry.lineRanges } : null);
      const lineRangeStr = fileEntry
        ? fileEntry.lineRanges
          .map((r) => (r.start === r.end ? `${r.start}` : `${r.start}-${r.end}`))
          .join(', ')
        : `${lineNumber}`;
      const timeStr = new Date(entry.timestamp).toLocaleString('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
      const tokenStr = entry.tokens != null ? String(entry.tokens) : '–';

      markdown.appendMarkdown('**메타** | ');
      markdown.appendMarkdown(`파일: \`${filePath}\` | `);
      markdown.appendMarkdown(`라인: ${lineRangeStr} | `);
      markdown.appendMarkdown(`토큰: ${tokenStr} | `);
      markdown.appendMarkdown(`시간: ${timeStr}\n\n`);

      const id = entry.commitHash ?? entry.bubbleId;
      const copyCmd = `command:ai-context-tracker.copyContext?${encodeURIComponent(JSON.stringify([id]))}`;
      const fullCmd = `command:ai-context-tracker.showFullContext?${encodeURIComponent(JSON.stringify([id]))}`;
      markdown.appendMarkdown(`[전체 보기](${fullCmd}) `);
      markdown.appendMarkdown(`[복사](${copyCmd})\n\n`);
    }

    return new vscode.Hover(markdown);
  }

  private sameFileForEntry(a: string, b: string): boolean {
    const n1 = a.replace(/\\/g, '/');
    const n2 = b.replace(/\\/g, '/');
    if (n1 === n2) return true;
    if (n1.endsWith(n2) || n2.endsWith(n1)) return true;
    const base1 = n1.split(/[/\\]/).pop() ?? '';
    const base2 = n2.split(/[/\\]/).pop() ?? '';
    return base1 === base2 && (n1.includes(n2) || n2.includes(n1));
  }

  /** context 파일(commitHash.json) 기준 Hover (prompt/thinking 없을 때) */
  private createHoverFromContexts(
    entries: AiContextEntry[],
    filePath: string,
    lineNumber: number
  ): vscode.Hover {
    const markdown = new vscode.MarkdownString();
    markdown.isTrusted = true;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (i > 0) markdown.appendMarkdown('---\n\n');

      markdown.appendMarkdown('### AI Context\n\n');

      if (entry.prompt) {
        markdown.appendMarkdown('**프롬프트**\n\n');
        markdown.appendMarkdown(`> ${this.truncate(entry.prompt, PROMPT_PREVIEW_LEN)}\n\n`);
      }
      if (entry.thinking) {
        markdown.appendMarkdown('**AI Thinking**\n\n');
        markdown.appendMarkdown(`> ${this.truncate(entry.thinking, THINKING_PREVIEW_LEN)}\n\n`);
      }

      const change = entry.changes.find((c) =>
        c.lineRanges.some((r) => lineNumber >= r.start && lineNumber <= r.end)
      );
      const lineRangeStr = change
        ? change.lineRanges
          .map((r) => (r.start === r.end ? `${r.start}` : `${r.start}-${r.end}`))
          .join(', ')
        : `${lineNumber}`;
      const timeStr = new Date(entry.timestamp).toLocaleString('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
      const tokenStr = entry.token != null ? String(entry.token) : '–';

      markdown.appendMarkdown('**메타** | ');
      markdown.appendMarkdown(`파일: \`${filePath}\` | `);
      markdown.appendMarkdown(`라인: ${lineRangeStr} | `);
      markdown.appendMarkdown(`토큰: ${tokenStr} | `);
      markdown.appendMarkdown(`시간: ${timeStr}\n\n`);

      const copyCmd = `command:ai-context-tracker.copyContext?${encodeURIComponent(JSON.stringify([entry.commitHash]))}`;
      const fullCmd = `command:ai-context-tracker.showFullContext?${encodeURIComponent(JSON.stringify([entry.commitHash]))}`;
      markdown.appendMarkdown(`[전체 보기](${fullCmd}) `);
      markdown.appendMarkdown(`[복사](${copyCmd})\n\n`);
    }

    return new vscode.Hover(markdown);
  }

  private truncate(text: string, maxLen: number): string {
    return text.length <= maxLen ? text : text.substring(0, maxLen) + '...';
  }
}
