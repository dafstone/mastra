# Vercel Sandbox Adapter for Mastra Workspaces

## TL;DR

> **Quick Summary**: Build `@mastra/vercel` — a workspace sandbox adapter that wraps the Vercel Sandbox SDK (`@vercel/sandbox` v1.6.0) behind Mastra's `WorkspaceSandbox` interface, following the same patterns as the existing `@mastra/e2b` adapter.
>
> **Deliverables**:
>
> - `workspaces/vercel/` package with `VercelSandbox` class extending `MastraSandbox`
> - Full lifecycle support (start/stop/destroy), command execution with streaming bridge, file-sync-based mounts
> - Vercel-specific features exposed: snapshots, network policies, port domains
> - TDD unit tests with mocked SDK + shared test suite integration
> - Documentation: reference page + sidebar entry
> - Provider descriptor for MastraEditor integration
>
> **Estimated Effort**: Medium
> **Parallel Execution**: YES — 4 waves
> **Critical Path**: Task 1 (package scaffold) → Task 3 (types) → Task 5 (core adapter) → Task 9 (unit tests) → Final Verification

---

## Context

### Original Request

Build a Vercel Sandbox adapter for Mastra Workspaces. User shared a Gemini feasibility analysis that claimed it would be ~100 lines and straightforward. We verified against the real codebase and found Gemini was partially wrong — the real interface has different method signatures, no `teardown()` method, and the E2B reference adapter is 974 lines. However, the overall approach is sound.

### Interview Summary

**Key Discussions**:

- Verified Gemini's claims: correct on base class existence, wrong on method signatures, LOC estimate, and lifecycle methods
- Fully mapped Mastra's `WorkspaceSandbox` interface + `MastraSandbox` base class
- Fully mapped Vercel Sandbox SDK v1.6.0 API from source code (librarian research)
- Identified key differences: no FUSE (file sync instead), streaming bridge needed (Writable → callbacks), Vercel-unique features (snapshots, network policies)
- User chose: TDD, file sync mounts, expose Vercel features as public methods, include docs

**Research Findings**:

- `WorkspaceSandbox` interface at `packages/core/src/workspace/sandbox/sandbox.ts` — extends `SandboxLifecycle<SandboxInfo>`
- `MastraSandbox` base at `packages/core/src/workspace/sandbox/mastra-sandbox.ts` — race-safe lifecycle wrappers, `ensureRunning()`, auto MountManager
- E2B adapter at `workspaces/e2b/src/sandbox/index.ts` — 974 lines, complex mount/template/reconnection
- Vercel SDK: `Sandbox.create()`, `runCommand()`, `writeFiles()`, `readFile()`, `stop()`, `domain()`, `snapshot()`, `extendTimeout()`, `updateNetworkPolicy()`
- Shared test utils at `workspaces/_test-utils/src/sandbox/` — `createSandboxLifecycleTests`, `createMountOperationsTests`, `SandboxTestConfig`

### Metis Review

**Identified Gaps** (addressed):

- ProviderStatus mapping: Vercel `"running"` → Mastra `"active"`, `"failed"` → `"error"` — documented in adapter
- Streaming bridge: Vercel uses `stdout: Writable`, Mastra uses `onStdout: (data: string) => void` — bridge using `new Writable({ write() })`
- Error classes: Must use `SandboxExecutionError`, `SandboxTimeoutError`, `SandboxNotReadyError` from core
- MountManager auto-creation: handled by `MastraSandbox` when `mount()` is implemented — no manual wiring needed
- `mounts.processPending()` called automatically by `MastraSandbox._executeStart()` — do NOT call manually
- Destroy-then-restart guard: `MastraSandbox._start()` throws if status is `"destroyed"` — Vercel adapter inherits this
- Snapshot auto-stop: Vercel stops sandbox after `snapshot()` — must document and handle status update

---

## Work Objectives

### Core Objective

Create a production-ready `@mastra/vercel` package that enables Mastra workspaces to use Vercel Sandbox (Firecracker microVMs) for isolated code execution, with full lifecycle management, streaming command execution, file-sync mounts, and Vercel-specific features.

### Concrete Deliverables

- `workspaces/vercel/package.json` — package configuration
- `workspaces/vercel/tsup.config.ts` — build configuration
- `workspaces/vercel/src/index.ts` — barrel exports
- `workspaces/vercel/src/sandbox/index.ts` — `VercelSandbox` class
- `workspaces/vercel/src/sandbox/types.ts` — `VercelSandboxOptions`, Vercel-specific types
- `workspaces/vercel/src/sandbox/streaming.ts` — streaming bridge utilities
- `workspaces/vercel/src/provider.ts` — `vercelSandboxProvider` for MastraEditor
- `workspaces/vercel/src/sandbox/index.test.ts` — unit tests (mocked SDK)
- `docs/src/content/en/reference/workspace/vercel-sandbox.mdx` — reference docs

### Definition of Done

- [ ] `pnpm build` succeeds for `@mastra/vercel`
- [ ] `pnpm test:unit` passes in `workspaces/vercel/`
- [ ] `tsc --noEmit` passes with no type errors
- [ ] Docs build succeeds with new reference page

### Must Have

- Extends `MastraSandbox` base class (not raw interface)
- `provider = 'vercel'`, `name = 'VercelSandbox'`
- `start()` creates sandbox via `Sandbox.create()` with reconnection support via `Sandbox.get()`
- `stop()` calls `sandbox.stop()`
- `destroy()` calls `sandbox.stop()` (Vercel has no separate destroy)
- `executeCommand()` uses `sandbox.runCommand()` with streaming bridge for `onStdout`/`onStderr`
- `mount()` does full file sync via `sandbox.writeFiles()` — walks filesystem, writes all files
- `unmount()` cleans up tracked mount state
- `getInfo()` returns `SandboxInfo` with mapped ProviderStatus
- `getInstructions()` returns capabilities string
- Uses `ensureRunning()` in `executeCommand()` for auto-start
- `declare readonly mounts: MountManager` (non-optional typing)
- Auth: OIDC auto-detection + explicit token/teamId/projectId options
- Proper error handling using core error classes

### Must NOT Have (Guardrails)

- **NO FUSE mount implementation** — Vercel doesn't support FUSE; use file sync only
- **NO template management** — Vercel uses snapshots, not templates; do not port E2B template logic
- **NO S3/GCS mount helpers** — different paradigm from E2B; mount() handles all filesystem types generically
- **NO manual `mounts.processPending()` calls** — `MastraSandbox._executeStart()` handles this automatically
- **NO concurrency guards in start/stop/destroy** — `MastraSandbox._start/_stop/_destroy` already deduplicate
- **NO `as any` or `@ts-ignore`** — strict TypeScript only
- **NO console.log in production code** — use `this.logger` from `MastraBase`
- **NO over-abstraction** — keep it as a thin translation layer; don't abstract what doesn't need abstraction
- **NO commented-out code or excessive JSDoc** — clean, minimal comments where behavior is non-obvious

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision

- **Infrastructure exists**: YES — vitest across the monorepo
- **Automated tests**: TDD (RED → GREEN → REFACTOR)
- **Framework**: vitest (matching E2B adapter)
- **Shared test suite**: Use `createSandboxLifecycleTests` and `createMountOperationsTests` from `@internal/workspace-test-utils`

### QA Policy

Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Library/Module**: Use Bash (bun/node) — Import, call functions, compare output
- **Build verification**: Use Bash — `pnpm build`, `tsc --noEmit`
- **Test verification**: Use Bash — `pnpm test:unit`
- **Docs**: Use Bash — verify docs build

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — foundation):
├── Task 1: Package scaffold (package.json, tsup, tsconfig) [quick]
├── Task 2: Streaming bridge utility [quick]
└── Task 3: Types & options interface [quick]

Wave 2 (After Wave 1 — core implementation):
├── Task 4: Mount file-sync utilities [unspecified-high]
├── Task 5: Core VercelSandbox class [deep]
├── Task 6: Provider descriptor [quick]
└── Task 7: Barrel exports [quick]

Wave 3 (After Wave 2 — tests & docs):
├── Task 8: TDD unit tests — lifecycle & constructor [unspecified-high]
├── Task 9: TDD unit tests — executeCommand & mounts [unspecified-high]
├── Task 10: Shared test suite integration [quick]
├── Task 11: Reference documentation page [writing]
└── Task 12: Docs sidebar entry [quick]

Wave 4 (After Wave 3 — build verification):
└── Task 13: Full build & type-check verification [quick]

Wave FINAL (After ALL tasks — independent review, 4 parallel):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)

