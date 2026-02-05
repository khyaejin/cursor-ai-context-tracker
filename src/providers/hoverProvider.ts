import * as vscode from 'vscode';
import { MetadataStore } from '../store/metadataStore';
import { AiContextEntry } from '../cursor/types';

/**
 * Hover Provider: 입력은 .ai-context만 사용 (Cursor DB / Git 직접 접근 금지)
 * filePath + lineNumber로 .ai-context에서 매칭된 context를 읽어 Hover에 표시.
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

    const contexts = this.metadataStore.getContextsForFileAndLine(
      relativePath,
      lineNumber
    );
    if (contexts.length === 0) return null;

    return this.createHover(contexts);
  }

  private createHover(entries: AiContextEntry[]): vscode.Hover {
    const markdown = new vscode.MarkdownString();
    markdown.isTrusted = true;
    markdown.supportHtml = true;

    markdown.appendMarkdown('---\n\n');
    markdown.appendMarkdown('### AI Context\n\n');
    markdown.appendMarkdown('---\n\n');

    for (const entry of entries) {
      const shortHash = entry.commitHash.substring(0, 7);
      const dateStr = new Date(entry.timestamp).toLocaleString('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
      markdown.appendMarkdown(`**Context:** \`${shortHash}\` · ${dateStr}\n\n`);

      if (entry.prompt) {
        markdown.appendMarkdown(`**Prompt:**\n> ${this.truncate(entry.prompt, 200)}\n\n`);
      }
      if (entry.thinking) {
        markdown.appendMarkdown(`**Thinking:**\n> ${this.truncate(entry.thinking, 200)}\n\n`);
      }
    }

    markdown.appendMarkdown('---\n\n');
    markdown.appendMarkdown('_AI Context Tracker – from .ai-context only_\n');

    return new vscode.Hover(markdown);
  }

  private truncate(text: string, maxLen: number): string {
    return text.length <= maxLen ? text : text.substring(0, maxLen) + '...';
  }
}
