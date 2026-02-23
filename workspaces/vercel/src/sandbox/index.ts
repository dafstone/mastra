/**
 * Vercel Sandbox Provider
 *
 * A Vercel sandbox implementation that supports mounting
 * cloud filesystems via file sync (writeFiles).
 *
 * @see https://sdk.vercel.com
 */

import type {
  SandboxInfo,
  ExecuteCommandOptions,
  CommandResult,
  WorkspaceFilesystem,
  MountResult,
  ProviderStatus,
  MountManager,
} from '@mastra/core/workspace';
import {
  MastraSandbox,
  SandboxNotReadyError,
  SandboxExecutionError,
  SandboxTimeoutError,
} from '@mastra/core/workspace';
import type { Sandbox, Snapshot } from '@vercel/sandbox';
import { Sandbox as VercelSandboxClass } from '@vercel/sandbox';
import { randomUUID } from 'crypto';

import { createStreamingBridge } from './streaming';
import type { StreamingCallbacks } from './streaming';
import { walkFilesystem } from './mount-sync';
import type { VercelFile } from './mount-sync';
import type { VercelSandboxOptions } from './types';
import { VERCEL_STATUS_MAP, LOG_PREFIX } from './types';

/** Allowlist pattern for mount paths — absolute path with safe characters only. */
const SAFE_MOUNT_PATH = /^\/[a-zA-Z0-9_.\-/]+$/;

function validateMountPath(mountPath: string): void {
  if (!SAFE_MOUNT_PATH.test(mountPath)) {
    throw new Error(
      `Invalid mount path: ${mountPath}. Must be an absolute path with alphanumeric, dash, dot, underscore, or slash characters only.`,
    );
  }
}

/**
 * Simplified Vercel sandbox implementation.
 *
 * Features:
 * - Single sandbox instance lifecycle
 * - Supports mounting cloud filesystems via file sync
 * - Automatic sandbox timeout handling
 *
 * @example Basic usage
 * ```typescript
 * import { Workspace } from '@mastra/core/workspace';
 * import { VercelSandbox } from '@mastra/vercel';
 *
 * const sandbox = new VercelSandbox({
 *   timeout: 60000,
 * });
 *
 * const workspace = new Workspace({ sandbox });
 * const result = await workspace.executeCode('console.log("Hello!")');
 * ```
 */
export class VercelSandbox extends MastraSandbox {
  readonly id: string;
  readonly name = 'VercelSandbox';
  readonly provider = 'vercel';

  // Status is managed by base class lifecycle methods
  status: ProviderStatus = 'pending';

  private instance: Sandbox | null = null;
  private sandboxOptions: VercelSandboxOptions;
  private env: Record<string, string>;
  private timeout: number;

  declare readonly mounts: MountManager; // Non-optional (initialized by MastraSandbox)

  constructor(options?: VercelSandboxOptions) {
    super({ name: 'VercelSandbox', ...(options || {}) });
    this.id = options?.id ?? randomUUID();
    this.sandboxOptions = options || {};
    this.env = options?.env ?? {};
    this.timeout = options?.timeout ?? 300_000; // 5 minutes default
  }

  // ---------------------------------------------------------------------------
  // Private Helper Methods
  // ---------------------------------------------------------------------------

  /**
   * Ensure sandbox instance is initialized and running.
   * Throws SandboxNotReadyError if instance is not available.
   */
  private async ensureSandbox(): Promise<Sandbox> {
    await this.ensureRunning();
    if (!this.instance) {
      throw new SandboxNotReadyError('Sandbox instance not initialized');
    }
    return this.instance;
  }