Critical Path: Task 1 → Task 3 → Task 5 → Task 9 → Task 13 → F1-F4
Parallel Speedup: ~60% faster than sequential
Max Concurrent: 4 (Wave 2)
```

### Dependency Matrix

| Task | Depends On | Blocks           | Wave |
| ---- | ---------- | ---------------- | ---- |
| 1    | —          | 2, 3, 4, 5, 6, 7 | 1    |
| 2    | 1          | 5                | 1    |
| 3    | 1          | 4, 5, 6, 7       | 1    |
| 4    | 1, 3       | 5, 9             | 2    |
| 5    | 1, 2, 3, 4 | 7, 8, 9, 10, 13  | 2    |
| 6    | 1, 3       | 7                | 2    |
| 7    | 5, 6       | 8, 9, 13         | 2    |
| 8    | 5, 7       | 13               | 3    |
| 9    | 5, 7       | 13               | 3    |
| 10   | 5, 7       | 13               | 3    |
| 11   | 5          | —                | 3    |
| 12   | 11         | —                | 3    |
| 13   | 8, 9, 10   | F1-F4            | 4    |

### Agent Dispatch Summary

- **Wave 1**: **3 tasks** — T1 → `quick`, T2 → `quick`, T3 → `quick`
- **Wave 2**: **4 tasks** — T4 → `unspecified-high`, T5 → `deep`, T6 → `quick`, T7 → `quick`
- **Wave 3**: **5 tasks** — T8 → `unspecified-high`, T9 → `unspecified-high`, T10 → `quick`, T11 → `writing`, T12 → `quick`
- **Wave 4**: **1 task** — T13 → `quick`
- **FINAL**: **4 tasks** — F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs
> Implementation + Test = ONE Task. Never separate.
> EVERY task MUST have: Recommended Agent Profile + Parallelization info + QA Scenarios.
> **A task WITHOUT QA Scenarios is INCOMPLETE. No exceptions.**

 [x] 1. Package Scaffold

  **What to do**:
  - Create `workspaces/vercel/` directory
  - Create `package.json` modeled on `workspaces/e2b/package.json`:
    - Name: `@mastra/vercel`
    - Version: `0.0.1`
    - Type: `module`
    - Same `exports` structure (ESM + CJS)
    - Dependencies: `@vercel/sandbox: ^1.6.0`
    - DevDependencies: `@internal/lint`, `@internal/types-builder`, `@internal/workspace-test-utils`, `@mastra/core`, `@types/node`, `@vitest/coverage-v8`, `@vitest/ui`, `eslint`, `tsup`, `typescript`, `vitest` (all using `workspace:*` or `catalog:` as in E2B)
    - PeerDependencies: `@mastra/core: >=1.3.0-0 <2.0.0-0`
    - Scripts: `build`, `build:lib`, `build:watch`, `test:unit`, `test:watch`, `lint` (same as E2B)
    - Engines: `node: >=22.13.0`
    - Repository directory: `workspaces/vercel`
  - Create `tsup.config.ts` modeled on `workspaces/e2b/tsup.config.ts`:
    - Entry: `src/index.ts`
    - Format: `['esm', 'cjs']`
    - External: `['@mastra/core', '@vercel/sandbox']`
    - Use `@internal/types-builder` `generateTypes` in `onSuccess`
  - Create `tsconfig.json` modeled on `workspaces/e2b/tsconfig.json`:
    - Extends `../../tsconfig.node.json`
    - Include: `src/**/*`, `tsup.config.ts`
    - Exclude: `node_modules`, `**/*.test.ts`
  - Create empty `src/index.ts` placeholder (just a comment `// barrel exports - filled in Task 7`)

  **Must NOT do**:
  - Do NOT add `e2b` as a dependency
  - Do NOT copy E2B-specific fields (template, S3/GCS mount types)
  - Do NOT run `pnpm install` (build verification happens in Task 13)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: File creation with known content, no complex logic
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3)
  - **Blocks**: Tasks 2, 3, 4, 5, 6, 7
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `workspaces/e2b/package.json` - Package.json structure template (copy structure, change name/deps/description)
  - `workspaces/e2b/tsup.config.ts` - Build configuration template (change external array)
  - `workspaces/e2b/tsconfig.json` - TypeScript config template (copy exactly)

  **WHY Each Reference Matters**:
  - `package.json`: Defines the exact exports shape, scripts, peer deps range, and engine constraints that every workspace package must follow
  - `tsup.config.ts`: The `@internal/types-builder` `generateTypes` call in `onSuccess` is critical - without it, `.d.ts` files won't be generated
  - `tsconfig.json`: Must extend `../../tsconfig.node.json` to inherit strict TS settings

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Package.json is valid JSON with correct structure
    Tool: Bash
    Preconditions: workspaces/vercel/ directory created
    Steps:
      1. Run: cat workspaces/vercel/package.json | jq '.name'
      2. Assert output is "@mastra/vercel"
      3. Run: cat workspaces/vercel/package.json | jq '.peerDependencies["@mastra/core"]'
      4. Assert output is ">=1.3.0-0 <2.0.0-0"
      5. Run: cat workspaces/vercel/package.json | jq '.dependencies["@vercel/sandbox"]'
      6. Assert output starts with "^1.6"
    Expected Result: All assertions pass
    Failure Indicators: jq parse error, wrong package name, missing peer dep
    Evidence: .sisyphus/evidence/task-1-package-json-valid.txt

  Scenario: tsup.config.ts references correct externals
    Tool: Bash
    Preconditions: workspaces/vercel/tsup.config.ts created
    Steps:
      1. Run: grep -q '@vercel/sandbox' workspaces/vercel/tsup.config.ts && echo 'found'
      2. Assert output is 'found'
      3. Run: grep -q '@mastra/core' workspaces/vercel/tsup.config.ts && echo 'found'
      4. Assert output is 'found'
    Expected Result: Both externals present
    Failure Indicators: grep returns empty
    Evidence: .sisyphus/evidence/task-1-tsup-config.txt
  ```

  **Commit**: YES (groups with Wave 1 commit)
  - Message: `feat(vercel): scaffold @mastra/vercel package with types and streaming utils`
  - Files: `workspaces/vercel/package.json`, `workspaces/vercel/tsup.config.ts`, `workspaces/vercel/tsconfig.json`, `workspaces/vercel/src/index.ts`

 [x] 2. Streaming Bridge Utility

  **What to do**:
  - Create `workspaces/vercel/src/sandbox/streaming.ts`
  - Implement `createStreamingBridge(callbacks)` function that converts Mastra's `onStdout`/`onStderr` callbacks into Node.js `Writable` streams compatible with Vercel SDK's `RunCommandParams.stdout` / `RunCommandParams.stderr`
  - Implementation:
    ```typescript
    import { Writable } from 'node:stream';
    
    export interface StreamingCallbacks {
      onStdout?: (data: string) => void;
      onStderr?: (data: string) => void;
    }
    
    export interface StreamingBridge {
      stdout?: Writable;
      stderr?: Writable;
    }
    
    export function createStreamingBridge(callbacks: StreamingCallbacks): StreamingBridge {
      const bridge: StreamingBridge = {};
      if (callbacks.onStdout) {
        bridge.stdout = new Writable({
          write(chunk, _encoding, callback) {
            callbacks.onStdout!(Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk));
            callback();
          },
        });
      }
      if (callbacks.onStderr) {
        bridge.stderr = new Writable({
          write(chunk, _encoding, callback) {
            callbacks.onStderr!(Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk));
            callback();
          },
        });
      }
      return bridge;
    }
    ```
  - Keep the file small and focused - this is a pure utility

  **Must NOT do**:
  - Do NOT add stream buffering or batching
  - Do NOT import from `@vercel/sandbox` - this is a pure Node.js utility
  - Do NOT handle backpressure complexity - callbacks are synchronous

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single utility function, ~40 lines, clear specification
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3)
  - **Blocks**: Task 5 (core class uses this)
  - **Blocked By**: Task 1 (needs package scaffold)

  **References**:

  **Pattern References**:
  - `packages/core/src/workspace/sandbox/types.ts:ExecuteCommandOptions` - Shows `onStdout?: (data: string) => void` and `onStderr?: (data: string) => void` callback signatures that the bridge must accept

  **API/Type References**:
  - Vercel SDK `RunCommandParams` accepts `stdout?: Writable` and `stderr?: Writable` (Node.js `stream.Writable`)

  **External References**:
  - Node.js `stream.Writable` - https://nodejs.org/api/stream.html#class-streamwritable - `write(chunk, encoding, callback)` is the method to implement

  **WHY Each Reference Matters**:
  - `ExecuteCommandOptions`: Defines the exact callback signature `(data: string) => void` that is the input to the bridge
  - Vercel SDK `RunCommandParams`: The bridge output must be assignable to `stdout`/`stderr` fields
  - Node.js Writable: The `write()` method contract (chunk is `Buffer | string`, must call `callback()`) must be followed

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Streaming bridge converts chunks to callback calls
    Tool: Bash
    Preconditions: workspaces/vercel/src/sandbox/streaming.ts created
    Steps:
      1. Run: npx tsx -e "
         import { createStreamingBridge } from './workspaces/vercel/src/sandbox/streaming';
         const chunks: string[] = [];
         const bridge = createStreamingBridge({ onStdout: (d) => chunks.push(d) });
         bridge.stdout!.write('hello');
         bridge.stdout!.write(Buffer.from(' world'));
         setTimeout(() => { console.log(JSON.stringify(chunks)); }, 50);
         "
      2. Assert output is ["hello"," world"]
    Expected Result: Both string and Buffer chunks converted to string callbacks
    Failure Indicators: Import error, empty chunks array, Buffer not converted
    Evidence: .sisyphus/evidence/task-2-streaming-bridge.txt

  Scenario: Bridge returns empty object when no callbacks provided
    Tool: Bash
    Preconditions: streaming.ts exists
    Steps:
      1. Run: npx tsx -e "
         import { createStreamingBridge } from './workspaces/vercel/src/sandbox/streaming';
         const bridge = createStreamingBridge({});
         console.log(JSON.stringify({ hasStdout: !!bridge.stdout, hasStderr: !!bridge.stderr }));
         "
      2. Assert output is {"hasStdout":false,"hasStderr":false}
    Expected Result: No streams created when no callbacks given
    Failure Indicators: Streams created when not needed
    Evidence: .sisyphus/evidence/task-2-streaming-no-callbacks.txt
  ```

  **Commit**: YES (groups with Wave 1 commit)
  - Message: `feat(vercel): scaffold @mastra/vercel package with types and streaming utils`
  - Files: `workspaces/vercel/src/sandbox/streaming.ts`

 [x] 3. Types & Options Interface

  **What to do**:
  - Create `workspaces/vercel/src/sandbox/types.ts`
  - Define `VercelSandboxOptions` interface extending `MastraSandboxOptions`:
    ```typescript
    import type { MastraSandboxOptions } from '@mastra/core/workspace';
    import type { ProviderStatus } from '@mastra/core/workspace';
    
    export interface VercelSandboxOptions extends MastraSandboxOptions {
      /** Unique identifier for this sandbox instance */
      id?: string;
      /** Execution timeout in milliseconds @default 300_000 (5 minutes) */
      timeout?: number;
      /** Environment variables to set in the sandbox */
      env?: Record<string, string>;
      
      // Vercel auth (OIDC auto-detected on Vercel platform)
      /** Vercel API token. Falls back to VERCEL_TOKEN env var. */
      token?: string;
      /** Vercel team ID. Falls back to VERCEL_TEAM_ID env var. */
      teamId?: string;
      /** Vercel project ID. Falls back to VERCEL_PROJECT_ID env var. */
      projectId?: string;
      
      // Vercel-specific sandbox options
      /** Sandbox memory in MB */
      memory?: number;
      /** Number of vCPUs */
      cpus?: number;
    }
    
    export const VERCEL_STATUS_MAP: Record<string, ProviderStatus> = {
      pending: 'pending',
      running: 'active',
      stopping: 'stopping',
      stopped: 'stopped',
      failed: 'error',
    };
    
    export const LOG_PREFIX = '[Vercel]';
    ```

  **Must NOT do**:
  - Do NOT include template-related options (Vercel uses snapshots, not templates)
  - Do NOT include S3/GCS mount config types
  - Do NOT import from `@vercel/sandbox` in this types file

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Pure type definitions, no complex logic
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2)
  - **Blocks**: Tasks 4, 5, 6, 7
  - **Blocked By**: Task 1 (needs package scaffold)

  **References**:

  **Pattern References**:
  - `workspaces/e2b/src/sandbox/index.ts:52-86` - `E2BSandboxOptions` interface pattern (extends `MastraSandboxOptions`, has `id`, `timeout`, `env`, auth fields)

  **API/Type References**:
  - `packages/core/src/workspace/sandbox/mastra-sandbox.ts:MastraSandboxOptions` - Base options type to extend
  - `packages/core/src/workspace/lifecycle.ts:ProviderStatus` - Status type used in status map
  - Vercel SDK statuses: `'pending' | 'running' | 'stopping' | 'stopped' | 'failed'`

  **WHY Each Reference Matters**:
  - `E2BSandboxOptions`: Establishes the pattern for how sandbox options are structured
  - `MastraSandboxOptions`: Must extend this for `name` and lifecycle hook options
  - `ProviderStatus`: The status map must output valid ProviderStatus values

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Types file compiles without errors
    Tool: Bash
    Preconditions: workspaces/vercel/src/sandbox/types.ts created, @mastra/core built
    Steps:
      1. Run: npx tsc --noEmit --project workspaces/vercel/tsconfig.json 2>&1 || true
      2. Check that no errors reference types.ts
    Expected Result: types.ts has no type errors
    Failure Indicators: TypeScript error mentioning types.ts
    Evidence: .sisyphus/evidence/task-3-types-compile.txt

  Scenario: VERCEL_STATUS_MAP covers all Vercel statuses
    Tool: Bash
    Preconditions: types.ts created
    Steps:
      1. Run: grep -c 'pending\|running\|stopping\|stopped\|failed' workspaces/vercel/src/sandbox/types.ts
      2. Assert count >= 5 (all 5 Vercel statuses present)
    Expected Result: All Vercel statuses mapped
    Failure Indicators: Count < 5
    Evidence: .sisyphus/evidence/task-3-status-map.txt
  ```

  **Commit**: YES (groups with Wave 1 commit)
  - Message: `feat(vercel): scaffold @mastra/vercel package with types and streaming utils`
  - Files: `workspaces/vercel/src/sandbox/types.ts`

 [x] 4. Mount File-Sync Utilities

  **What to do**:
  - Create `workspaces/vercel/src/sandbox/mount-sync.ts`
  - Implement file sync logic for Vercel's `writeFiles()` API (no FUSE):
    ```typescript
    import type { WorkspaceFilesystem } from '@mastra/core/workspace';
    
    export interface FileSyncResult {
      filesWritten: number;
      totalBytes: number;
      errors: string[];
    }
    
    /**
     * Walk a WorkspaceFilesystem and return all files as { path, content } pairs
     * suitable for Vercel's sandbox.writeFiles() API.
     */
    export async function walkFilesystem(
      filesystem: WorkspaceFilesystem,
      basePath: string,
    ): Promise<{ path: string; content: Buffer }[]> {
      // Use filesystem.listFiles() or readDir() to enumerate
      // Then filesystem.readFile() for each file
      // Return array of { path: `${basePath}/${relativePath}`, content: Buffer }
    }
    ```
  - The function should:
    1. List all files in the filesystem (using `WorkspaceFilesystem` methods)
    2. Read each file's content
    3. Return `{ path: string; content: Buffer }[]` matching Vercel's `writeFiles()` signature
  - Handle errors gracefully - log warnings for unreadable files, don't fail entire sync
  - NOTE: Check `WorkspaceFilesystem` interface for exact method names (`readFile`, `readDir`, `stat`)

  **Must NOT do**:
  - Do NOT call `sandbox.writeFiles()` here - that's done by the main class in Task 5
  - Do NOT import from `@vercel/sandbox`
  - Do NOT implement FUSE mounting
  - Do NOT handle recursive directory creation (Vercel's writeFiles handles paths)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Needs to understand WorkspaceFilesystem interface and implement recursive file walking
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 5, 6, 7)
  - **Blocks**: Task 5 (core class uses this for mount())
  - **Blocked By**: Tasks 1, 3 (needs scaffold + types)

  **References**:

  **Pattern References**:
  - `workspaces/e2b/src/sandbox/index.ts:220-344` - E2B `mount()` method - shows how E2B walks filesystem config and performs mount operations. Vercel equivalent is simpler (file sync instead of FUSE)

  **API/Type References**:
  - `packages/core/src/workspace/filesystem/filesystem.ts:WorkspaceFilesystem` - Interface with file methods. Check exact method signatures before implementation
  - Vercel SDK `writeFiles(files: { path: string; content: Buffer }[])` - Target format for the output

  **WHY Each Reference Matters**:
  - `WorkspaceFilesystem`: The exact method signatures determine how the walker is implemented
  - E2B mount: Shows the general pattern of how filesystems are consumed in adapters
  - Vercel writeFiles: Defines the exact output shape the walker must produce

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: walkFilesystem function exists and has correct signature
    Tool: Bash
    Preconditions: mount-sync.ts created
    Steps:
      1. Run: grep -c 'walkFilesystem' workspaces/vercel/src/sandbox/mount-sync.ts
      2. Assert count >= 1
      3. Run: grep 'Buffer' workspaces/vercel/src/sandbox/mount-sync.ts
      4. Assert Buffer type is referenced (for Vercel writeFiles compatibility)
    Expected Result: Function exists with Buffer return type
    Failure Indicators: Function missing or wrong return type
    Evidence: .sisyphus/evidence/task-4-mount-sync-signature.txt

  Scenario: FileSyncResult type is exported
    Tool: Bash
    Preconditions: mount-sync.ts created
    Steps:
      1. Run: grep 'export.*FileSyncResult' workspaces/vercel/src/sandbox/mount-sync.ts
      2. Assert match found
    Expected Result: FileSyncResult type is exported
    Failure Indicators: Type not exported
    Evidence: .sisyphus/evidence/task-4-file-sync-result.txt
  ```

  **Commit**: YES (groups with Wave 2 commit)
  - Message: `feat(vercel): implement VercelSandbox adapter with mount support`
  - Files: `workspaces/vercel/src/sandbox/mount-sync.ts`

 [x] 5. Core VercelSandbox Class

  **What to do**:
  - Create `workspaces/vercel/src/sandbox/index.ts`
  - Implement `VercelSandbox` class extending `MastraSandbox`:
    - Properties: `id: string`, `name = 'VercelSandbox'`, `provider = 'vercel'`, `status: ProviderStatus = 'pending'`, `declare readonly mounts: MountManager`
    - Private: `instance: Sandbox | null = null`, `sandboxOptions: VercelSandboxOptions`, `env: Record<string, string>`
    - Constructor: accept `VercelSandboxOptions`, call `super({ name: 'VercelSandbox', ...options })`, generate ID via `options.id ?? crypto.randomUUID()`, store env/timeout/auth options
  - Lifecycle methods (plain methods — base class wraps with race-safe guards):
    - `start()`: Create sandbox via `Sandbox.create({ timeout, teamId, projectId, token })`, store instance, set `status = 'active'`, log startup
    - `stop()`: Call `this.instance.stop()`, set instance to null, set `status = 'stopped'`
    - `destroy()`: Same as stop (Vercel has no separate destroy — `MastraSandbox` guards against restart after destroy)
  - `executeCommand(command, args?, options?)`:
    - Call `await this.ensureRunning()` for auto-start
    - Build command string: args.length > 0 ? `${command} ${args.map(shellQuote).join(' ')}` : command
    - Create streaming bridge via `createStreamingBridge({ onStdout: options.onStdout, onStderr: options.onStderr })`
    - Call `this.instance.runCommand({ cmd: fullCommand, cwd: options.cwd, env: { ...this.env, ...options.env }, stdout: bridge.stdout, stderr: bridge.stderr })`
    - Return `CommandResult` with `{ success: exitCode === 0, exitCode, stdout, stderr, executionTimeMs, command, args }`
    - Error handling: catch SDK errors, map to `SandboxExecutionError` / `SandboxTimeoutError`
  - `mount(filesystem, mountPath)`:
    - Call `await this.ensureRunning()`
    - Use `walkFilesystem(filesystem, mountPath)` from mount-sync.ts
    - Call `this.instance.writeFiles(files)` with the walked files
    - Return `MountResult` with `{ success: true, mountPath, filesWritten }`
  - `unmount(mountPath)`: Clean up tracked mount state (no Vercel API to unmount — just internal bookkeeping)
  - `getInfo()`: Return `SandboxInfo` with `{ id, provider: 'vercel', status: VERCEL_STATUS_MAP[instance?.status ?? 'stopped'], metadata: { timeout, domain, createdAt } }`
  - `getInstructions()`: Return string describing capabilities (execution, file ops, domain access, snapshot)
  - Vercel-specific public methods (exposed as additional API surface):
    - `async snapshot(options?)`: Call `this.instance.snapshot(options)`, update status to 'stopped' (Vercel auto-stops after snapshot), return Snapshot
    - `getDomain(port: number)`: Call `this.instance.domain(port)`, return URL string
    - `async extendTimeout(duration: number)`: Call `this.instance.extendTimeout(duration)`
    - `async updateNetworkPolicy(policy)`: Call `this.instance.updateNetworkPolicy(policy)`, return updated policy
    - `get sandboxInstance()`: Public getter for raw Vercel SDK `Sandbox` instance (escape hatch for advanced use)
  - Private helper:
    - `ensureSandbox()`: Call `await this.ensureRunning()`, return `this.instance!` (typed convenience)
    - `shellQuote(arg: string)`: Quote shell arguments (same pattern as E2B — see reference)
  - Reconnection support: if `options.id` is provided AND sandbox isn't started, attempt `Sandbox.get({ sandboxId: id })` in `start()` instead of `create()`

  **Must NOT do**:
  - Do NOT add concurrency guards to start/stop/destroy — `MastraSandbox` handles this
  - Do NOT call `mounts.processPending()` — `MastraSandbox._executeStart()` calls it
  - Do NOT implement FUSE mounting or template logic
  - Do NOT use `as any` or `@ts-ignore`
  - Do NOT use `console.log` — use `this.logger` from `MastraBase`

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Core class with ~500+ lines, complex lifecycle management, streaming integration, error handling, and Vercel-specific feature exposure
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - `e2e-tests-studio`: Not applicable — this is a library, not playground UI

  **Parallelization**:
  - **Can Run In Parallel**: YES (partially — same wave as Tasks 4, 6, 7 but logically depends on 2, 3, 4)
  - **Parallel Group**: Wave 2 (with Tasks 4, 6, 7)
  - **Blocks**: Tasks 7, 8, 9, 10, 13
  - **Blocked By**: Tasks 1, 2, 3, 4

  **References**:

  **Pattern References** (CRITICAL — the executor's primary guide):
  - `workspaces/e2b/src/sandbox/index.ts` — The ENTIRE file (974 lines). This is the reference implementation. Read ALL of it. Key sections:
    - Lines 1-50: imports, type imports, re-exports
    - Lines 52-86: `E2BSandboxOptions` interface
    - Lines 88-130: class declaration, properties, constructor
    - Lines 132-200: `start()` with template/reconnection logic
    - Lines 200-210: `stop()` and `destroy()`
    - Lines 212-344: `mount()` and `unmount()` — complex FUSE logic (Vercel is simpler)
    - Lines 346-500: `executeCommand()` with streaming, error handling, retry
    - Lines 500-600: `getInfo()`, `getInstructions()`
    - Lines 600-700: E2B-specific methods
    - Lines 700-974: helper methods, environment handling

  **API/Type References**:
  - `packages/core/src/workspace/sandbox/mastra-sandbox.ts` — `MastraSandbox` base class. Read FULLY. Understand `ensureRunning()`, lifecycle wrappers, `MountManager` auto-creation
  - `packages/core/src/workspace/sandbox/sandbox.ts` — `WorkspaceSandbox` interface. Every method here must be implemented
  - `packages/core/src/workspace/sandbox/types.ts` — `ExecuteCommandOptions`, `CommandResult`, `SandboxInfo`, `ExecutionResult`
  - `packages/core/src/workspace/sandbox/errors.ts` — `SandboxExecutionError`, `SandboxTimeoutError`, `SandboxNotReadyError`
  - `packages/core/src/workspace/lifecycle.ts` — `ProviderStatus` type, `SandboxLifecycle` interface
  - `packages/core/src/workspace/filesystem/mount.ts` — `MountResult`, `FilesystemMountConfig`

  **External References**:
  - Vercel SDK `Sandbox.create()`, `Sandbox.get()`, `sandbox.runCommand()`, `sandbox.writeFiles()`, `sandbox.stop()`, `sandbox.domain()`, `sandbox.snapshot()`, `sandbox.extendTimeout()`, `sandbox.updateNetworkPolicy()` — see Context section for full API signatures

  **WHY Each Reference Matters**:
  - E2B adapter (974 lines): This IS the pattern. The Vercel adapter should mirror its structure, naming, error handling, and lifecycle patterns. Deviations must be justified by Vercel SDK differences.
  - `MastraSandbox`: Must understand what's inherited (lifecycle guards, mount manager, ensureRunning) vs what must be implemented (start, stop, destroy, executeCommand, mount, getInfo)
  - Core types: Every return type must exactly match — `CommandResult`, `SandboxInfo`, `MountResult`
  - Error classes: Must throw the RIGHT error class. `SandboxExecutionError` for command failures, `SandboxTimeoutError` for timeouts, `SandboxNotReadyError` if sandbox isn't running

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: VercelSandbox class structure is correct
    Tool: Bash
    Preconditions: workspaces/vercel/src/sandbox/index.ts created
    Steps:
      1. Run: grep -c 'extends MastraSandbox' workspaces/vercel/src/sandbox/index.ts
      2. Assert count is 1
      3. Run: grep 'provider.*=.*vercel' workspaces/vercel/src/sandbox/index.ts
      4. Assert match found
      5. Run: grep 'declare readonly mounts' workspaces/vercel/src/sandbox/index.ts
      6. Assert match found
    Expected Result: Class extends MastraSandbox, has provider='vercel', declares mounts
    Failure Indicators: Missing extends, wrong provider, no mounts declaration
    Evidence: .sisyphus/evidence/task-5-class-structure.txt

  Scenario: All lifecycle methods exist
    Tool: Bash
    Preconditions: sandbox/index.ts created
    Steps:
      1. Run: grep -c 'async start\|async stop\|async destroy\|async executeCommand\|async mount\|async unmount\|getInfo\|getInstructions' workspaces/vercel/src/sandbox/index.ts
      2. Assert count >= 8
    Expected Result: All 8 required methods exist
    Failure Indicators: Count < 8
    Evidence: .sisyphus/evidence/task-5-lifecycle-methods.txt

  Scenario: Vercel-specific methods exist
    Tool: Bash
    Preconditions: sandbox/index.ts created
    Steps:
      1. Run: grep -c 'async snapshot\|getDomain\|async extendTimeout\|async updateNetworkPolicy' workspaces/vercel/src/sandbox/index.ts
      2. Assert count >= 4
    Expected Result: All 4 Vercel-specific methods present
    Failure Indicators: Count < 4
    Evidence: .sisyphus/evidence/task-5-vercel-methods.txt

  Scenario: No forbidden patterns
    Tool: Bash
    Preconditions: sandbox/index.ts created
    Steps:
      1. Run: grep -c 'as any\|@ts-ignore\|console\.log\|processPending' workspaces/vercel/src/sandbox/index.ts || echo '0'
      2. Assert count is 0
    Expected Result: No forbidden patterns found
    Failure Indicators: Any match found
    Evidence: .sisyphus/evidence/task-5-no-forbidden.txt
  ```

  **Commit**: YES (groups with Wave 2 commit)
  - Message: `feat(vercel): implement VercelSandbox adapter with mount support`
  - Files: `workspaces/vercel/src/sandbox/index.ts`

 [x] 6. Provider Descriptor

  **What to do**:
  - Create `workspaces/vercel/src/provider.ts` exporting `vercelSandboxProvider`
  - Define `VercelProviderConfig` interface with serializable-only config subset:
    - `token?: string` — Vercel API token
    - `teamId?: string` — Vercel team ID
    - `projectId?: string` — Vercel project ID
    - `timeout?: number` — sandbox timeout in milliseconds
    - `env?: Record<string, string>` — environment variables
  - Implement the `SandboxProvider<VercelProviderConfig>` descriptor:
    - `id: 'vercel'`
    - `name: 'Vercel Sandbox'`
    - `description: 'Cloud sandbox powered by Vercel'`
    - `configSchema` with JSON Schema type definitions for each property
    - `createSandbox: config => new VercelSandbox(config)`
  - Import `SandboxProvider` from `@mastra/core/editor` and `VercelSandbox` from `./sandbox`

  **Must NOT do**:
  - Do NOT include non-serializable config options (callbacks, runtime objects) in `VercelProviderConfig`
  - Do NOT add any logic beyond constructing the sandbox — this is a pure descriptor

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single file, ~50 lines, follows exact template from E2B provider
  - **Skills**: []
    - No specialized skills needed — straightforward TypeScript
  - **Skills Evaluated but Omitted**:
    - `react-best-practices`: Not a React component

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 5, 7)
  - **Blocks**: Task 7 (barrel exports need to export this)
  - **Blocked By**: Task 3 (needs `VercelSandboxOptions` types defined)

  **References** (CRITICAL - Be Exhaustive):

  **Pattern References** (existing code to follow):
  - `workspaces/e2b/src/provider.ts` — ENTIRE FILE is the template. Copy structure exactly: interface, then exported const with id/name/description/configSchema/createSandbox

  **API/Type References** (contracts to implement against):
  - `packages/core/src/editor/sandbox-provider.ts` — `SandboxProvider<T>` generic interface that this must satisfy
  - `workspaces/vercel/src/sandbox/types.ts` — `VercelSandboxOptions` (created in Task 3) — use to determine which options are serializable for `VercelProviderConfig`

  **WHY Each Reference Matters**:
  - E2B provider.ts: Exact structural template — copy the pattern (interface → export const) and adapt field names
  - SandboxProvider interface: The type contract this must satisfy — verify generic parameter usage
  - VercelSandboxOptions: Source of truth for what config fields exist — pick only serializable subset

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Provider descriptor has correct shape
    Tool: Bash
    Preconditions: provider.ts created
    Steps:
      1. Run: grep -c 'id.*vercel' workspaces/vercel/src/provider.ts
      2. Assert count >= 1
      3. Run: grep -c 'SandboxProvider' workspaces/vercel/src/provider.ts
      4. Assert count >= 1
      5. Run: grep -c 'createSandbox' workspaces/vercel/src/provider.ts
      6. Assert count >= 1
    Expected Result: All 3 key elements present (id, type, createSandbox)
    Failure Indicators: Any grep returns 0
    Evidence: .sisyphus/evidence/task-6-provider-shape.txt

  Scenario: No forbidden patterns in provider
    Tool: Bash
    Preconditions: provider.ts created
    Steps:
      1. Run: grep -c 'as any\|@ts-ignore\|console\.log' workspaces/vercel/src/provider.ts || echo '0'
      2. Assert count is 0
    Expected Result: No forbidden patterns
    Failure Indicators: Any match found
    Evidence: .sisyphus/evidence/task-6-no-forbidden.txt
  ```

  **Commit**: YES (groups with Wave 2 commit)
  - Message: `feat(vercel): implement VercelSandbox adapter with mount support`
  - Files: `workspaces/vercel/src/provider.ts`

 [x] 7. Barrel Exports

  **What to do**:
  - Create `workspaces/vercel/src/index.ts` as the public API barrel file
  - Export the following from their respective modules:
    - `VercelSandbox` (class) and `VercelSandboxOptions` (type) from `./sandbox`
    - `vercelSandboxProvider` from `./provider`
    - `createStdoutBridge`, `createStderrBridge`, `createStreamingBridges` and `StreamingBridgeOptions` (type) from `./sandbox/streaming`
    - `syncFilesToSandbox`, `MountSyncOptions` (type) from `./sandbox/mount-sync`
  - Use `export { ... }` and `export type { ... }` syntax consistently
  - Ensure all exports match what's listed in package.json `exports` field (set up in Task 1)

  **Must NOT do**:
  - Do NOT re-export internal implementation details (private helpers, constants)
  - Do NOT use `export *` — explicit named exports only
  - Do NOT export anything from `@vercel/sandbox` directly — adapter is the public surface

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single file, ~10 lines, pure re-exports
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `react-best-practices`: Not applicable

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2 (but should be last in wave — needs Tasks 2, 3, 4, 5, 6 complete)
  - **Blocks**: Tasks 8, 9, 10 (tests import from this barrel)
  - **Blocked By**: Tasks 2, 3, 4, 5, 6 (all source modules must exist)

  **References** (CRITICAL - Be Exhaustive):

  **Pattern References** (existing code to follow):
  - `workspaces/e2b/src/index.ts` — ENTIRE FILE is the template. 4 lines of explicit named exports. Copy the pattern exactly.

  **API/Type References** (contracts to implement against):
  - `workspaces/vercel/src/sandbox/index.ts` — exports `VercelSandbox` class (Task 5)
  - `workspaces/vercel/src/sandbox/types.ts` — exports `VercelSandboxOptions` type (Task 3)
  - `workspaces/vercel/src/sandbox/streaming.ts` — exports streaming bridge functions and types (Task 2)
  - `workspaces/vercel/src/sandbox/mount-sync.ts` — exports mount sync function and types (Task 4)
  - `workspaces/vercel/src/provider.ts` — exports `vercelSandboxProvider` (Task 6)

  **WHY Each Reference Matters**:
  - E2B index.ts: Shows the exact export pattern — explicit named exports, type keyword for type-only exports
  - Each source module: Need to know exact export names to re-export correctly

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: All expected exports present
    Tool: Bash
    Preconditions: index.ts and all source modules created
    Steps:
      1. Run: grep 'VercelSandbox' workspaces/vercel/src/index.ts
      2. Assert line contains export
      3. Run: grep 'vercelSandboxProvider' workspaces/vercel/src/index.ts
      4. Assert line contains export
      5. Run: grep 'createStreamingBridges' workspaces/vercel/src/index.ts
      6. Assert line contains export
      7. Run: grep 'syncFilesToSandbox' workspaces/vercel/src/index.ts
      8. Assert line contains export
    Expected Result: All 4 key exports present
    Failure Indicators: Any grep returns empty
    Evidence: .sisyphus/evidence/task-7-exports.txt

  Scenario: No wildcard exports used
    Tool: Bash
    Preconditions: index.ts created
    Steps:
      1. Run: grep -c 'export \*' workspaces/vercel/src/index.ts || echo '0'
      2. Assert count is 0
    Expected Result: No `export *` found
    Failure Indicators: Any wildcard export found
    Evidence: .sisyphus/evidence/task-7-no-wildcards.txt
  ```

  **Commit**: YES (groups with Wave 2 commit)
  - Message: `feat(vercel): implement VercelSandbox adapter with mount support`
  - Files: `workspaces/vercel/src/index.ts`

