## [2026-02-23T18:30:41Z] Pre-Wave-1 Verification

### ✅ Vercel SDK v1.6.0 API Verified (Librarian)
- All plan assumptions confirmed against source code
- `snapshot()` auto-stops sandbox (critical for Task 5)
- `RunCommandParams` uses Node.js `stream.Writable` (not SDK type)
- Auth: OIDC preferred, explicit token fallback
- Status type: string union `'pending' | 'running' | 'stopping' | 'stopped' | 'failed'`
- Default timeout: 5 minutes (300_000ms)
- Memory: Cannot set independently — fixed at 2048MB per vCPU

### ✅ Monorepo Patterns Verified (Direct Tools)
- E2B package.json template: `workspaces/e2b/package.json` (70 lines)
- Exports structure: ESM + CJS with types
- Dependencies: Use `workspace:*` for internal, `catalog:` for vitest/coverage
- Peer dependency: `"@mastra/core": ">=1.3.0-0 <2.0.0-0"`
- Scripts: `build`, `build:lib`, `build:watch`, `test:unit`, `test:watch`, `lint`
- Engines: `"node": ">=22.13.0"`

### ✅ MastraSandbox Base Class Verified
- Source: `packages/core/src/workspace/sandbox/mastra-sandbox.ts`
- Constructor auto-creates `MountManager` if `mount()` is implemented (lines 132-138)
- Use `declare readonly mounts: MountManager` for non-optional typing
- Lifecycle wrappers: `_start()`, `_stop()`, `_destroy()` (race-safe)
- Subclasses override plain `start()`, `stop()`, `destroy()`
- `ensureRunning()` for lazy init
- Lifecycle hooks: `onStart`, `onStop`, `onDestroy` in constructor options

### ✅ SandboxProvider Type Verified
- Source: `packages/core/src/editor/types.ts:88-99`
- Interface:
  ```typescript
  export interface SandboxProvider<TConfig = Record<string, unknown>> {
    id: string;
    name: string;
    description?: string;
    configSchema?: Record<string, unknown>;
    createSandbox(config: TConfig): WorkspaceSandbox | Promise<WorkspaceSandbox>;
  }
  ```
- E2B example: `workspaces/e2b/src/provider.ts:31-57`

### ✅ Package Scaffold Pattern
- Copy structure from E2B package.json
- Change: `name` → `@mastra/vercel`, `description`, `dependencies` → `@vercel/sandbox: ^1.6.0`
- Remove: E2B-specific fields (template, S3/GCS mount types)
- Keep: All exports, scripts, peer deps, engines, repository structure

### Critical Implementation Notes
1. **Streaming bridge must use Node.js stream**: `import { Writable } from "stream";` NOT from SDK
2. **snapshot() stops sandbox**: Do NOT call `stop()` after `snapshot()`
3. **Domain requires pre-registration**: Must pass `ports: [3000]` to `create()` before calling `domain(3000)`
4. **Reconnection via Sandbox.get()**: `create()` does NOT accept `sandboxId` param
5. **OIDC token lifespan**: 12 hours local, auto-refresh on Vercel platform

### Files Verified as Existing
- `workspaces/e2b/package.json` ✅
- `workspaces/e2b/tsup.config.ts` ✅
- `workspaces/e2b/tsconfig.json` ✅
- `workspaces/e2b/src/provider.ts` ✅
- `packages/core/src/workspace/sandbox/mastra-sandbox.ts` ✅
- `packages/core/src/workspace/sandbox/types.ts` ✅
- `packages/core/src/editor/types.ts` (SandboxProvider) ✅

### Ready for Wave 1 Execution
- All file references in Tasks 1-3 verified
- All type imports confirmed correct
- All patterns match E2B adapter
- No blocking discrepancies found

## [2026-02-23T13:39:15Z] Task 1: Package Scaffold Creation ✅

### Created Files
- `workspaces/vercel/package.json` (68 lines, ESM-first)
- `workspaces/vercel/tsup.config.ts` (18 lines, externals: @mastra/core + @vercel/sandbox)
- `workspaces/vercel/tsconfig.json` (5 lines, extends ../../tsconfig.node.json)
- `workspaces/vercel/src/index.ts` (placeholder: barrel exports comment)

### Package.json Structure
- Name: `@mastra/vercel` ✅
- Version: `0.0.1` ✅
- Description: `Vercel Sandbox provider for Mastra workspaces` ✅
- Type: `module` (ESM) ✅
- Exports: ESM + CJS with types ✅
- Main/Types: dist/index.js + dist/index.d.ts ✅
- Dependencies: `@vercel/sandbox: ^1.6.0` ✅
- DevDependencies: workspace:* (internal) + catalog: (shared) ✅
- PeerDependencies: `@mastra/core: >=1.3.0-0 <2.0.0-0` ✅
- Engines: `node: >=22.13.0` ✅
- Repository.directory: `workspaces/vercel` ✅

