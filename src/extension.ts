import * as vscode from 'vscode';
import { CursorDB } from './cursor/cursorDB';
import { AIContextHoverProvider } from './providers/hoverProvider';

export async function activate(context: vscode.ExtensionContext) {
  console.log('[AI Context Tracker] POC Day 3 - Activating extension...');

  try {
    console.log('[POC Day 3] Step 1: Registering Hover Provider...');
    const hoverProvider = new AIContextHoverProvider();
    
    const hoverDisposable = vscode.languages.registerHoverProvider(
      { scheme: 'file', pattern: '**/*.ts' },
      hoverProvider
    );
    
    context.subscriptions.push(hoverDisposable);
    console.log('[POC Day 3] ✅ Hover Provider registered for TypeScript files');

    console.log('[POC Day 3] Step 2: Testing Cursor DB (from Day 1-2)...');
    const cursorDB = new CursorDB();
    await cursorDB.initialize();
    const composers = await cursorDB.getAllComposers();
    cursorDB.close();
    console.log(`[POC Day 3] ✅ Cursor DB still works: ${composers.length} composers`);

    vscode.window.showInformationMessage(
      `[POC Day 3] ✅ Hover Provider 등록 완료! src/cursor/cursorDB.ts 파일을 열어서 코드에 마우스를 올려보세요.`
    );

    console.log('[POC Day 3] ========================================');
    console.log('[POC Day 3] Hover Provider 테스트 준비 완료');
    console.log('[POC Day 3] 📝 다음 작업:');
    console.log('[POC Day 3]   1. src/cursor/cursorDB.ts 파일 열기');
    console.log('[POC Day 3]   2. 1-10줄, 15-30줄, 50-80줄에 마우스 올리기');
    console.log('[POC Day 3]   3. AI 생성 컨텍스트 Hover 확인');
    console.log('[POC Day 3] ========================================');

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[POC Day 3] ❌ Error:', errorMsg);
    vscode.window.showErrorMessage(`[POC Day 3] 오류 발생: ${errorMsg}`);
  }
}

export function deactivate() {
  console.log('[AI Context Tracker] POC Day 3 - Deactivating extension');
}
