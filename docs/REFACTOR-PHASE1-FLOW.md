# Phase 1 MVP 리팩토링: Git 기반 변경 추적 흐름

## 목표 처리 순서

1. **FileSystemWatcher** → 워크스페이스 코드 변경 감지
2. **git diff --cached** → 스테이징된 변경 파일 + 라인 범위 추출
3. **.ai-context/{id}.json** 메타데이터 생성 (아직 커밋 전)
4. **ai-context-{username}** 브랜치로 자동 커밋
5. (옵션, 이후) AI 응답 감지로 메타데이터 보강

Cursor DB 파싱·AI 요약은 이 단계에서 제외.

---

## 책임 분리 구조

```
extension.ts
    │
    ├─ WorkspaceChangeWatcher (detectors/ 또는 watchers/)
    │       │ 1. createFileSystemWatcher(workspace **/*)
    │       │ 2. debounce 후 파이프라인 실행
    │       └─► runPipeline()
    │
    ├─ GitDiffService (utils/gitDiff.ts)
    │       │ 2. git diff --cached 실행 + 파싱
    │       └─► getStagedChanges(workspaceRoot): Promise<StagedChange[]>
    │
    ├─ MetadataStore (store/metadataStore.ts)
    │       │ 3. .ai-context/{id}.json 쓰기/읽기
    │       ├─ writeChangeMetadata(id, data)
    │       ├─ readChangeMetadata(id)
    │       └─ listChangeIds() / index for Hover
    │
    └─ GitCommitService (utils/gitCommit.ts)
              │ 4. ai-context-{user} 브랜치 생성/체크아웃, .ai-context 커밋
              └─► ensureBranch(), commitAiContext(workspaceRoot)
```

- **extension.ts**: 위 서비스들을 생성하고, `WorkspaceChangeWatcher`만 구독에 넣어서 활성화.  
  AI Response Detector는 Phase 1에서 비활성화하거나, 명령으로만 켜도록 유지.

- **providers/hoverProvider.ts**: 기존 유지. `MetadataStore`가 `.ai-context/*.json` + index에서 로드하도록만 변경하면 됨.

---

## 데이터 흐름

1. **파일 변경** → `FileSystemWatcher.onDidChange` (debounce 500ms~1s)
2. **파이프라인**  
   `getStagedChanges(root)` → 없으면 스킵  
   → `StagedChange[]` 기준으로 `id = uuid()` 생성  
   → `MetadataStore.writeChangeMetadata(id, { id, filePath, lineRanges, timestamp })`  
   → `GitCommitService.ensureBranch()` 후 `commitAiContext()` (추가/변경된 .ai-context만)
3. **Hover**: 기존처럼 `MetadataStore`에서 파일/라인별 메타데이터 조회 (index는 .ai-context/*.json 기반으로 갱신)

---

## 파일별 역할

| 파일 | 역할 |
|------|------|
| `utils/gitDiff.ts` | `git diff --cached` 실행, unified diff 파싱 → `StagedChange[]` (filePath, lineRanges) |
| `utils/gitCommit.ts` | `ai-context-{username}` 브랜치 확인/생성, `.ai-context/` add + commit |
| `store/metadataStore.ts` | `.ai-context/{id}.json` 쓰기/읽기, index 갱신 (byFile, byId) |
| `detectors/workspaceChangeWatcher.ts` | 워크스페이스 watcher + debounce, 2→3→4 순서로 호출 |
| `extension.ts` | Watcher 등록, CursorDB/AIResponseDetector는 Phase 1에서 제거 또는 옵션 |

---

## 타입 (Phase 1)

- **StagedChange**: `{ filePath: string; lineRanges: { start, end }[] }` — git diff 파싱 결과
- **GitChangeMetadata**: `id`, `timestamp`, `filePath`, `lineRanges`, `commitHash?` (이후 `prompt?`, `aiResponse?` 보강 가능)

기존 `AICodeMetadata`는 Phase 5에서 메타데이터 보강 시 사용. Phase 1에서는 `GitChangeMetadata`만 쓰거나, `AICodeMetadata`의 prompt/aiResponse를 optional로 두고 공용으로 써도 됨.
