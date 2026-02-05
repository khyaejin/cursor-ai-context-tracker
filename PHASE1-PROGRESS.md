# Phase 1 MVP 진행 정리 (개조식)

## README 기준 “다음 단계” 대비 현황

### ✅ 완료된 항목

- AI 응답 자동 감지 (5초 폴링) — 구현됨, Phase 1에서는 **비활성화** (Git 흐름만 사용)
- 파일 변경 추적 (FileSystemWatcher) — **워크스페이스 코드** watcher로 전환 (Cursor DB watcher 대신)
- **Git 자동 커밋 (ai-context-{username} 브랜치)** — 구현 완료
- **라인 범위 추적 (Git diff 파싱)** — `git diff --cached` 파싱으로 구현
- 실제 메타데이터 저장 (.ai-context/) — **.ai-context/{id}.json** 단위 저장 + change-index.json 추가

### ❌ 아직 안 한 것 (README·ARCHITECTURE-STATUS 기준)

- CodeLens Provider
- Decoration Provider
- Webview Panel (상세 뷰)
- Tree View (히스토리)
- Phase 5: AI 응답 감지로 메타데이터 보강 (Cursor DB → prompt/aiResponse 채우기)

---

## 적용한 처리 순서 (1→2→3→4)

1. **FileSystemWatcher** → 워크스페이스 `**/*.{ts,tsx,js,jsx,json,md}` 변경 감지, 800ms debounce
2. **git diff --cached** → 스테이징된 변경만 대상, unified diff 파싱 → 파일별 + 라인 범위
3. **.ai-context/{id}.json** → 변경당 id 생성, `GitChangeMetadata` 저장, change-index 갱신
4. **ai-context-{username}** → 해당 브랜치로 체크아웃(없으면 orphan 생성) → `git add -f .ai-context/` → 커밋 → 원래 브랜치로 복귀

---

## 구현 방법 요약

### Git

- `git diff --cached -U0` 실행 후 stdout을 라인 단위 파싱
- `diff --git a/path b/path` → 파일 경로, `@@ -x,y +a,b @@` → 새 파일 쪽 라인 범위(a, b)
- 인접 라인 범위 병합 후 `StagedChange[]` 반환
- 브랜치: `git config user.name`으로 username → `ai-context-{username}`; 없으면 `checkout --orphan` 후 `reset HEAD`
- 커밋: `git add -f .ai-context/` (.gitignore 무시), 커밋 후 `restoreBranch()`로 원래 브랜치 복귀

### 메타데이터

- 기존: `metadata.json`(배열) + `index.json`(byBubbleId, byFile) — AI 응답 감지용, 유지
- 추가: `.ai-context/{id}.json` (파일당 1개) + `change-index.json` (byFile, byId)
- id: `change-{Date.now()}-{random}` 형식

### 확장 진입점

- Phase 1: `WorkspaceChangeWatcher`만 구독에 등록
- CursorDB, AIResponseDetector는 import/등록 제거(주석 처리)
- Hover: `readMetadata()`(기존) + `listChangeIds()`/`readChangeMetadata()`(Phase 1) 둘 다 사용, `HoverMetadata`로 통일 표시

---

## 추가/수정된 파일


| 파일                                        | 내용                                                                                                                            |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `src/cursor/types.ts`                     | `LineRange`, `StagedChange`, `GitChangeMetadata` 추가                                                                           |
| `src/utils/gitDiff.ts`                    | **신규** — getStagedChanges(), parseUnifiedDiff(), mergeAdjacentRanges()                                                        |
| `src/utils/gitCommit.ts`                  | **신규** — getGitUsername(), ensureAiContextBranch(), commitAiContext(), restoreBranch()                                        |
| `src/store/metadataStore.ts`              | writeChangeMetadata(), readChangeMetadata(), listChangeIds(), readChangeIndex(), getChangeMetadataByFile(), change-index.json |
| `src/detectors/workspaceChangeWatcher.ts` | **신규** — watcher + debounce → getStagedChanges → writeChangeMetadata → ensure → commit → restore                              |
| `src/extension.ts`                        | WorkspaceChangeWatcher 등록, CursorDB/AIResponseDetector 제거                                                                     |
| `src/providers/hoverProvider.ts`          | GitChangeMetadata 로드, HoverMetadata 타입, prompt/aiResponse 있을 때만 표시                                                            |
| `docs/REFACTOR-PHASE1-FLOW.md`            | **신규** — Phase 1 흐름·책임 분리 문서                                                                                                  |


---

## .ai-context 생성·확인 방법

### 언제 생기는지
- **폴더 `.ai-context/`**: 확장 활성화 시 `metadataStore.ensureDir()` 호출로 생성 (워크스페이스 루트)
- **파일 `.ai-context/{id}.json`**: **스테이징된 변경이 있을 때** + 워크스페이스 파일이 바뀌면 Watcher가 돌면서 생성

### 확인 절차 (Extension Development Host)
1. **F5**로 Extension Development Host 실행 (새 창에서 이 프로젝트 폴더가 열림)
2. **Git 저장소인지 확인**  
   터미널에서 `git status` → 정상이어야 함
3. **변경 후 스테이징**  
   예: `src/extension.ts` 한 줄 수정 → 저장 → `git add src/extension.ts` (또는 `git add .`)
4. **Watcher 트리거**  
   스테이징한 뒤, 해당 확장자 파일을 한 번 더 저장하거나 살짝 수정 후 저장 (또는 800ms 정도 대기)
5. **폴더 확인**  
   - 프로젝트 루트에 `.ai-context/` 폴더가 생겼는지 확인  
   - VS Code 탐색기에서 **숨김 파일 표시** 켜기 (설정 또는 `files.exclude`에서 `.ai-context` 제외 여부 확인)  
   - `.ai-context/` 안에 `change-*.json`, `change-index.json` 있는지 확인
6. **콘솔 로그**  
   Development Host 창에서 **Help → Toggle Developer Tools → Console**  
   - `[WorkspaceChangeWatcher] Committed to ai-context-...` 로그가 있으면 파이프라인까지 실행된 것

### 스테이징이 없으면
- `getStagedChanges()`가 빈 배열을 반환 → `.ai-context/{id}.json`은 생성되지 않음
- 폴더만 있고 비어 있거나 `change-index.json`만 있을 수 있음 (다른 경로로 생성된 경우)

### 터미널로 빠르게 확인
```bash
# 프로젝트 루트에서
ls -la .ai-context/
cat .ai-context/change-index.json   # 있으면 byFile, byId 확인
```

---

## 앞으로 할 일 (우선순위 가정)

- Phase 5: AI 응답 감지 다시 켜서 기존 메타데이터에 prompt/aiResponse 보강 (같은 id 또는 bubbleId 매칭)
- CodeLens / Decoration / Webview / Tree View (아키텍처 문서 기준)
- README·ARCHITECTURE-STATUS.md에 Phase 1 리팩토링 결과 반영

