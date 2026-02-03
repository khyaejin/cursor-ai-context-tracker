import * as vscode from 'vscode';
import { AICodeMetadata } from '../cursor/types';

export class AIContextHoverProvider implements vscode.HoverProvider {
  private metadataMap: Map<string, Map<number, AICodeMetadata>> = new Map();

  constructor() {
    this.loadMockData();
  }

  private loadMockData(): void {
    const mockMetadata: AICodeMetadata = {
      prompt: 'CursorDB 클래스를 만들어줘. sql.js를 사용해서 Cursor의 state.vscdb를 읽고, Composer와 Bubble 데이터를 파싱하는 기능을 구현해.',
      aiResponse: 'CursorDB 클래스를 구현했습니다. sql.js를 사용하여 Cursor DB에 접근하고, getAllComposers()와 getBubblesForComposer() 메서드로 데이터를 읽을 수 있습니다.',
      timestamp: Date.now() - 3600000,
      filePath: 'src/cursor/cursorDB.ts',
      lineRanges: [
        { start: 1, end: 10 },
        { start: 15, end: 30 },
        { start: 50, end: 80 }
      ],
      composerId: 'eeb8c1ca-01b9-4f52-a197-0975a849982a',
      bubbleId: 'a104f088-549b-42c6-8b24-589a63ed6a32',
      modelType: 'claude-sonnet-4',
      userSelections: [
        { text: 'interface Composer {...}', file: 'src/cursor/types.ts' }
      ]
    };

    const fileMap = new Map<number, AICodeMetadata>();
    mockMetadata.lineRanges.forEach(range => {
      for (let line = range.start; line <= range.end; line++) {
        fileMap.set(line, mockMetadata);
      }
    });

    this.metadataMap.set(mockMetadata.filePath, fileMap);
  }

  public provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.Hover> {
    const relativePath = vscode.workspace.asRelativePath(document.uri);
    const lineNumber = position.line + 1;

    const fileMap = this.metadataMap.get(relativePath);
    if (!fileMap) {
      return null;
    }

    const metadata = fileMap.get(lineNumber);
    if (!metadata) {
      return null;
    }

    return this.createHover(metadata);
  }

  private createHover(metadata: AICodeMetadata): vscode.Hover {
    const markdown = new vscode.MarkdownString();
    markdown.isTrusted = true;
    markdown.supportHtml = true;

    const date = new Date(metadata.timestamp);
    const dateStr = date.toLocaleString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });

    markdown.appendMarkdown('---\n\n');
    markdown.appendMarkdown(`### 🤖 AI Generated Code${metadata.modelType ? ` (${metadata.modelType})` : ''}\n\n`);
    markdown.appendMarkdown('---\n\n');
    
    markdown.appendMarkdown(`**📝 Prompt:**\n\n`);
    markdown.appendMarkdown(`> ${this.truncateText(metadata.prompt, 200)}\n\n`);
    
    markdown.appendMarkdown(`**🤖 AI Response:**\n\n`);
    markdown.appendMarkdown(`> ${this.truncateText(metadata.aiResponse, 200)}\n\n`);
    
    markdown.appendMarkdown(`**📅 Generated:** ${dateStr}\n\n`);
    
    if (metadata.userSelections && metadata.userSelections.length > 0) {
      markdown.appendMarkdown(`**📎 User Selected Code:**\n\n`);
      metadata.userSelections.forEach((sel, idx) => {
        const selText = this.truncateText(sel.text, 100);
        markdown.appendMarkdown(`> ${idx + 1}. \`${selText}\`${sel.file ? ` (${sel.file})` : ''}\n\n`);
      });
    }

    if (metadata.commitHash) {
      markdown.appendMarkdown(`**🔗 Git Commit:** \`${metadata.commitHash.substring(0, 7)}\`\n\n`);
    }

    markdown.appendMarkdown('---\n\n');
    markdown.appendMarkdown('_AI Context Tracker - Hover to see AI generation context_\n');

    return new vscode.Hover(markdown);
  }

  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text;
    }
    return text.substring(0, maxLength) + '...';
  }

  public addMetadata(metadata: AICodeMetadata): void {
    let fileMap = this.metadataMap.get(metadata.filePath);
    if (!fileMap) {
      fileMap = new Map<number, AICodeMetadata>();
      this.metadataMap.set(metadata.filePath, fileMap);
    }

    metadata.lineRanges.forEach(range => {
      for (let line = range.start; line <= range.end; line++) {
        fileMap!.set(line, metadata);
      }
    });
  }

  public clearMetadata(filePath: string): void {
    this.metadataMap.delete(filePath);
  }

  public clearAllMetadata(): void {
    this.metadataMap.clear();
  }
}