  /**
   * Shell-quote an argument for safe command execution.
   * If the argument contains only safe characters, return as-is.
   * Otherwise, wrap in single quotes and escape existing single quotes.
   */
  private shellQuote(arg: string): string {
    // Safe characters: alphanumeric, dash, dot, underscore, forward slash
    if (/^[a-zA-Z0-9_\-./]+$/.test(arg)) {
      return arg;
    }
    // Escape single quotes by closing the quote, adding escaped quote, reopening
    return `'${arg.replace(/'/g, "'\\''")}'`;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle Methods (stubs - Task 5b)
  // ---------------------------------------------------------------------------

  async start(): Promise<void> {
    // Reconnection support: if id exists, attempt reconnection
    if (this.sandboxOptions.id && !this.instance) {
      try {
        this.logger.info(`${LOG_PREFIX} Reconnecting to existing sandbox`, { id: this.sandboxOptions.id });
        this.instance = await VercelSandboxClass.get({ sandboxId: this.sandboxOptions.id });
        // Status will be set by base class _start() wrapper
        this.logger.info(`${LOG_PREFIX} Sandbox reconnected successfully`, { id: this.id, status: this.status });
        return;
      } catch (error) {
        this.logger.warn(`${LOG_PREFIX} Reconnection failed, creating new sandbox`, {
          id: this.sandboxOptions.id,
          error: error instanceof Error ? error.message : String(error),
        });
        // Fall through to create new sandbox
      }
    }

    // Create new sandbox
    this.logger.info(`${LOG_PREFIX} Creating new sandbox`, {
      timeout: this.timeout,
      teamId: this.sandboxOptions.teamId,
      projectId: this.sandboxOptions.projectId,
    });

    try {
      this.instance = await VercelSandboxClass.create({
        timeout: this.timeout,
        teamId: this.sandboxOptions.teamId,
        projectId: this.sandboxOptions.projectId,
        token: this.sandboxOptions.token,
        resources: {
          vcpus: this.sandboxOptions.cpus ?? 1,
        },
      });

      // Status set to 'running' by base class _start() wrapper
      this.logger.info(`${LOG_PREFIX} Sandbox started successfully`, { id: this.id });
    } catch (error) {
      // Status set to 'error' by base class _start() wrapper
      this.logger.error(`${LOG_PREFIX} Failed to start sandbox`, { error });
      throw error;
    }
  }
  async stop(): Promise<void> {
    if (!this.instance) {
      this.logger.warn(`${LOG_PREFIX} Stop called but no instance exists`);
      return;
    }

    try {
      this.logger.info(`${LOG_PREFIX} Stopping sandbox`, { id: this.id });
      await this.instance.stop();
      // Status set by base class _stop() wrapper
      this.instance = null;
      this.logger.info(`${LOG_PREFIX} Sandbox stopped successfully`, { id: this.id });
    } catch (error) {
      this.logger.error(`${LOG_PREFIX} Failed to stop sandbox`, { error });
      throw error;
    }
  }
  async destroy(): Promise<void> {
    // Vercel has no separate destroy operation - stop does everything
    await this.stop();
    this.logger.info(`${LOG_PREFIX} Sandbox destroyed`, { id: this.id });
  }

  // ---------------------------------------------------------------------------
  // Execution Methods (stubs - Task 5c)
  // ---------------------------------------------------------------------------

  async executeCommand(command: string, args?: string[], options?: ExecuteCommandOptions): Promise<CommandResult> {
    const sandbox = await this.ensureSandbox();
    const startTime = Date.now();

    // Build command string with shell-quoted args
    const fullCommand =
      args && args.length > 0 ? `${command} ${args.map(arg => this.shellQuote(arg)).join(' ')}` : command;

    this.logger.info(`${LOG_PREFIX} Executing command`, {
      id: this.id,
      command: fullCommand,
      cwd: options?.cwd,
    });

    // Output buffers for final CommandResult
    let stdoutBuffer = '';
    let stderrBuffer = '';

    // Create streaming bridge
    const bridge = createStreamingBridge({
      onStdout: data => {
        stdoutBuffer += data;
        options?.onStdout?.(data);
      },
      onStderr: data => {
        stderrBuffer += data;
        options?.onStderr?.(data);
      },
    });

    try {
      // Execute command via Vercel SDK
      const mergedEnv: Record<string, string> = {};
      if (this.env) Object.assign(mergedEnv, this.env);
      if (options?.env) Object.assign(mergedEnv, options.env);
      
      const result = await sandbox.runCommand({
        cmd: fullCommand,
        cwd: options?.cwd,
        env: mergedEnv,
        stdout: bridge.stdout,
        stderr: bridge.stderr,
      });

      const executionTimeMs = Date.now() - startTime;
      const success = result.exitCode === 0;

      this.logger.info(`${LOG_PREFIX} Command completed`, {
        id: this.id,
        exitCode: result.exitCode,
        executionTimeMs,
        success,
      });

      return {
        success,
        exitCode: result.exitCode,
        stdout: stdoutBuffer,
        stderr: stderrBuffer,
        executionTimeMs,
        command,
        args,
      };
    } catch (error) {
      const executionTimeMs = Date.now() - startTime;

      // Check if timeout error (Vercel SDK may throw specific error type)
      if (error instanceof Error && error.message.includes('timeout')) {
        this.logger.error(`${LOG_PREFIX} Command timed out`, {
          id: this.id,
          command: fullCommand,
          executionTimeMs,
        });
        throw new SandboxTimeoutError(executionTimeMs, 'command');
      }

      // General execution error
      this.logger.error(`${LOG_PREFIX} Command failed`, {
        id: this.id,
        command: fullCommand,
        error: error instanceof Error ? error.message : String(error),
      });

      throw new SandboxExecutionError(
        `Command execution failed: ${error instanceof Error ? error.message : String(error)}`,
        -1,
        stdoutBuffer,
        stderrBuffer,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Mount & Filesystem Methods (Task 5d)
  // ---------------------------------------------------------------------------

  async mount(filesystem: WorkspaceFilesystem, mountPath: string): Promise<MountResult> {
    validateMountPath(mountPath);
    const sandbox = await this.ensureSandbox();

    this.logger.info(`${LOG_PREFIX} Mounting filesystem at "${mountPath}"`, {
      id: this.id,
      provider: filesystem.provider,
      filesystemId: filesystem.id,
    });

    try {
      // Walk filesystem and collect files in Vercel SDK format
      const files = await walkFilesystem(filesystem, mountPath);

      // Write files to sandbox
      await sandbox.writeFiles(files);

      this.logger.info(`${LOG_PREFIX} Filesystem mounted successfully`, {
        id: this.id,
        mountPath,
        filesWritten: files.length,
      });

      return {
        success: true,
        mountPath,
      };
    } catch (error) {
      this.logger.error(`${LOG_PREFIX} Failed to mount filesystem`, {
        id: this.id,
        mountPath,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async unmount(mountPath: string): Promise<void> {
    validateMountPath(mountPath);

    this.logger.info(`${LOG_PREFIX} Unmounting filesystem at "${mountPath}"`, {
      id: this.id,
    });

    this.logger.warn(`${LOG_PREFIX} Vercel sandboxes do not support true unmounting. Files remain in sandbox.`, {
      id: this.id,
      mountPath,
    });

    // Vercel doesn't provide unmount API - this is internal bookkeeping only
    // Files written via writeFiles() cannot be removed
  }

  getInfo(): SandboxInfo {
    return {
      id: this.id,
      name: this.name,
      provider: 'vercel' as const,
      status: this.status,
      createdAt: new Date(),
      mounts: Array.from(this.mounts.entries).map(([path]) => ({
        path,
        filesystem: 'vercel-writefiles',
      })),
      metadata: {
        timeout: this.timeout,
        createdAt: new Date().toISOString(),
        instance: this.instance ? 'initialized' : 'not_initialized',
      },
    };
  }

  getInstructions(): string {
    return `This is a Vercel Sandbox that can:

1. **Execute Commands**: Run arbitrary commands in a Linux environment
   - Use executeCommand() to run shell commands
   - Supports streaming stdout/stderr via callbacks
   - Automatic timeout handling

2. **Mount Filesystems**: Write files from cloud sources into the sandbox
   - Use mount() to sync files from WorkspaceFilesystem implementations
   - Files are written to the specified mount path
   - Note: Vercel sandboxes do not support unmounting (files are permanent)

3. **Access via Domain**: Run services and access them via Vercel domains
   - Use getDomain(port) to get the HTTPS URL for a port
   - Ports must be registered when creating the sandbox
   - Format: https://{sandbox-id}-{port}.vercel.app

4. **Create Snapshots**: Save sandbox state for later restoration
   - Use snapshot() to create a snapshot of the current state
   - Note: Snapshot operation auto-stops the sandbox
   - Snapshots can be restored on future sandbox creations

5. **Extend Timeout**: Increase the execution time limit
   - Use extendTimeout(duration) to add more time
   - Useful for long-running operations

6. **Manage Network Policies**: Control network access
   - Use updateNetworkPolicy(policy) to modify network rules
   - Restrict or allow specific hosts/ports
   - Returns updated policy configuration

Example usage:
  const result = await sandbox.executeCommand('ls', ['-la'], { cwd: '/tmp' });
  const domain = sandbox.getDomain(3000);
  await sandbox.mount(filesystem, '/data');
  const snapshot = await sandbox.snapshot();
`;
  }

  async snapshot(options?: { expiration?: number }): Promise<Snapshot> {
    const instance = await this.ensureSandbox();

    this.logger.info(`${LOG_PREFIX} Creating snapshot`, {
      id: this.id,
      expiration: options?.expiration,
    });

    try {
      const snapshot = await instance.snapshot(options);

      // CRITICAL: Vercel auto-stops sandbox after snapshot - update status
      this.status = 'stopped';
      this.instance = null;

      this.logger.info(`${LOG_PREFIX} Snapshot created successfully`, {
        id: this.id,
        snapshotId: (snapshot as any).id,
      });

      return snapshot;
    } catch (error) {
      this.logger.error(`${LOG_PREFIX} Failed to create snapshot`, {
        id: this.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  getDomain(port: number): string {
    if (!this.instance) {
      throw new SandboxNotReadyError('Sandbox instance not initialized. Cannot get domain.');
    }

    this.logger.info(`${LOG_PREFIX} Getting domain for port`, {
      id: this.id,
      port,
    });

    try {
      const domain = this.instance.domain(port);

      this.logger.info(`${LOG_PREFIX} Domain retrieved`, {
        id: this.id,
        port,
        domain,
      });

      return domain;
    } catch (error) {
      this.logger.error(`${LOG_PREFIX} Failed to get domain`, {
        id: this.id,
        port,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async extendTimeout(duration: number): Promise<void> {
    const instance = await this.ensureSandbox();

    this.logger.info(`${LOG_PREFIX} Extending sandbox timeout`, {
      id: this.id,
      duration,
    });

    try {
      await instance.extendTimeout(duration);

      this.logger.info(`${LOG_PREFIX} Timeout extended successfully`, {
        id: this.id,
        duration,
      });
    } catch (error) {
      this.logger.error(`${LOG_PREFIX} Failed to extend timeout`, {
        id: this.id,
        duration,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async updateNetworkPolicy(policy: any): Promise<any> {
    const instance = await this.ensureSandbox();

    this.logger.info(`${LOG_PREFIX} Updating network policy`, {
      id: this.id,
      policyKeys: Object.keys(policy || {}),
    });

    try {
      const updatedPolicy = await instance.updateNetworkPolicy(policy);

      this.logger.info(`${LOG_PREFIX} Network policy updated successfully`, {
        id: this.id,
        policyKeys: Object.keys(updatedPolicy || {}),
      });

      return updatedPolicy;
    } catch (error) {
      this.logger.error(`${LOG_PREFIX} Failed to update network policy`, {
        id: this.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Internal Accessors
  // ---------------------------------------------------------------------------

  /**
   * Get the underlying Vercel sandbox instance.
   * Returns null if not initialized.
   */
  get sandboxInstance(): Sandbox | null {
    return this.instance;
  }
}