- [ ] 8. TDD Unit Tests — Lifecycle & Constructor

  **What to do**:
  - Create `workspaces/vercel/src/sandbox/index.test.ts`
  - Set up mocking infrastructure following E2B pattern:
    - Use `vi.hoisted()` to define mock objects before `vi.mock()` hoisting
    - Create `mockSandbox` object mimicking Vercel SDK `Sandbox` instance:
      - `sandboxId: 'mock-sandbox-id'`
      - `status: 'running'`
      - `timeout: 300000`
      - `createdAt: new Date()`
      - `runCommand: vi.fn()` — returns `{ exitCode: 0, stdout: '', stderr: '' }`
      - `writeFiles: vi.fn()` — resolves void
      - `readFile: vi.fn()` — resolves null
      - `readFileToBuffer: vi.fn()` — resolves null
      - `stop: vi.fn()` — resolves void
      - `domain: vi.fn()` — returns `'https://test.vercel.run'`
      - `snapshot: vi.fn()` — resolves `{ snapshotId: 'snap-1', status: 'ready' }`
      - `extendTimeout: vi.fn()` — resolves void
      - `updateNetworkPolicy: vi.fn()` — resolves `{}`
    - Create `createMockSandboxApi()` returning `{ Sandbox: { create: vi.fn().mockResolvedValue(mockSandbox), get: vi.fn().mockResolvedValue(mockSandbox) } }`
    - Create `resetMockDefaults()` function to restore all mock implementations between tests
  - Call `vi.mock('@vercel/sandbox', () => createMockSandboxApi())`
  - Write RED tests first (they should fail until Task 5 implementation exists), covering:
    - **Constructor & Options**:
      - Generates unique ID if not provided (matches `/^vercel-sandbox-/` or UUID)
      - Uses provided ID
      - Default timeout is 5 minutes (300_000)
      - Has correct `provider` ('vercel') and `name` ('VercelSandbox')
    - **Start — Sandbox Creation**:
      - Creates new sandbox via `Sandbox.create()`
      - Status transitions: pending → active
      - Passes timeout, teamId, projectId, token to `Sandbox.create()`
      - Reconnects via `Sandbox.get()` when ID matches existing sandbox
    - **Start — Race Conditions** (inherited from MastraSandbox):
      - Concurrent `_start()` calls return same promise
      - `_start()` is idempotent when already running
    - **Stop**:
      - Calls `instance.stop()`
      - Status becomes 'stopped'
      - Sets instance to null
    - **Destroy**:
      - Calls `instance.stop()` (no separate destroy)
      - Status becomes 'destroyed'
    - **getInfo()**:
      - Returns correct `SandboxInfo` shape with id, name, provider, status, createdAt
    - **getInstructions()**:
      - Returns non-empty string mentioning sandbox capabilities
    - **Status mapping**:
      - Vercel 'running' → Mastra 'active'
      - Vercel 'failed' → Mastra 'error'
      - Vercel 'stopped' → Mastra 'stopped'
    - **Auth options**:
      - Forwards token/teamId/projectId to `Sandbox.create()`
      - Falls back to env vars when not provided
  - Use `beforeEach` with `vi.clearAllMocks()` + `resetMockDefaults()`

  **Must NOT do**:
  - Do NOT test command execution or mounts here (that's Task 9)
  - Do NOT use real Vercel SDK calls
  - Do NOT use `as any` for type assertions — define mock types properly

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Complex mock setup, many test cases, follows specific TDD discipline
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `e2e-tests-studio`: This is unit tests, not E2E

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 9, 10, 11, 12)
  - **Blocks**: Task 13 (full build verification)
  - **Blocked By**: Tasks 5, 7 (needs implementation and barrel exports)

  **References** (CRITICAL - Be Exhaustive):

  **Pattern References** (existing code to follow):
  - `workspaces/e2b/src/sandbox/index.test.ts:1-101` — Mock setup pattern. CRITICAL: Copy the `vi.hoisted()` + `vi.mock()` + `resetMockDefaults()` architecture exactly. Adapt mock object shape from E2B's `mockSandbox` to Vercel's API surface.
  - `workspaces/e2b/src/sandbox/index.test.ts:103-237` — Constructor & Start tests. Shows exactly how to test ID generation, provider/name assertions, status transitions, race conditions, and reconnection via mocked SDK.
  - `workspaces/e2b/src/sandbox/index.test.ts:1724-1851` — Self-hosted/auth option forwarding tests. Shows how to verify auth config is passed through to SDK calls.

  **API/Type References** (contracts to implement against):
  - `workspaces/vercel/src/sandbox/index.ts` — `VercelSandbox` class (Task 5) — the class under test
  - `workspaces/vercel/src/sandbox/types.ts` — `VercelSandboxOptions`, `VERCEL_STATUS_MAP` (Task 3)
  - `packages/core/src/workspace/sandbox/types.ts` — `SandboxInfo` shape (what `getInfo()` returns)

  **WHY Each Reference Matters**:
  - E2B test mock setup: The `vi.hoisted()` pattern is essential — without it, mocks aren't available before `vi.mock()` hoisting. Copy this architecture.
  - E2B constructor/start tests: Exact test patterns to adapt — change `Sandbox.betaCreate` → `Sandbox.create`, `Sandbox.connect` → `Sandbox.get`
  - E2B auth tests: Shows the assertion pattern for verifying config passthrough

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Test file exists with proper structure
    Tool: Bash
    Preconditions: index.test.ts created
    Steps:
      1. Run: grep -c 'vi.mock.*@vercel/sandbox' workspaces/vercel/src/sandbox/index.test.ts
      2. Assert count >= 1
      3. Run: grep -c 'vi.hoisted' workspaces/vercel/src/sandbox/index.test.ts
      4. Assert count >= 1
      5. Run: grep -c 'describe.*Constructor' workspaces/vercel/src/sandbox/index.test.ts
      6. Assert count >= 1
    Expected Result: Mock setup and test structure present
    Failure Indicators: Missing vi.mock or vi.hoisted calls
    Evidence: .sisyphus/evidence/task-8-test-structure.txt

  Scenario: Tests run (pass or fail — TDD RED phase is OK)
    Tool: Bash
    Preconditions: index.test.ts created, dependencies installed
    Steps:
      1. Run: cd workspaces/vercel && npx vitest run src/sandbox/index.test.ts --reporter=verbose 2>&1 || true
      2. Capture output — tests may fail (RED phase) if Task 5 isn't complete yet, but they should parse and attempt to run
    Expected Result: Test file is valid vitest, no syntax errors
    Failure Indicators: SyntaxError, import resolution failure, vitest crash
    Evidence: .sisyphus/evidence/task-8-tests-run.txt
  ```

  **Commit**: YES (groups with Wave 3 tests commit)
  - Message: `test(vercel): add TDD unit tests and shared test suite integration`
  - Files: `workspaces/vercel/src/sandbox/index.test.ts`

- [x] 9. TDD Unit Tests — executeCommand, Mounts & Vercel-Specific

  **What to do**:
  - Add to `workspaces/vercel/src/sandbox/index.test.ts` (same file as Task 8)
  - Write RED tests covering:
    - **Command Execution**:
      - Executes command and returns `CommandResult` with correct fields
      - Captures stdout and stderr
      - Returns non-zero exit code for failing commands
      - Respects `cwd` option (passed to `runCommand`)
      - Respects `timeout` option
      - Merges instance env vars with command-level env vars (command-level overrides)
      - Streaming: `onStdout`/`onStderr` callbacks receive data via streaming bridge
      - Shell-quotes arguments correctly
      - Auto-starts sandbox if not running (via `ensureRunning()`)
    - **Mount Operations**:
      - `mount()` walks filesystem and calls `writeFiles()`
      - `mount()` returns `MountResult` with success and file count
      - `unmount()` cleans up mount tracking state
      - Handles empty filesystem (zero files)
    - **Vercel-Specific Features**:
      - `snapshot()` calls `instance.snapshot()` and updates status to 'stopped'
      - `getDomain(port)` calls `instance.domain(port)` and returns URL
      - `extendTimeout(duration)` calls `instance.extendTimeout(duration)`
      - `updateNetworkPolicy(policy)` calls `instance.updateNetworkPolicy(policy)`
    - **Error Handling**:
      - `executeCommand` on stopped sandbox → auto-restarts via ensureRunning
      - SDK error during command → throws `SandboxExecutionError`

  **Must NOT do**:
  - Do NOT create a new test file — append to the file from Task 8
  - Do NOT duplicate the mock setup — reuse from Task 8
  - Do NOT test lifecycle/constructor (already in Task 8)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Complex assertions, mock verification, streaming test setup
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `e2e-tests-studio`: Unit tests, not E2E

  **Parallelization**:
  - **Can Run In Parallel**: YES (but same file as Task 8 — coordinate via sequential within wave)
  - **Parallel Group**: Wave 3 — runs AFTER Task 8 completes (same file)
  - **Blocks**: Task 13 (full build verification)
  - **Blocked By**: Tasks 5, 7, 8 (needs implementation, exports, and lifecycle tests written first)

  **References** (CRITICAL - Be Exhaustive):

  **Pattern References** (existing code to follow):
  - `workspaces/e2b/src/sandbox/index.test.ts:405-481` — Command execution tests. Shows how to mock `commands.run`, test cwd/timeout/env forwarding, assert `CommandResult` shape. Adapt from E2B's `mockSandbox.commands.run` to Vercel's `mockSandbox.runCommand`.
  - `workspaces/e2b/src/sandbox/index.test.ts:487-717` — Mount operation tests. Shows filesystem mocking, marker file tests, mount/unmount assertions. Adapt for file-sync (no FUSE).
  - `workspaces/vercel/src/sandbox/streaming.ts` — Streaming bridge (Task 2). Tests should verify that `onStdout`/`onStderr` callbacks are wired through the bridge to `runCommand`'s `stdout`/`stderr` Writable streams.

  **API/Type References** (contracts to implement against):
  - `packages/core/src/workspace/sandbox/types.ts` — `CommandResult`, `ExecuteCommandOptions` — assert these exact shapes
  - `packages/core/src/workspace/filesystem/mount.ts` — `MountResult` — assert mount returns this shape
  - `packages/core/src/workspace/sandbox/errors.ts` — `SandboxExecutionError`, `SandboxTimeoutError` — assert these are thrown

  **WHY Each Reference Matters**:
  - E2B command tests: Direct adaptation target — same assertion patterns, different mock method names
  - E2B mount tests: Shows how filesystem mocks are constructed and what assertions verify mount success
  - Streaming bridge: Need to verify the bridge is used correctly in executeCommand
  - Error classes: Tests must verify specific error types, not generic Error

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Command execution tests exist
    Tool: Bash
    Preconditions: Tests appended to index.test.ts
    Steps:
      1. Run: grep -c 'Command Execution\|executeCommand' workspaces/vercel/src/sandbox/index.test.ts
      2. Assert count >= 3 (describe + multiple test cases)
    Expected Result: Command execution test section present
    Failure Indicators: Count < 3
    Evidence: .sisyphus/evidence/task-9-command-tests.txt

  Scenario: Vercel-specific feature tests exist
    Tool: Bash
    Preconditions: Tests appended to index.test.ts
    Steps:
      1. Run: grep -c 'snapshot\|getDomain\|extendTimeout\|updateNetworkPolicy' workspaces/vercel/src/sandbox/index.test.ts
      2. Assert count >= 4 (one test per Vercel-specific method)
    Expected Result: All 4 Vercel-specific methods tested
    Failure Indicators: Count < 4
    Evidence: .sisyphus/evidence/task-9-vercel-features.txt

  Scenario: Mount operation tests exist
    Tool: Bash
    Preconditions: Tests appended to index.test.ts
    Steps:
      1. Run: grep -c 'mount\|writeFiles' workspaces/vercel/src/sandbox/index.test.ts
      2. Assert count >= 3
    Expected Result: Mount test section present
    Failure Indicators: Count < 3
    Evidence: .sisyphus/evidence/task-9-mount-tests.txt
  ```

  **Commit**: YES (groups with Wave 3 tests commit)
  - Message: `test(vercel): add TDD unit tests and shared test suite integration`
  - Files: `workspaces/vercel/src/sandbox/index.test.ts`

