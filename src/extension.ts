import * as vscode from 'vscode';
import { CursorDB, findWorkspaceStorageDbPath } from './cursor/cursorDB';
import { Bubble } from './cursor/types';
import { MetadataStore } from './store/metadataStore';
import { AIContextHoverProvider } from './providers/hoverProvider';
import { AIResponseDetector } from './detectors/aiResponseDetector';
import { FileChangeTracker } from './detectors/fileChangeTracker';
import { runAiContextPipeline } from './detectors/aiContextPipeline';

let aiResponseDetector: AIResponseDetector | null = null;
let fileChangeTracker: FileChangeTracker | null = null;
let initialized = false;

/** 현재 열린 워크스페이스(있다면)에 대해 확장 코어를 초기화 */
async function initializeForWorkspace(context: vscode.ExtensionContext): Promise<void> {
  if (initialized) return;

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    console.warn(
      '[AI Context Tracker] 아직 워크스페이스 폴더가 없습니다. 이 창에서 폴더를 열면 자동으로 AI Context Tracker가 활성화됩니다.'
    );
    return;
  }

  console.log('[AI Context Tracker] 워크스페이스 감지, 초기화 시작: root =', workspaceRoot);
  initialized = true;

  try {
    const metadataStore = new MetadataStore(workspaceRoot);
    metadataStore.ensureDir();

    console.log('[Phase 1] 1단계: Hover Provider 등록 (모든 확장자)...');
    const hoverProvider = new AIContextHoverProvider(metadataStore);
    const hoverSelector: vscode.DocumentSelector = { scheme: 'file', pattern: '**/*' };
    context.subscriptions.push(
      vscode.languages.registerHoverProvider(hoverSelector, hoverProvider)
    );
    console.log('[Phase 1] ✅ Hover Provider 등록 완료 (모든 파일)');

    console.log('[Phase 1] 2단계: File Change Tracker 시작 (기능 1-3)...');
    fileChangeTracker = new FileChangeTracker(workspaceRoot);
    fileChangeTracker.start();
    context.subscriptions.push({
      dispose: () => {
        fileChangeTracker?.stop();
        fileChangeTracker = null;
      },
    });

    const cursorDB = new CursorDB(workspaceRoot);

    console.log('[Phase 1] workspaceRoot =', workspaceRoot);
    console.log('[Phase 1] .ai-context 디렉터리 =', metadataStore.getDirPath(), 'metadata.json =', metadataStore.getMetadataPath());
    console.log('[Phase 1] Cursor DB 경로 =', cursorDB.getDbPath());

    console.log('[Phase 1] 3단계: AI Response Detector 시작 (Cursor DB 감시)...');
    // 활성화 시점 workspaceRoot 캐시 (콜백에서 workspaceFolders 재조회 시 NoWorkspaceUriError 등으로 빈 값 나오는 것 방지)
    const cachedWorkspaceRoot = workspaceRoot;
    aiResponseDetector = new AIResponseDetector(cursorDB, {
      onNewAIResponse: async (bubble: Bubble) => {
        const root = cachedWorkspaceRoot;
        console.log('[AI Context Tracker] onNewAIResponse 호출: bubble=', bubble.bubbleId?.substring(0, 8), 'root=', !!root, 'tracker=', !!fileChangeTracker);

        const tracker = fileChangeTracker;
        const runPipeline = root && tracker;
        if (runPipeline) {
          try {
            const ok = await runAiContextPipeline(root, cursorDB, metadataStore, tracker, bubble);
            if (ok) {
              console.log('[AI Context Tracker] 파이프라인 성공 → Git 커밋 + metadata 저장 완료');
              return;
            }
            console.log('[AI Context Tracker] 파이프라인이 false를 반환 → Fallback 저장으로 전환');
          } catch (e) {
            console.warn('[AI Context Tracker] 파이프라인 실행 중 예외 → Fallback 저장 사용:', e instanceof Error ? e.message : e);
          }
        } else {
          console.log('[AI Context Tracker] workspaceRoot 또는 FileChangeTracker 없음 → Fallback 저장만 수행');
        }

        const editor = vscode.window.activeTextEditor;
        const relativePath = editor && root ? vscode.workspace.asRelativePath(editor.document.uri) : '';
        const start = editor ? editor.selection.start.line + 1 : 1;
        const end = editor ? editor.selection.end.line + 1 : 1;
        const files = relativePath
          ? [{ filePath: relativePath, lineRanges: [{ start, end }] }]
          : [{ filePath: '(현재 파일 없음)', lineRanges: [{ start: 1, end: 1 }] }];
        try {
          const { saveMetadataFromCursorDB } = await import('./store/saveMetadataFromCursor');
          await saveMetadataFromCursorDB(cursorDB, metadataStore, {
            composerId: bubble.composerId,
            bubbleId: bubble.bubbleId,
            files,
          });
          console.log('[AI Context Tracker] metadata.json Fallback 저장 완료: bubble=', bubble.bubbleId.substring(0, 8));
        } catch (e) {
          console.error('[AI Context Tracker] Fallback 저장 실패:', e instanceof Error ? e.message : e, e instanceof Error ? e.stack : '');
        }
      },
    });
    aiResponseDetector.startPolling();
    console.log('[Phase 1] ✅ AI Response Detector 시작 (5초 폴링 + File Watcher)');

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

    const showFullContextCommand = vscode.commands.registerCommand(
      'ai-context-tracker.showFullContext',
      async (id: string) => {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!root) return;
        const store = new MetadataStore(root);
        const meta = store.getMetadataByBubbleId(id);
        if (meta) {
          const lines: string[] = [
            '# AI Context (전체)',
            '',
            `**Bubble:** \`${id.substring(0, 8)}\` · ${new Date(meta.timestamp).toLocaleString('ko-KR')}`,
            '',
            '## 프롬프트',
            meta.prompt || '(없음)',
            '',
            '## AI Thinking',
            meta.thinking || '(없음)',
            '',
            '## 메타',
            `파일: ${meta.files?.map((f) => f.filePath).join(', ') ?? meta.filePath ?? ''}`,
          ];
          const doc = await vscode.workspace.openTextDocument({
            content: lines.join('\n'),
            language: 'markdown',
          });
          await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });
          return;
        }
        const entry = store.readContextFile(id);
        if (!entry) {
          vscode.window.showWarningMessage('해당 Context를 찾을 수 없습니다.');
          return;
        }
        const lines: string[] = [
          '# AI Context (전체)',
          '',
          `**Context:** \`${id.substring(0, 7)}\` · ${new Date(entry.timestamp).toLocaleString('ko-KR')}`,
          '',
          '## 프롬프트',
          entry.prompt || '(없음)',
          '',
          '## AI Thinking',
          entry.thinking || '(없음)',
          '',
          '## 메타',
          `파일: ${entry.changes.map((c) => c.filePath).join(', ')}`,
        ];
        const doc = await vscode.workspace.openTextDocument({
          content: lines.join('\n'),
          language: 'markdown',
        });
        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside });
      }
    );

    const copyContextCommand = vscode.commands.registerCommand(
      'ai-context-tracker.copyContext',
      async (id: string) => {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!root) return;
        const store = new MetadataStore(root);
        const meta = store.getMetadataByBubbleId(id);
        if (meta) {
          const text = `[프롬프트]\n${meta.prompt}\n\n[AI Thinking]\n${meta.thinking}`;
          await vscode.env.clipboard.writeText(text);
          vscode.window.showInformationMessage('클립보드에 복사했습니다.');
          return;
        }
        const entry = store.readContextFile(id);
        if (!entry) {
          vscode.window.showWarningMessage('해당 Context를 찾을 수 없습니다.');
          return;
        }
        const parts: string[] = [];
        if (entry.prompt) parts.push(`[프롬프트]\n${entry.prompt}`);
        if (entry.thinking) parts.push(`[AI Thinking]\n${entry.thinking}`);
        const text = parts.length ? parts.join('\n\n') : `Context ${id.substring(0, 7)} (프롬프트/thinking 없음)`;
        await vscode.env.clipboard.writeText(text);
        vscode.window.showInformationMessage('클립보드에 복사했습니다.');
      }
    );

    const saveMetadataCommand = vscode.commands.registerCommand(
      'ai-context-tracker.saveLatestToMetadata',
      async () => {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const editor = vscode.window.activeTextEditor;
        if (!root || !editor) {
          vscode.window.showWarningMessage('워크스페이스와 열린 편집기가 필요합니다.');
          return;
        }
        const { saveMetadataFromCursorDB } = await import('./store/saveMetadataFromCursor');
        const store = new MetadataStore(root);
        store.ensureDir();
        const cursorDB = new CursorDB(root);
        try {
          await cursorDB.initialize();
          const latest = await cursorDB.getLatestAIBubble();
          if (!latest) {
            vscode.window.showWarningMessage('최근 AI 응답이 없습니다.');
            return;
          }
          const relativePath = vscode.workspace.asRelativePath(editor.document.uri);
          const sel = editor.selection;
          const start = sel.start.line + 1;
          const end = sel.end.line + 1;
          const files = [{ filePath: relativePath, lineRanges: [{ start, end }] }];
          await saveMetadataFromCursorDB(cursorDB, store, {
            composerId: latest.composerId,
            bubbleId: latest.bubbleId,
            files,
          });
          vscode.window.showInformationMessage('metadata.json에 저장했습니다.');
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          vscode.window.showErrorMessage(`저장 실패: ${msg}`);
        } finally {
          cursorDB.close();
        }
      }
    );

    const diagnoseCommand = vscode.commands.registerCommand(
      'ai-context-tracker.diagnose',
      async () => {
        const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const lines: string[] = [];
        const log = (msg: string) => {
          console.log('[Diagnose]', msg);
          lines.push(msg);
        };

        log('=== AI Context Tracker 진단 ===');
        if (!root) {
          log('❌ 워크스페이스 폴더 없음');
          vscode.window.showErrorMessage('워크스페이스 폴더를 연 뒤 다시 실행하세요.');
          return;
        }
        const store = new MetadataStore(root);
        const metaPath = store.getMetadataPath();
        const dirPath = store.getDirPath();
        log(`workspaceRoot: ${root}`);
        log(`.ai-context dir: ${dirPath}`);
        log(`metadata.json path: ${metaPath}`);

        const db = new CursorDB(root);
        const globalPath = db.getDbPath();
        const globalExists = require('fs').existsSync(globalPath);
        log(`Cursor global DB: ${globalPath}`);
        log(`  exists: ${globalExists}`);

        const wsDbPath = findWorkspaceStorageDbPath(root);
        log(`Workspace DB (workspaceStorage): ${wsDbPath ?? '없음'}`);

        try {
          store.ensureDir();
          const testFile = require('path').join(dirPath, 'diagnose-test.txt');
          require('fs').writeFileSync(testFile, `diagnose ${Date.now()}\n`, 'utf-8');
          log(`✅ .ai-context 쓰기 테스트 성공: ${testFile}`);
        } catch (e) {
          log(`❌ .ai-context 쓰기 실패: ${e instanceof Error ? e.message : e}`);
        }

        if (globalExists) {
          try {
            await db.initialize();
            const composers = await db.getAllComposers();
            log(`composers 수: ${composers.length}`);
            if (composers.length > 0) {
              const latest = await db.getLatestAIBubble();
              log(`latest AI bubble: ${latest ? latest.bubbleId?.substring(0, 8) : '없음'}`);
            } else {
              log('composers 없음 → AI 응답 감지 불가. workspaceStorage DB 확인 필요.');
            }
            db.close();
          } catch (e) {
            log(`DB 읽기 오류: ${e instanceof Error ? e.message : e}`);
          }
        } else {
          log('global DB 없음 → Cursor 채팅 이력 읽기 불가.');
        }

        const summary = lines.join('\n');
        vscode.window.showInformationMessage(
          `진단 완료. 개발자 도구 콘솔에서 [Diagnose] 로그를 확인하세요.`
        );
        console.log(summary);
      }
    );

    context.subscriptions.push(showFullContextCommand);
    context.subscriptions.push(copyContextCommand);
    context.subscriptions.push(saveMetadataCommand);
    context.subscriptions.push(diagnoseCommand);

    vscode.window.showInformationMessage(
      '✅ AI Context Tracker 활성화 완료! 이제 AI 응답이 자동으로 .ai-context에 저장됩니다.'
    );

    console.log('[Phase 1] ========================================');
    console.log('[Phase 1] AI Context Tracker 활성화 완료');
    console.log('[Phase 1] - Hover Provider: 활성');
    console.log('[Phase 1] - AI Response Detector: 활성 (5초 간격)');
    console.log('[Phase 1] - File Change Tracker: 활성 (30초/±5초 윈도우)');
    console.log('[Phase 1] ========================================');

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[Phase 1] ❌ 활성화 중 오류 발생:', errorMsg);
    vscode.window.showErrorMessage(`[Phase 1] 오류: ${errorMsg}`);
  }
}

export async function activate(context: vscode.ExtensionContext) {
  console.log('[AI Context Tracker] 확장 활성화 시작...');

  // 워크스페이스가 나중에 열리는 경우를 위해 변경 이벤트를 구독
  const workspaceSub = vscode.workspace.onDidChangeWorkspaceFolders(() => {
    if (!initialized) {
      initializeForWorkspace(context);
    }
  });
  context.subscriptions.push(workspaceSub);

  // 이미 워크스페이스가 열려 있는 경우 즉시 초기화 시도
  await initializeForWorkspace(context);
}

export function deactivate() {
  console.log('[AI Context Tracker] 확장 비활성화');
  if (fileChangeTracker) {
    fileChangeTracker.stop();
    fileChangeTracker = null;
  }
  if (aiResponseDetector) {
    aiResponseDetector.stopPolling();
    aiResponseDetector = null;
  }
}
