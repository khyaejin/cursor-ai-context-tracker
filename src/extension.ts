import * as vscode from 'vscode';
import { CursorDB } from './cursor/cursorDB';
import { AIContextHoverProvider } from './providers/hoverProvider';
import { AIResponseDetector } from './detectors/aiResponseDetector';

let aiResponseDetector: AIResponseDetector | null = null;

export async function activate(context: vscode.ExtensionContext) {
  console.log('[AI Context Tracker] Phase 1 MVP - Activating extension...');

  try {
    const cursorDB = new CursorDB();

    console.log('[Phase 1] Step 1: Registering Hover Provider...');
    const hoverProvider = new AIContextHoverProvider();
    const hoverDisposable = vscode.languages.registerHoverProvider(
      { scheme: 'file', pattern: '**/*.ts' },
      hoverProvider
    );
    context.subscriptions.push(hoverDisposable);
    console.log('[Phase 1] ✅ Hover Provider registered');

    console.log('[Phase 1] Step 2: Starting AI Response Detector...');
    aiResponseDetector = new AIResponseDetector(cursorDB);
    aiResponseDetector.startPolling();
    console.log('[Phase 1] ✅ AI Response Detector started (5s polling)');

    const stopDetectorCommand = vscode.commands.registerCommand(
      'ai-context-tracker.stopDetector',
      () => {
        if (aiResponseDetector) {
          aiResponseDetector.stopPolling();
          vscode.window.showInformationMessage('AI Response Detector stopped');
        }
      }
    );

    const startDetectorCommand = vscode.commands.registerCommand(
      'ai-context-tracker.startDetector',
      () => {
        if (aiResponseDetector) {
          aiResponseDetector.startPolling();
          vscode.window.showInformationMessage('AI Response Detector started');
        }
      }
    );

    const resetDetectorCommand = vscode.commands.registerCommand(
      'ai-context-tracker.resetDetector',
      () => {
        if (aiResponseDetector) {
          aiResponseDetector.resetProcessedBubbleId();
          vscode.window.showInformationMessage('Detector reset - will check all responses again');
        }
      }
    );

    context.subscriptions.push(stopDetectorCommand);
    context.subscriptions.push(startDetectorCommand);
    context.subscriptions.push(resetDetectorCommand);

    vscode.window.showInformationMessage(
      '✅ AI Context Tracker 활성화! AI 응답을 자동으로 추적합니다.'
    );

    console.log('[Phase 1] ========================================');
    console.log('[Phase 1] AI Context Tracker 활성화 완료');
    console.log('[Phase 1] - Hover Provider: 활성');
    console.log('[Phase 1] - AI Response Detector: 활성 (5s 간격)');
    console.log('[Phase 1] - File Watcher: 활성 (500ms debounce)');
    console.log('[Phase 1] ========================================');

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[Phase 1] ❌ Error:', errorMsg);
    vscode.window.showErrorMessage(`[Phase 1] 오류 발생: ${errorMsg}`);
  }
}

export function deactivate() {
  console.log('[AI Context Tracker] Phase 1 - Deactivating extension');
  
  if (aiResponseDetector) {
    aiResponseDetector.stopPolling();
    aiResponseDetector = null;
  }
}