- [ ] 10. Shared Conformance Test Suite Integration

  **What to do**:
  - Append a new `describe('VercelSandbox Shared Conformance')` block to the end of `workspaces/vercel/src/sandbox/index.test.ts` (after all TDD tests from Tasks 8-9)
  - Import `createSandboxLifecycleTests` and `createMountOperationsTests` from `@internal/workspace-test-utils`
  - Set up `beforeAll` that creates a `VercelSandbox` instance and calls `await sandbox._start()`
  - Set up `afterAll` that calls `await sandbox._destroy()` for cleanup
  - Create a `getContext()` function returning:
    - `sandbox: sandbox as any`
    - `capabilities`: `{ supportsMounting: true, supportsReconnection: false, supportsConcurrency: true, supportsEnvVars: true, supportsWorkingDirectory: true, supportsTimeout: true, defaultCommandTimeout: 5000, supportsStreaming: true }`
    - `testTimeout: 5000`
    - `fastOnly: false`
    - `createSandbox: () => new VercelSandbox()`
  - Call `createSandboxLifecycleTests(getContext)` and `createMountOperationsTests(getContext)` inside the describe block
  - Ensure the Vercel SDK mock (from Tasks 8-9) is compatible with the shared tests — the mock must satisfy all method calls the shared suite exercises

  **Must NOT do**:
  - Don't duplicate tests that the shared suite already covers
  - Don't create a separate test file — append to the existing `index.test.ts`
  - Don't use `SandboxTestConfig` interface directly — follow the E2B pattern of inline `getContext()` returning the config shape

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Small, well-defined task — appending a known pattern to an existing test file
  - **Skills**: []
    - No special skills needed — straightforward TypeScript test code
  - **Skills Evaluated but Omitted**:
    - `e2e-tests-studio`: Not relevant — this is unit test conformance, not Playwright E2E

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 (sequential after Tasks 8-9)
  - **Blocks**: Task 13 (full build verification)
  - **Blocked By**: Tasks 8, 9 (TDD test file must exist first)

  **References** (CRITICAL - Be Exhaustive):

  **Pattern References** (existing code to follow):
  - `workspaces/e2b/src/sandbox/index.test.ts:1854-1889` — EXACT pattern to replicate. Shows `describe('E2BSandbox Shared Conformance')` block with `beforeAll`/`afterAll` setup, `getContext()` function, and calls to `createSandboxLifecycleTests` + `createMountOperationsTests`. Copy this structure, replace `E2BSandbox` with `VercelSandbox`.

  **API/Type References** (contracts to implement against):
  - `workspaces/_test-utils/src/sandbox/types.ts:10-37` — `SandboxTestConfig` interface defines the shape `getContext()` must return: `suiteName`, `createSandbox`, `cleanupSandbox?`, `capabilities?`, `testDomains?`, `testTimeout?`, `fastOnly?`, `createMountableFilesystem?`
  - `workspaces/_test-utils/src/sandbox/types.ts:42-66` — `SandboxCapabilities` interface defines all capability flags and their defaults
  - `workspaces/_test-utils/src/sandbox/index.ts` — Exports `createSandboxLifecycleTests` and `createMountOperationsTests` functions

  **WHY Each Reference Matters**:
  - E2B conformance block: This is the EXACT template — don't deviate from the pattern, just swap class names and adjust capabilities if needed
  - `SandboxTestConfig`: Ensures the `getContext()` return matches what the shared test functions expect
  - `SandboxCapabilities`: Ensures capability flags are set correctly — `supportsReconnection: false` is critical because Vercel SDK doesn't support `Sandbox.get()` for reconnection in the same way

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Shared conformance test block exists
    Tool: Bash
    Preconditions: index.test.ts has Tasks 8-9 content
    Steps:
      1. Run: grep -c 'Shared Conformance' workspaces/vercel/src/sandbox/index.test.ts
      2. Assert count >= 1
      3. Run: grep -c 'createSandboxLifecycleTests\|createMountOperationsTests' workspaces/vercel/src/sandbox/index.test.ts
      4. Assert count >= 2 (both imported and called)
    Expected Result: Shared conformance describe block present with both test suite functions
    Failure Indicators: Grep count < expected
    Evidence: .sisyphus/evidence/task-10-conformance-block.txt

  Scenario: Conformance tests pass with mocked SDK
    Tool: Bash
    Preconditions: All mocks from Tasks 8-9 compatible with shared suite
    Steps:
      1. Run: cd workspaces/vercel && npx vitest run --reporter=verbose 2>&1 | tee /tmp/task-10-results.txt
      2. Assert output contains 'Shared Conformance' test section
      3. Assert exit code 0
    Expected Result: All shared conformance tests pass
    Failure Indicators: Any FAIL in 'Shared Conformance' section, non-zero exit code
    Evidence: .sisyphus/evidence/task-10-conformance-pass.txt
  ```

  **Commit**: YES (groups with Wave 3 tests commit)
  - Message: `test(vercel): add TDD unit tests and shared test suite integration`
  - Files: `workspaces/vercel/src/sandbox/index.test.ts`

- [ ] 11. Reference Documentation Page

  **What to do**:
  - Create `docs/src/content/en/reference/workspace/vercel-sandbox.mdx` following the E2B reference page template
  - Frontmatter: `title: "Reference: VercelSandbox | Workspace"`, `description: "Documentation for the VercelSandbox provider for isolated cloud code execution using Vercel Sandbox SDK."`, `packages: ["@mastra/vercel"]`
  - **Installation** section: `npm install @mastra/vercel`
  - **Usage** section: Show creating a `VercelSandbox` with a `Workspace` and assigning to an `Agent`. Include Vercel auth options (`token`, `teamId`, `projectId`, or `VERCEL_TOKEN` / `VERCEL_TEAM_ID` / `VERCEL_PROJECT_ID` env vars)
  - **Constructor parameters** with `<PropertiesTable>`: `token` (string, optional — falls back to VERCEL_TOKEN), `teamId` (string, optional — falls back to VERCEL_TEAM_ID), `projectId` (string, optional — falls back to VERCEL_PROJECT_ID), `timeout` (number, optional — default 300000), `env` (Record<string, string>, optional), `id` (string, optional — auto-generated), `workingDirectory` (string, optional — default `/vercel/sandbox`)
  - **Properties** with `<PropertiesTable>`: `id`, `name` ('VercelSandbox'), `provider` ('vercel'), `status`, `supportsMounting`
  - **Methods** section: `start()`, `stop()`, `destroy()`, `executeCommand(command, args?, options?)`, `mount(filesystem, mountPath)`, `unmount(mountPath)`, `getInfo()`
  - **Vercel-Specific Methods** section:
    - `snapshot(options?)` — Create a snapshot of the sandbox. **Note**: The sandbox is automatically stopped after snapshot creation. Parameters: `expiration` (number, optional)
    - `getDomain(port)` — Get a public URL for a port. Returns `https://<subdomain>.vercel.run`
    - `extendTimeout(duration)` — Extend the sandbox timeout by `duration` milliseconds
    - `updateNetworkPolicy(policy)` — Update network access policy for the sandbox
  - **Authentication** section: Explain OIDC (automatic on Vercel platform) vs explicit token auth, with code example for each
  - **File Sync Mounting** section: Explain that Vercel uses `writeFiles()` for mounting (not FUSE). Show example with any `WorkspaceFilesystem` subclass
  - **Related** links at bottom: WorkspaceSandbox interface, LocalSandbox, E2BSandbox, Workspace overview
  - Keep overall line count similar to E2B page (~350-400 lines). Omit E2B-specific sections (Custom Templates, FUSE mounting) and replace with Vercel-specific sections (Snapshots, Network Policy, Public Domains)

  **Must NOT do**:
  - Don't copy E2B-specific content (FUSE mounting, template builder, s3fs/gcsfuse)
  - Don't document features the Vercel SDK doesn't support (reconnection, custom templates)
  - Don't use placeholder text — all code examples must be runnable
  - Don't add the sidebar entry (that's Task 12)

  **Recommended Agent Profile**:
  - **Category**: `writing`
    - Reason: Documentation creation task — primarily prose and MDX markup
  - **Skills**: [`mastra-docs`]
    - `mastra-docs`: Needed to follow Mastra's documentation conventions, MDX components (`PropertiesTable`, info boxes), frontmatter format, and reference page structure
  - **Skills Evaluated but Omitted**:
    - `tailwind-best-practices`: Not relevant — docs page, not UI component
    - `react-best-practices`: Not relevant — MDX documentation, not React app code

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 8-10 tests)
  - **Blocks**: Task 12 (sidebar entry), Task 13 (full verification)
  - **Blocked By**: Tasks 5, 6 (need to know final class API to document)

  **References** (CRITICAL - Be Exhaustive):

  **Pattern References** (existing code to follow):
  - `docs/src/content/en/reference/workspace/e2b-sandbox.mdx` — FULL template to follow (390 lines). Copy the overall structure: frontmatter → Installation → Usage → Constructor parameters (PropertiesTable) → Properties (PropertiesTable) → Methods → Provider-specific sections → Related links. Replace E2B content with Vercel equivalents.
  - `docs/src/content/en/reference/workspace/local-sandbox.mdx` — Secondary reference for simpler sandbox docs (useful for understanding minimal viable structure)

  **API/Type References** (contracts to document):
  - `workspaces/vercel/src/sandbox/types.ts` — `VercelSandboxOptions` (Task 3) defines all constructor parameters to document
  - `workspaces/vercel/src/sandbox/index.ts` — `VercelSandbox` class (Task 5) defines all methods and properties to document
  - `packages/core/src/workspace/sandbox/types.ts` — `CommandResult`, `ExecuteCommandOptions` — shared types referenced in method docs

  **External References**:
  - Vercel Sandbox SDK docs: `https://vercel.com/docs/vercel-sandbox-sdk` — Source of truth for Vercel-specific features (snapshots, domains, network policies)
  - `docs/AGENTS.md` — Documentation contribution guidelines (frontmatter format, MDX components)
  - `docs/styleguides/REFERENCE.md` — Reference page styleguide

  **WHY Each Reference Matters**:
  - E2B reference page: The PRIMARY template — provides exact structure, PropertiesTable format, method documentation patterns, and Related links format
  - `VercelSandboxOptions`: Source of truth for constructor parameter names, types, and defaults to document
  - `VercelSandbox` class: Source of truth for method signatures and public API surface
  - Vercel docs: Needed for accurate descriptions of Vercel-specific features (snapshot behavior, domain format, network policy structure)

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Reference page file exists with correct frontmatter
    Tool: Bash
    Preconditions: File created
    Steps:
      1. Run: head -10 docs/src/content/en/reference/workspace/vercel-sandbox.mdx
      2. Assert output contains 'title: "Reference: VercelSandbox | Workspace"'
      3. Assert output contains 'packages:' and '@mastra/vercel'
    Expected Result: Frontmatter matches expected format
    Failure Indicators: Missing or incorrect frontmatter fields
    Evidence: .sisyphus/evidence/task-11-frontmatter.txt

  Scenario: All required sections present
    Tool: Bash
    Preconditions: File created
    Steps:
      1. Run: grep -c '## Installation\|## Usage\|## Constructor parameters\|## Properties\|## Methods\|## Vercel-Specific\|## Authentication\|## Related' docs/src/content/en/reference/workspace/vercel-sandbox.mdx
      2. Assert count >= 7 (all major sections)
    Expected Result: All required documentation sections exist
    Failure Indicators: Count < 7
    Evidence: .sisyphus/evidence/task-11-sections.txt

  Scenario: PropertiesTable components used correctly
    Tool: Bash
    Preconditions: File created
    Steps:
      1. Run: grep -c 'PropertiesTable' docs/src/content/en/reference/workspace/vercel-sandbox.mdx
      2. Assert count >= 3 (constructor params, properties, executeCommand options)
    Expected Result: PropertiesTable used for structured parameter docs
    Failure Indicators: Count < 3
    Evidence: .sisyphus/evidence/task-11-properties-tables.txt

  Scenario: No E2B-specific content leaked
    Tool: Bash
    Preconditions: File created
    Steps:
      1. Run: grep -ci 'e2b\|s3fs\|gcsfuse\|FUSE\|TemplateBuilder' docs/src/content/en/reference/workspace/vercel-sandbox.mdx
      2. Assert count = 0 (or only in Related links to E2BSandbox)
    Expected Result: No E2B-specific terminology in Vercel docs (except Related links)
    Failure Indicators: E2B terms found outside Related section
    Evidence: .sisyphus/evidence/task-11-no-e2b-leak.txt
  ```

  **Commit**: YES (groups with Wave 3 docs commit)
  - Message: `docs(vercel): add VercelSandbox reference page`
  - Files: `docs/src/content/en/reference/workspace/vercel-sandbox.mdx`

- [ ] 12. Docs Sidebar Entry

  **What to do**:
  - Edit `docs/src/content/en/reference/sidebars.js`
  - Add `{ type: 'doc', id: 'workspace/vercel-sandbox', label: 'VercelSandbox' }` after the E2BSandbox entry (currently at line 677)
  - The new entry should appear between `{ type: 'doc', id: 'workspace/e2b-sandbox', label: 'E2BSandbox' }` and `{ type: 'doc', id: 'workspace/filesystem', label: 'WorkspaceFilesystem' }`
  - This is a single-line insertion

  **Must NOT do**:
  - Don't modify any other sidebar entries
  - Don't change the ordering of existing entries
  - Don't add tags or customProps (no `new` tag — this is a fork-specific feature)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single-line insertion in a config file — trivial task
  - **Skills**: []
    - No special skills needed
  - **Skills Evaluated but Omitted**:
    - `mastra-docs`: Overkill for a single sidebar line

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Task 11 docs page)
  - **Blocks**: Task 13 (full verification)
  - **Blocked By**: None (can start immediately, but logically pairs with Task 11)

  **References** (CRITICAL - Be Exhaustive):

  **Pattern References** (existing code to follow):
  - `docs/src/content/en/reference/sidebars.js:676-683` — Shows the exact insertion point. Line 677 is E2BSandbox entry, line 678-682 is WorkspaceFilesystem entry. Insert the new entry on a new line between 677 and 678.

  **WHY Each Reference Matters**:
  - Sidebar file: Only reference needed — shows exact syntax, indentation, and position for the new entry

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Sidebar entry exists in correct position
    Tool: Bash
    Preconditions: sidebars.js edited
    Steps:
      1. Run: grep -n 'vercel-sandbox' docs/src/content/en/reference/sidebars.js
      2. Assert output contains "workspace/vercel-sandbox"
      3. Run: grep -A2 'e2b-sandbox' docs/src/content/en/reference/sidebars.js
      4. Assert 'vercel-sandbox' appears within 2 lines after 'e2b-sandbox'
    Expected Result: VercelSandbox entry appears immediately after E2BSandbox entry
    Failure Indicators: Entry missing or in wrong position
    Evidence: .sisyphus/evidence/task-12-sidebar-entry.txt

  Scenario: No other sidebar entries modified
    Tool: Bash
    Preconditions: sidebars.js edited
    Steps:
      1. Run: git diff docs/src/content/en/reference/sidebars.js
      2. Assert only 1 line added (the vercel-sandbox entry)
      3. Assert no lines removed or modified
    Expected Result: Minimal change — exactly 1 line insertion
    Failure Indicators: More than 1 line changed, or existing entries modified
    Evidence: .sisyphus/evidence/task-12-minimal-diff.txt
  ```

  **Commit**: YES (groups with Wave 3 docs commit)
  - Message: `docs(vercel): add VercelSandbox reference page`
  - Files: `docs/src/content/en/reference/sidebars.js`

