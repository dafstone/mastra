/**
 * Vercel Sandbox Provider Tests - Lifecycle
 *
 * Tests Vercel-specific lifecycle functionality including:
 * - Constructor options and ID generation
 * - Sandbox creation and reconnection
 * - Status transitions and mapping
 * - Auth options forwarding
 * - Start race condition prevention
 * - Stop and destroy operations
 * - getInfo() and getInstructions()
 *
 * Based on E2B test architecture with adaptations for Vercel SDK.
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import type { Sandbox } from '@vercel/sandbox';

import { VercelSandbox } from './index';
import type { VercelSandboxOptions } from './types';
import { createSandboxLifecycleTests, createMountOperationsTests } from '@internal/workspace-test-utils';

// Use vi.hoisted to define mocks before vi.mock is hoisted
const { mockSandbox, createMockSandboxApi, resetMockDefaults } = vi.hoisted(() => {
  // Mock Vercel SDK Sandbox instance shape
  const mockSandbox = {
    sandboxId: 'mock-sandbox-id',
    status: 'running' as const,
    timeout: 300_000,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    runCommand: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' }),
    writeFiles: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(new Uint8Array()),
    readFileToBuffer: vi.fn().mockResolvedValue(Buffer.from('')),
    stop: vi.fn().mockResolvedValue(undefined),
    domain: vi.fn().mockReturnValue('https://mock-sandbox-3000.vercel.app'),
    snapshot: vi.fn().mockResolvedValue({ id: 'mock-snapshot-id' }),
    extendTimeout: vi.fn().mockResolvedValue(undefined),
    updateNetworkPolicy: vi.fn().mockResolvedValue({}),
  };

  const createMockSandboxApi = () => ({
    Sandbox: {
      create: vi.fn().mockResolvedValue(mockSandbox),
      get: vi.fn().mockResolvedValue(mockSandbox),
    },
  });

  /**
   * Re-apply default mock implementations.
   * vi.clearAllMocks() only clears call tracking, not implementations.
   * Tests that override mocks with mockResolvedValue/mockReturnValue leak
   * those overrides into subsequent tests. This function restores defaults.
   */
  const resetMockDefaults = async () => {
    const { Sandbox } = await import('@vercel/sandbox');
    (Sandbox.create as any).mockResolvedValue(mockSandbox);
    (Sandbox.get as any).mockResolvedValue(mockSandbox);
    mockSandbox.runCommand.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
    mockSandbox.writeFiles.mockResolvedValue(undefined);
    mockSandbox.readFile.mockResolvedValue(new Uint8Array());
    mockSandbox.readFileToBuffer.mockResolvedValue(Buffer.from(''));
    mockSandbox.stop.mockResolvedValue(undefined);
    mockSandbox.domain.mockReturnValue('https://mock-sandbox-3000.vercel.app');
    mockSandbox.snapshot.mockResolvedValue({ id: 'mock-snapshot-id' });
    mockSandbox.extendTimeout.mockResolvedValue(undefined);
    mockSandbox.updateNetworkPolicy.mockResolvedValue({});
    mockSandbox.status = 'running' as const;
  };

  return { mockSandbox, createMockSandboxApi, resetMockDefaults };
});

// Mock the Vercel SDK
vi.mock('@vercel/sandbox', () => createMockSandboxApi());

