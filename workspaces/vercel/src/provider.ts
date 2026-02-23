/**
 * Vercel sandbox provider descriptor for MastraEditor.
 *
 * @example
 * ```typescript
 * import { vercelSandboxProvider } from '@mastra/vercel';
 *
 * const editor = new MastraEditor({
 *   sandboxes: [vercelSandboxProvider],
 * });
 * ```
 */
import type { SandboxProvider } from '@mastra/core/editor';
import { VercelSandbox } from './sandbox';

/**
 * Serializable subset of VercelSandboxOptions for editor storage.
 * Non-serializable options (logger, mounts, runtime objects) are excluded.
 */
interface VercelProviderConfig {
  token?: string;
  teamId?: string;
  projectId?: string;
  timeout?: number;
  env?: Record<string, string>;
  cpus?: number;
  memory?: number;
}

export const vercelSandboxProvider: SandboxProvider<VercelProviderConfig> = {
  id: 'vercel',
  name: 'Vercel Sandbox',
  description: 'Cloud sandbox powered by Vercel',
  configSchema: {
    type: 'object',
    properties: {
      token: { type: 'string', description: 'Vercel API token' },
      teamId: { type: 'string', description: 'Vercel team ID' },
      projectId: { type: 'string', description: 'Vercel project ID' },
      timeout: {
        type: 'number',
        description: 'Execution timeout in milliseconds',
        default: 300000,
      },
      env: {
        type: 'object',
        description: 'Environment variables',
        additionalProperties: { type: 'string' },
      },
      cpus: {
        type: 'number',
        description: 'Number of vCPUs',
        default: 1,
      },
      memory: {
        type: 'number',
        description: 'Sandbox memory in MB',
        default: 2048,
      },
    },
  },
  createSandbox: config => new VercelSandbox(config),
};