- [ ] 13. Full Build & Type-Check Verification

  **What to do**:
  - Run `pnpm install` from the monorepo root to register the new `@mastra/vercel` package
  - Run `pnpm build --filter=@mastra/vercel` and verify it succeeds with `dist/` output
  - Run `pnpm typecheck --filter=@mastra/vercel` and verify zero type errors
  - Run `pnpm test:unit --filter=@mastra/vercel` (or `cd workspaces/vercel && npx vitest run`) and verify all tests pass
  - If any step fails, diagnose and fix the issue (likely missing dependency, import path, or tsconfig misconfiguration)
  - Verify `dist/index.mjs` and `dist/index.cjs` both exist (ESM + CJS dual output from tsup)
  - Verify the package exports resolve correctly: `node -e "require('@mastra/vercel')"` (CJS) and `node --input-type=module -e "import('@mastra/vercel').then(m => console.log(Object.keys(m)))"` (ESM)

  **Must NOT do**:
  - Don't modify source code unless fixing a genuine build/type error discovered during verification
  - Don't skip any verification step
  - Don't suppress warnings with `@ts-ignore` or `as any`

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Running commands and checking output — no code creation
  - **Skills**: []
    - No special skills needed — standard CLI verification
  - **Skills Evaluated but Omitted**:
    - `smoke-test`: Not relevant — smoke-test is for create-mastra projects, not package builds

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 4 (after all implementation + test + docs tasks)
  - **Blocks**: Final Verification Wave (F1-F4)
  - **Blocked By**: All Tasks 1-12

  **References** (CRITICAL - Be Exhaustive):

  **Pattern References** (existing code to follow):
  - `workspaces/e2b/package.json` — Reference for correct package.json structure (`exports` field, `main`/`module`/`types` fields, build scripts)
  - `workspaces/e2b/tsup.config.ts` — Reference for tsup build configuration that produces dual ESM+CJS output
  - Root `package.json` — Verify workspace glob includes `workspaces/*` so `@mastra/vercel` is discoverable

  **WHY Each Reference Matters**:
  - E2B package.json: If build fails, compare against this known-working config to diagnose issues
  - tsup config: If dist output is wrong format, compare tsup settings
  - Root package.json: If `pnpm install` doesn't find the new package, check workspace config

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Package installs and builds successfully
    Tool: Bash
    Preconditions: All Tasks 1-12 complete
    Steps:
      1. Run: pnpm install 2>&1 | tail -5
      2. Assert no errors
      3. Run: pnpm build --filter=@mastra/vercel 2>&1 | tail -10
      4. Assert output contains success indicator (no errors)
      5. Run: ls workspaces/vercel/dist/
      6. Assert output contains 'index.mjs' and 'index.cjs'
    Expected Result: Build succeeds with dual ESM+CJS output
    Failure Indicators: Build errors, missing dist files
    Evidence: .sisyphus/evidence/task-13-build.txt

  Scenario: TypeScript type-checking passes
    Tool: Bash
    Preconditions: Package built
    Steps:
      1. Run: pnpm typecheck --filter=@mastra/vercel 2>&1
      2. Assert exit code 0
      3. Assert no 'error TS' in output
    Expected Result: Zero type errors
    Failure Indicators: Non-zero exit code, 'error TS' lines in output
    Evidence: .sisyphus/evidence/task-13-typecheck.txt

  Scenario: All unit tests pass
    Tool: Bash
    Preconditions: Package built, tests from Tasks 8-10 present
    Steps:
      1. Run: cd workspaces/vercel && npx vitest run --reporter=verbose 2>&1 | tee /tmp/task-13-tests.txt
      2. Assert exit code 0
      3. Assert output shows all test suites passing
      4. Assert no FAIL lines
    Expected Result: All tests pass (lifecycle, commands, mounts, Vercel-specific, shared conformance)
    Failure Indicators: Non-zero exit, any FAIL in output
    Evidence: .sisyphus/evidence/task-13-tests.txt

  Scenario: Package exports resolve correctly
    Tool: Bash
    Preconditions: Package built
    Steps:
      1. Run: node -e "const m = require('./workspaces/vercel/dist/index.cjs'); console.log(Object.keys(m))"
      2. Assert output contains 'VercelSandbox' and 'vercelSandboxProvider'
      3. Run: node --input-type=module -e "import('./workspaces/vercel/dist/index.mjs').then(m => console.log(Object.keys(m)))"
      4. Assert output contains 'VercelSandbox' and 'vercelSandboxProvider'
    Expected Result: Both CJS and ESM exports include VercelSandbox and vercelSandboxProvider
    Failure Indicators: Import errors, missing exports
    Evidence: .sisyphus/evidence/task-13-exports.txt
  ```

  **Commit**: NO (verification only — no new files)

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Rejection → fix → re-run.

- [ ] F1. **Plan Compliance Audit** — `oracle`
      Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in `.sisyphus/evidence/`. Compare deliverables against plan.
      Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
      Run `tsc --noEmit` + linter + `pnpm test:unit`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names (data/result/item/temp).
      Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high`
      Start from clean state. Execute EVERY QA scenario from EVERY task — follow exact steps, capture evidence. Test cross-task integration (imports, exports, types flowing correctly). Save to `.sisyphus/evidence/final-qa/`.
      Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
      For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance. Detect cross-task contamination: Task N touching Task M's files. Flag unaccounted changes.
      Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **Wave 1**: `feat(vercel): scaffold @mastra/vercel package with types and streaming utils` — package.json, tsup.config.ts, tsconfig.json, src/sandbox/types.ts, src/sandbox/streaming.ts
- **Wave 2**: `feat(vercel): implement VercelSandbox adapter with mount support` — src/sandbox/index.ts, src/sandbox/mount-sync.ts, src/provider.ts, src/index.ts
- **Wave 3 (tests)**: `test(vercel): add TDD unit tests and shared test suite integration` — src/sandbox/index.test.ts
- **Wave 3 (docs)**: `docs(vercel): add VercelSandbox reference page` — docs files
- **Wave 4**: No commit (verification only)

---

## Success Criteria

### Verification Commands

```bash
pnpm build --filter=@mastra/vercel  # Expected: Build succeeds, dist/ created
pnpm test:unit --filter=@mastra/vercel  # Expected: All tests pass
pnpm typecheck --filter=@mastra/vercel  # Expected: No type errors
```

### Final Checklist

- [ ] All "Must Have" present — extends MastraSandbox, all interface methods implemented
- [ ] All "Must NOT Have" absent — no FUSE, no templates, no `as any`, no console.log
- [ ] All tests pass — unit tests with mocked SDK
- [ ] Package exports work — ESM and CJS
- [ ] Docs reference page renders correctly
- [ ] Provider descriptor works for MastraEditor