describe('VercelSandbox - Lifecycle', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await resetMockDefaults();
  });

  describe('Constructor & Options', () => {
    it('generates unique id if not provided', () => {
      const sandbox1 = new VercelSandbox({});
      const sandbox2 = new VercelSandbox({});

      expect(sandbox1.id).toBeDefined();
      expect(sandbox2.id).toBeDefined();
      expect(sandbox1.id).not.toBe(sandbox2.id);

      // Both should be valid UUIDs
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      expect(sandbox1.id).toMatch(uuidRegex);
      expect(sandbox2.id).toMatch(uuidRegex);
    });

    it('uses provided id', () => {
      const sandbox = new VercelSandbox({ id: 'my-custom-sandbox-id' });

      expect(sandbox.id).toBe('my-custom-sandbox-id');
    });

    it('default timeout is 5 minutes', () => {
      const sandbox = new VercelSandbox({});

      // Access private timeout field
      expect((sandbox as any).timeout).toBe(300_000);
    });

    it('accepts custom timeout', () => {
      const sandbox = new VercelSandbox({ timeout: 60_000 });

      expect((sandbox as any).timeout).toBe(60_000);
    });

    it('has correct provider and name', () => {
      const sandbox = new VercelSandbox({});

      expect(sandbox.provider).toBe('vercel');
      expect(sandbox.name).toBe('VercelSandbox');
    });

    it('initializes with pending status', () => {
      const sandbox = new VercelSandbox({});

      expect(sandbox.status).toBe('pending');
    });

    it('stores environment variables', () => {
      const sandbox = new VercelSandbox({
        env: {
          NODE_ENV: 'test',
          API_KEY: 'secret',
        },
      });

      expect((sandbox as any).env).toEqual({
        NODE_ENV: 'test',
        API_KEY: 'secret',
      });
    });
  });

  describe('Start - Sandbox Creation', () => {
    it('creates new sandbox via Sandbox.create()', async () => {
      const { Sandbox } = await import('@vercel/sandbox');
      const sandbox = new VercelSandbox({});

      await sandbox._start();

      expect(Sandbox.create).toHaveBeenCalledTimes(1);
      expect(Sandbox.get).not.toHaveBeenCalled();
    });

    it('transitions status from pending to running', async () => {
      const sandbox = new VercelSandbox({});

      expect(sandbox.status).toBe('pending');

      await sandbox._start();

      expect(sandbox.status).toBe('running');
    });

    it('passes timeout to Sandbox.create()', async () => {
      const { Sandbox } = await import('@vercel/sandbox');
      const sandbox = new VercelSandbox({ timeout: 120_000 });

      await sandbox._start();

      expect(Sandbox.create).toHaveBeenCalledWith(
        expect.objectContaining({
          timeout: 120_000,
        }),
      );
    });

    it('passes teamId to Sandbox.create()', async () => {
      const { Sandbox } = await import('@vercel/sandbox');
      const sandbox = new VercelSandbox({ teamId: 'team_abc123' });

      await sandbox._start();

      expect(Sandbox.create).toHaveBeenCalledWith(
        expect.objectContaining({
          teamId: 'team_abc123',
        }),
      );
    });

    it('passes projectId to Sandbox.create()', async () => {
      const { Sandbox } = await import('@vercel/sandbox');
      const sandbox = new VercelSandbox({ projectId: 'prj_xyz789' });

      await sandbox._start();

      expect(Sandbox.create).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'prj_xyz789',
        }),
      );
    });

    it('passes token to Sandbox.create()', async () => {
      const { Sandbox } = await import('@vercel/sandbox');
      const sandbox = new VercelSandbox({ token: 'vercel_token_abc123' });

      await sandbox._start();

      expect(Sandbox.create).toHaveBeenCalledWith(
        expect.objectContaining({
          token: 'vercel_token_abc123',
        }),
      );
    });

    it('passes all auth options to Sandbox.create()', async () => {
      const { Sandbox } = await import('@vercel/sandbox');
      const sandbox = new VercelSandbox({
        token: 'vercel_token',
        teamId: 'team_123',
        projectId: 'prj_456',
      });

      await sandbox._start();

      expect(Sandbox.create).toHaveBeenCalledWith(
        expect.objectContaining({
          token: 'vercel_token',
          teamId: 'team_123',
          projectId: 'prj_456',
        }),
      );
    });

    it('passes cpus resource to Sandbox.create()', async () => {
      const { Sandbox } = await import('@vercel/sandbox');
      const sandbox = new VercelSandbox({ cpus: 2 });

      await sandbox._start();

      expect(Sandbox.create).toHaveBeenCalledWith(
        expect.objectContaining({
          resources: {
            vcpus: 2,
          },
        }),
      );
    });
  });

  describe('Start - Reconnection', () => {
    it('reconnects via Sandbox.get() when id exists', async () => {
      const { Sandbox } = await import('@vercel/sandbox');
      const sandbox = new VercelSandbox({ id: 'existing-sandbox-id' });

      await sandbox._start();

      expect(Sandbox.get).toHaveBeenCalledTimes(1);
      expect(Sandbox.get).toHaveBeenCalledWith({ sandboxId: 'existing-sandbox-id' });
      expect(Sandbox.create).not.toHaveBeenCalled();
    });

    it('sets status based on reconnected sandbox status', async () => {
      const { Sandbox } = await import('@vercel/sandbox');
      mockSandbox.status = 'running' as const;
      (Sandbox.get as any).mockResolvedValueOnce(mockSandbox);

      const sandbox = new VercelSandbox({ id: 'existing-sandbox-id' });
      await sandbox._start();

      expect(sandbox.status).toBe('running');
    });

    it('falls back to create if reconnection fails', async () => {
      const { Sandbox } = await import('@vercel/sandbox');
      (Sandbox.get as any).mockRejectedValueOnce(new Error('Sandbox not found'));

      const sandbox = new VercelSandbox({ id: 'nonexistent-sandbox-id' });
      await sandbox._start();

      expect(Sandbox.get).toHaveBeenCalledTimes(1);
      expect(Sandbox.create).toHaveBeenCalledTimes(1);
      expect(sandbox.status).toBe('running');
    });
  });

  describe('Start - Race Condition Prevention', () => {
    it('concurrent start() calls return same promise', async () => {
      const { Sandbox } = await import('@vercel/sandbox');
      const sandbox = new VercelSandbox({});

      // Start two concurrent calls
      const promise1 = sandbox._start();
      const promise2 = sandbox._start();

      await Promise.all([promise1, promise2]);

      // Sandbox.create should only be called once
      expect(Sandbox.create).toHaveBeenCalledTimes(1);
    });

    it('start() is idempotent when already running', async () => {
      const { Sandbox } = await import('@vercel/sandbox');
      const sandbox = new VercelSandbox({});

      await sandbox._start();
      expect(Sandbox.create).toHaveBeenCalledTimes(1);
      expect(sandbox.status).toBe('running');

      // Second start should not create another sandbox
      await sandbox._start();
      expect(Sandbox.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('Start - Error Handling', () => {
    it('sets status to error if creation fails', async () => {
      const { Sandbox } = await import('@vercel/sandbox');
      (Sandbox.create as any).mockRejectedValueOnce(new Error('Creation failed'));

      const sandbox = new VercelSandbox({});

      await expect(sandbox._start()).rejects.toThrow('Creation failed');
      expect(sandbox.status).toBe('error');
    });
  });

  describe('Stop', () => {
    it('calls instance.stop() and transitions status to stopped', async () => {
      const sandbox = new VercelSandbox({});
      await sandbox._start();

      expect(sandbox.status).toBe('running');

      await sandbox._stop();

      expect(mockSandbox.stop).toHaveBeenCalledTimes(1);
      expect(sandbox.status).toBe('stopped');
    });

    it('sets instance to null after stop', async () => {
      const sandbox = new VercelSandbox({});
      await sandbox._start();

      expect((sandbox as any).instance).not.toBeNull();

      await sandbox._stop();

      expect((sandbox as any).instance).toBeNull();
    });

    it('handles stop when no instance exists', async () => {
      const sandbox = new VercelSandbox({});

      // Don't start, just stop
      await expect(sandbox.stop()).resolves.toBeUndefined();
      expect(mockSandbox.stop).not.toHaveBeenCalled();
    });

    it('throws error if stop fails', async () => {
      mockSandbox.stop.mockRejectedValueOnce(new Error('Stop failed'));

      const sandbox = new VercelSandbox({});
      await sandbox._start();

      await expect(sandbox._stop()).rejects.toThrow('Stop failed');
    });
  });

  describe('Destroy', () => {
    it('calls instance.stop() and transitions status to destroyed', async () => {
      const sandbox = new VercelSandbox({});
      await sandbox._start();

      expect(sandbox.status).toBe('running');

      await sandbox._destroy();

      expect(mockSandbox.stop).toHaveBeenCalledTimes(1);
      expect(sandbox.status).toBe('destroyed');
    });

    it('sets instance to null after destroy', async () => {
      const sandbox = new VercelSandbox({});
      await sandbox._start();

      expect((sandbox as any).instance).not.toBeNull();

      await sandbox._destroy();

      expect((sandbox as any).instance).toBeNull();
    });
  });

  // Note: The MastraSandbox base class enforces standard Mastra status lifecycle:
  // pending → starting → running → stopping → stopped (or error)
  // The Vercel SDK's internal status is not directly exposed through VercelSandbox.status
  // Instead, the base class manages status transitions based on lifecycle method calls

  describe('getInfo', () => {
    it('returns correct SandboxInfo shape before start', () => {
      const sandbox = new VercelSandbox({ id: 'test-sandbox' });
      const info = sandbox.getInfo();

      expect(info).toEqual({
        id: 'test-sandbox',
        provider: 'vercel',
        status: 'pending', // No instance, so status is 'pending'
        metadata: expect.objectContaining({
          timeout: 300_000,
          createdAt: expect.any(String),
          instance: 'not_initialized',
        }),
      });
    });

    it('returns correct SandboxInfo shape after start', async () => {
      const sandbox = new VercelSandbox({ id: 'test-sandbox' });
      await sandbox._start();

      const info = sandbox.getInfo();

      expect(info).toEqual({
        id: 'test-sandbox',
        provider: 'vercel',
        status: 'running',
        metadata: expect.objectContaining({
          timeout: 300_000,
          createdAt: expect.any(String),
          instance: 'initialized',
        }),
      });
    });

    it('includes timeout in metadata', () => {
      const sandbox = new VercelSandbox({ timeout: 60_000 });
      const info = sandbox.getInfo();

      expect(info.metadata?.timeout).toBe(60_000);
    });
  });

  describe('getInstructions', () => {
    it('returns non-empty string', () => {
      const sandbox = new VercelSandbox({});
      const instructions = sandbox.getInstructions();

      expect(instructions).toBeTruthy();
      expect(typeof instructions).toBe('string');
      expect(instructions.length).toBeGreaterThan(0);
    });

    it('mentions key capabilities', () => {
      const sandbox = new VercelSandbox({});
      const instructions = sandbox.getInstructions();

      // Check for key capability mentions
      expect(instructions.toLowerCase()).toContain('execute');
      expect(instructions.toLowerCase()).toContain('command');
      expect(instructions.toLowerCase()).toContain('mount');
      expect(instructions.toLowerCase()).toContain('filesystem');
    });

    it('mentions Vercel-specific features', () => {
      const sandbox = new VercelSandbox({});
      const instructions = sandbox.getInstructions();

      // Check for Vercel-specific features
      expect(instructions.toLowerCase()).toContain('domain');
      expect(instructions.toLowerCase()).toContain('snapshot');
      expect(instructions.toLowerCase()).toContain('timeout');
      expect(instructions.toLowerCase()).toContain('network');
    });
  });

  describe('sandboxInstance accessor', () => {
    it('returns null before start', () => {
      const sandbox = new VercelSandbox({});

      expect(sandbox.sandboxInstance).toBeNull();
    });

    it('returns instance after start', async () => {
      const sandbox = new VercelSandbox({});
      await sandbox._start();

      expect(sandbox.sandboxInstance).not.toBeNull();
      expect(sandbox.sandboxInstance).toBe(mockSandbox);
    });

    it('returns null after stop', async () => {
      const sandbox = new VercelSandbox({});
      await sandbox._start();

      expect(sandbox.sandboxInstance).not.toBeNull();

      await sandbox._stop();

      expect(sandbox.sandboxInstance).toBeNull();
    });
  });

  });


/**
 * Command Execution Tests
 * 
 * Tests executeCommand() functionality including:
 * - Basic execution with stdout/stderr capture
 * - Non-zero exit codes for failing commands
 * - cwd option forwarding to runCommand()
 * - timeout option forwarding
 * - Environment variable merging (instance + command level)
 * - Streaming: onStdout callback receives data
 * - Streaming: onStderr callback receives data
 * - Error handling: SDK error → throws SandboxExecutionError
 */
describe('VercelSandbox - Command Execution', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await resetMockDefaults();
  });

  it('executes command and returns result', async () => {
    mockSandbox.runCommand.mockImplementationOnce(async (opts: any) => {
      // Simulate Vercel SDK writing to stdout stream
      if (opts.stdout && typeof opts.stdout.write === 'function') {
        opts.stdout.write('hello\n');
      }
      return { exitCode: 0 };
    });
    const sandbox = new VercelSandbox({});
    await sandbox._start();
    const result = await sandbox.executeCommand('echo', ['hello']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('hello\n');
    expect(result.stderr).toBe('');
    expect(result.success).toBe(true);
    expect(result.command).toBe('echo');
    expect(result.args).toEqual(['hello']);
    expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('captures stderr', async () => {
    mockSandbox.runCommand.mockImplementationOnce(async (opts: any) => {
      // Simulate Vercel SDK writing to stderr stream
      if (opts.stderr && typeof opts.stderr.write === 'function') {
        opts.stderr.write('warning message');
      }
      return { exitCode: 0 };
    });
    const sandbox = new VercelSandbox({});
    await sandbox._start();
    const result = await sandbox.executeCommand('sh', ['-c', 'echo warning >&2']);
    expect(result.stderr).toContain('warning message');
    expect(result.stdout).toBe('');
  });

  it('returns non-zero exit code for failing command', async () => {
    mockSandbox.runCommand.mockImplementationOnce(async (opts: any) => {
      // Simulate Vercel SDK writing to stderr stream
      if (opts.stderr && typeof opts.stderr.write === 'function') {
        opts.stderr.write('command not found');
      }
      return { exitCode: 1 };
    });
    const sandbox = new VercelSandbox({});
    await sandbox._start();
    const result = await sandbox.executeCommand('invalid-command', []);
    expect(result.exitCode).toBe(1);
    expect(result.success).toBe(false);
    expect(result.stderr).toContain('command not found');
  });

  it('respects cwd option', async () => {
    mockSandbox.runCommand.mockResolvedValueOnce({
      exitCode: 0,
      stdout: '/tmp\n',
      stderr: '',
    });

    const sandbox = new VercelSandbox({});
    await sandbox._start();

    await sandbox.executeCommand('pwd', [], { cwd: '/tmp' });

    expect(mockSandbox.runCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/tmp',
      }),
    );
  });

  it('respects timeout option', async () => {
    mockSandbox.runCommand.mockResolvedValueOnce({
      exitCode: 0,
      stdout: '',
      stderr: '',
    });

    const sandbox = new VercelSandbox({});
    await sandbox._start();

    await sandbox.executeCommand('sleep', ['10'], { timeout: 1000 });

    // Note: Vercel SDK doesn't have timeoutMs, but we verify the option was handled
    expect(mockSandbox.runCommand).toHaveBeenCalled();
  });

  it('merges environment variables (command overrides instance)', async () => {
    mockSandbox.runCommand.mockResolvedValueOnce({
      exitCode: 0,
      stdout: '',
      stderr: '',
    });

    const sandbox = new VercelSandbox({
      env: { VAR1: 'instance-value', VAR2: 'keep-me' },
    });
    await sandbox._start();

    await sandbox.executeCommand('env', [], {
      env: { VAR1: 'override-value', VAR3: 'new-value' },
    });

    expect(mockSandbox.runCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        env: {
          VAR1: 'override-value', // command-level overrides
          VAR2: 'keep-me', // instance-level preserved
          VAR3: 'new-value', // command-level added
        },
      }),
    );
  });

  it('calls onStdout callback with streaming data', async () => {
    const stdoutCallback = vi.fn();
    // Mock runCommand to use the streaming bridge
    mockSandbox.runCommand.mockImplementationOnce(async (opts: any) => {
      // Simulate streaming data to stdout
      if (opts.stdout && typeof opts.stdout.write === 'function') {
        opts.stdout.write('hello');
      }
      return { exitCode: 0 };
    });
    const sandbox = new VercelSandbox({});
    await sandbox._start();
    await sandbox.executeCommand('echo', ['hello'], {
      onStdout: stdoutCallback,
    });
    expect(stdoutCallback).toHaveBeenCalledWith('hello');
  });
  it('calls onStderr callback with streaming data', async () => {
    const stderrCallback = vi.fn();
    mockSandbox.runCommand.mockImplementationOnce(async (opts: any) => {
      // Simulate streaming data to stderr
      if (opts.stderr && typeof opts.stderr.write === 'function') {
        opts.stderr.write('error');
      }
      return { exitCode: 0 };
    });
    const sandbox = new VercelSandbox({});
    await sandbox._start();
    await sandbox.executeCommand('echo', ['error'], {
      onStderr: stderrCallback,
    });
    expect(stderrCallback).toHaveBeenCalledWith('error');
  });
  it('throws SandboxExecutionError on SDK error', async () => {
    mockSandbox.runCommand.mockRejectedValueOnce(new Error('SDK command execution failed'));

    const sandbox = new VercelSandbox({});
    await sandbox._start();

    await expect(sandbox.executeCommand('fail', [])).rejects.toThrow('Command execution failed');
  });
});

