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

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Sandbox } from '@vercel/sandbox';

import { VercelSandbox } from './index';
import type { VercelSandboxOptions } from './types';

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
