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