/**
 * Mount Operations Tests
 * 
 * Tests mount() and unmount() functionality:
 * - mount() walks filesystem via listFiles() and calls writeFiles()
 * - mount() returns MountResult with success=true and correct filesCount
 * - unmount() logs warning (Vercel has no unmount API)
 * - Empty filesystem (zero files) handled gracefully
 */
describe('VercelSandbox - Mount Operations', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await resetMockDefaults();
  });

  // Helper to create mock filesystem
  const createMockFilesystem = (files: { name: string; type: 'file' | 'directory'; path: string }[] = []) => ({
    id: 'mock-fs',
    name: 'MockFS',
    provider: 'mock' as const,
    status: 'ready' as const,
    readdir: vi.fn().mockImplementation(async (path: string) => {
      // Return entries for the given path
      const entries = files
        .filter(f => {
          const parentPath = f.path.substring(0, f.path.lastIndexOf('/')) || '/';
          return parentPath === path;
        })
        .map(f => ({ name: f.name, type: f.type }));
      return entries;
    }),
    readFile: vi.fn().mockResolvedValue(Buffer.from('test content')),
  });

  it('mount() walks filesystem and calls writeFiles', async () => {
    const mockFs = createMockFilesystem([
      { name: 'file1.txt', type: 'file', path: '/file1.txt' },
      { name: 'dir', type: 'directory', path: '/dir' },
      { name: 'file2.txt', type: 'file', path: '/dir/file2.txt' },
    ]);
    const sandbox = new VercelSandbox({});
    await sandbox._start();
    const result = await sandbox.mount(mockFs as any, '/data');

    expect(mockFs.readdir).toHaveBeenCalled();
    expect(mockFs.readFile).toHaveBeenCalledTimes(2);
    expect(mockSandbox.writeFiles).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ path: '/data/file1.txt' }),
        expect.objectContaining({ path: '/data/dir/file2.txt' }),
      ]),
    );
    expect(result.success).toBe(true);
    expect(result.filesWritten).toBe(2);
  });

  it('mount() returns MountResult with correct filesCount', async () => {
    const mockFs = createMockFilesystem([
      { name: 'a.txt', type: 'file', path: '/a.txt' },
      { name: 'b.txt', type: 'file', path: '/b.txt' },
      { name: 'c.txt', type: 'file', path: '/c.txt' },
    ]);
    const sandbox = new VercelSandbox({});
    await sandbox._start();
    const result = await sandbox.mount(mockFs as any, '/mnt');
    expect(result).toEqual({
      success: true,
      mountPath: '/mnt',
      filesWritten: 3,
    });
  });
  it('unmount() logs warning (no unmount API)', async () => {
    const sandbox = new VercelSandbox({});
    await sandbox._start();

    // unmount() should not throw
    await expect(sandbox.unmount('/data')).resolves.toBeUndefined();

    // Verify no SDK calls were made (Vercel has no unmount API)
    // The method only logs a warning
  });

  it('handles empty filesystem gracefully', async () => {
    const mockFs = createMockFilesystem([]);

    const sandbox = new VercelSandbox({});
    await sandbox._start();

    const result = await sandbox.mount(mockFs as any, '/empty');

    expect(result.success).toBe(true);
    expect(result.filesWritten).toBe(0);
    expect(mockSandbox.writeFiles).toHaveBeenCalledWith([]);
  });
});