### tsup.config.ts Details
- Entry: `src/index.ts` ✅
- Formats: ESM + CJS ✅
- Externals: `['@mastra/core', '@vercel/sandbox']` ✅
- onSuccess: calls `generateTypes()` from @internal/types-builder ✅
- Clean + treeshake: enabled ✅

### QA Results
- package.json valid JSON ✅
- Name field: "@mastra/vercel" ✅
- Peer dep: ">=1.3.0-0 <2.0.0-0" ✅
- Dependency: "@vercel/sandbox: ^1.6.0" ✅
- Both externals found in tsup.config.ts ✅

### Ready for Task 2
- All scaffold files in place
- Structure matches E2B adapter pattern
- No pnpm install run (deferred to Task 13)

## [2026-02-23T18:42:30Z] Task 2: Streaming Bridge Utility ✅

### Created Files
- `workspaces/vercel/src/sandbox/streaming.ts` (32 lines)

### Implementation Details
- Exports `StreamingCallbacks` interface with optional `onStdout` and `onStderr` callbacks
- Exports `StreamingBridge` interface with optional `stdout` and `stderr` Writable streams
- `createStreamingBridge()` function:
  - Takes `StreamingCallbacks` input
  - Returns `StreamingBridge` with Node.js `stream.Writable` instances
  - Converts both `Buffer` and `string` chunks to strings before passing to callbacks
  - Returns empty bridge object `{}` when no callbacks provided
  - Properly implements Writable contract: calls `callback()` after processing each chunk

### QA Results
- Scenario 1: Chunk conversion ✅ `.sisyphus/evidence/task-2-streaming-bridge.txt`
  - String chunks: `'hello'` → callback received `'hello'` ✅
  - Buffer chunks: `Buffer.from(' world')` → callback received `' world'` ✅
  - Both chunk types handled correctly
  
- Scenario 2: Empty callbacks ✅ `.sisyphus/evidence/task-2-streaming-no-callbacks.txt`
  - No callbacks → `{"hasStdout":false,"hasStderr":false}` ✅
  - Bridges not created unnecessarily

### Implementation Notes
1. **Node.js stream import**: Used `import { Writable } from 'node:stream'` (modern node: prefix)
2. **Type safety**: Full TypeScript compliance, no implicit any types
3. **Async callback contract**: Each write() call properly invokes callback() to signal completion
4. **No buffering**: Straightforward pass-through to callbacks (synchronous operation)
5. **Defensive chunk handling**: `Buffer.isBuffer()` check handles both data types at write time

### Pattern Consistency
- Follows E2B adapter precedent (though E2B doesn't have streaming bridge)
- Matches Mastra's callback signature from `ExecuteCommandOptions` exactly
- Compatible with Vercel SDK's `RunCommandParams` stream expectations
- Ready for Task 5 (VercelSandbox class will use this bridge)

## [2026-02-23T18:45:22Z] Task 3: Types & Options Interface ✅

### Created Files
- `workspaces/vercel/src/sandbox/types.ts` (35 lines, pure type definitions)

### Interface: VercelSandboxOptions
- Extends `MastraSandboxOptions` from @mastra/core/workspace ✓
- All 8 fields with JSDoc documentation:
  1. `id?: string` - Sandbox instance identifier
  2. `timeout?: number` - Execution timeout (default 5 minutes)
  3. `env?: Record<string, string>` - Environment variables
  4. `token?: string` - Vercel API token (VERCEL_TOKEN env fallback)
  5. `teamId?: string` - Vercel team ID (VERCEL_TEAM_ID env fallback)
  6. `projectId?: string` - Vercel project ID (VERCEL_PROJECT_ID env fallback)
  7. `memory?: number` - Sandbox memory in MB
  8. `cpus?: number` - Number of vCPUs

### Constants Defined
- `VERCEL_STATUS_MAP`: Maps all 5 Vercel statuses to Mastra ProviderStatus
  - `pending` → `pending` (pass-through)
  - `running` → `active` (semantic mapping)
  - `stopping` → `stopping` (pass-through)
  - `stopped` → `stopped` (pass-through)
  - `failed` → `error` (semantic mapping)
- `LOG_PREFIX`: `'[Vercel]'` for logging

### QA Results
- TypeScript compilation: ✅ No errors (evidence: `.sisyphus/evidence/task-3-types-compile.txt`)
- Status map coverage: ✅ 5/5 Vercel statuses (evidence: `.sisyphus/evidence/task-3-status-map.txt`)

### Type Safety Notes
- Both imports from `@mastra/core/workspace` resolve correctly
- ProviderStatus is the canonical type for status mapping (prevents invalid status strings)
- JSDoc comments serve IDE intellisense for developers using VercelSandboxOptions
- No imports from `@vercel/sandbox` in types file (keeps type definitions clean)

### Ready for Task 4 & 5
- Type definitions complete and verified
- All constants (VERCEL_STATUS_MAP, LOG_PREFIX) available for Task 5 (VercelSandbox class)
- No blocking issues found