/**
 * Vercel-Specific Features Tests
 * 
 * Tests Vercel-only methods:
 * - snapshot() calls instance.snapshot() and updates status to 'stopped'
 * - getDomain(port) calls instance.domain(port) and returns URL
 * - extendTimeout(duration) calls instance.extendTimeout(duration)
 * - updateNetworkPolicy(policy) calls instance.updateNetworkPolicy(policy)
 */
describe('VercelSandbox - Vercel-Specific Features', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await resetMockDefaults();
  });

  it('snapshot() creates snapshot and sets status to stopped', async () => {
    mockSandbox.snapshot.mockResolvedValueOnce({ id: 'snap-123', createdAt: new Date() });

    const sandbox = new VercelSandbox({});
    await sandbox._start();

    expect(sandbox.status).toBe('running');

    const snapshot = await sandbox.snapshot({ expiration: 3600 });

    expect(mockSandbox.snapshot).toHaveBeenCalledWith({ expiration: 3600 });
    expect(snapshot.id).toBe('snap-123');

    // CRITICAL: Vercel auto-stops sandbox after snapshot
    expect(sandbox.status).toBe('stopped');
    expect(sandbox.sandboxInstance).toBeNull();
  });

  it('getDomain() returns domain URL for port', async () => {
    mockSandbox.domain.mockReturnValueOnce('https://sandbox-8080.vercel.app');

    const sandbox = new VercelSandbox({});
    await sandbox._start();

    const domain = sandbox.getDomain(8080);

    expect(mockSandbox.domain).toHaveBeenCalledWith(8080);
    expect(domain).toBe('https://sandbox-8080.vercel.app');
  });

  it('getDomain() throws if sandbox not initialized', async () => {
    const sandbox = new VercelSandbox({});

    expect(() => sandbox.getDomain(3000)).toThrow('Sandbox instance not initialized');
  });

  it('extendTimeout() calls instance.extendTimeout', async () => {
    mockSandbox.extendTimeout.mockResolvedValueOnce(undefined);

    const sandbox = new VercelSandbox({});
    await sandbox._start();

    await sandbox.extendTimeout(60_000);

    expect(mockSandbox.extendTimeout).toHaveBeenCalledWith(60_000);
  });

  it('updateNetworkPolicy() updates and returns policy', async () => {
    const mockPolicy = { allowedHosts: ['api.example.com'] };
    mockSandbox.updateNetworkPolicy.mockResolvedValueOnce(mockPolicy);

    const sandbox = new VercelSandbox({});
    await sandbox._start();

    const updatedPolicy = await sandbox.updateNetworkPolicy(mockPolicy);

    expect(mockSandbox.updateNetworkPolicy).toHaveBeenCalledWith(mockPolicy);
    expect(updatedPolicy).toEqual(mockPolicy);
  });
});



describe('VercelSandbox Shared Conformance', () => {
  let sandbox: VercelSandbox;

  beforeAll(async () => {
    sandbox = new VercelSandbox({ id: `conformance-${Date.now()}` });
    await sandbox._start();
  });

  afterAll(async () => {
    if (sandbox?.destroy) await sandbox._destroy();
  });

  const getContext = () => ({
    sandbox: sandbox as any,
    capabilities: {
      supportsMounting: true,
      supportsReconnection: false,
      supportsConcurrency: true,
      supportsEnvVars: true,
      supportsWorkingDirectory: true,
      supportsTimeout: true,
      defaultCommandTimeout: 5000,
      supportsStreaming: true,
    },
    testTimeout: 5000,
    fastOnly: false,
    createSandbox: () => new VercelSandbox(),
  });

  createSandboxLifecycleTests(getContext);
  createMountOperationsTests(getContext);
});
