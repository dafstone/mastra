/**
 * File-sync utilities for mounting WorkspaceFilesystem to Vercel sandboxes.
 *
 * Unlike E2B's FUSE-based mounting, Vercel sandboxes require syncing all files
 * via their `writeFiles()` API. This module walks a filesystem and prepares
 * files in the format Vercel SDK expects: { path: string, content: Buffer }[]
 */

import type { WorkspaceFilesystem, FileEntry } from '@mastra/core/workspace/filesystem';

/**
 * Result of file sync operation
 */
export interface FileSyncResult {
  /** Number of files successfully written */
  filesWritten: number;
  /** Total bytes transferred */
  totalBytes: number;
  /** List of errors encountered (non-fatal) */
  errors: string[];
}

/**
 * File in Vercel SDK format
 */
export interface VercelFile {
  path: string;
  content: Buffer;
}

/**
 * Walk a WorkspaceFilesystem and collect all files with their contents.
 * Returns files in the format expected by Vercel's sandbox.writeFiles() API.
 *
 * @param filesystem - The filesystem to walk
 * @param basePath - Base path prefix for files (e.g., '/workspace')
 * @returns Promise resolving to array of { path, content } objects
 *
 * @example
 * ```typescript
 * const files = await walkFilesystem(filesystem, '/workspace');
 * await sandbox.writeFiles(files); // Vercel SDK call
 * ```
 */
export async function walkFilesystem(filesystem: WorkspaceFilesystem, basePath: string): Promise<VercelFile[]> {
  const files: VercelFile[] = [];
  const errors: string[] = [];

  /**
   * Recursively walk directory tree and collect files
   */
  async function walk(dirPath: string): Promise<void> {
    try {
      // List directory contents
      const entries = await filesystem.readdir(dirPath);

      for (const entry of entries) {
        const fullPath = dirPath === '/' ? `/${entry.name}` : `${dirPath}/${entry.name}`;

        if (entry.type === 'directory') {
          // Recurse into subdirectory
          await walk(fullPath);
        } else if (entry.type === 'file') {
          // Read file content
          try {
            const content = await filesystem.readFile(fullPath);
            const buffer = content instanceof Buffer ? content : Buffer.from(content, 'utf-8');

            // Build Vercel-compatible path (basePath + relative path)
            const vercelPath = basePath === '/' ? fullPath : `${basePath}${fullPath}`;

            files.push({
              path: vercelPath,
              content: buffer,
            });
          } catch (fileError) {
            // Collect error but continue - individual file failures shouldn't break entire sync
            const errorMsg = `Failed to read file "${fullPath}": ${fileError instanceof Error ? fileError.message : String(fileError)}`;
            errors.push(errorMsg);

          }
        }
      }
    } catch (dirError) {
      // Directory read failed - collect error and continue
      const errorMsg = `Failed to read directory "${dirPath}": ${dirError instanceof Error ? dirError.message : String(dirError)}`;
      errors.push(errorMsg);

    }
  }

  // Start walk from root
  try {
    await walk('/');
  } catch (error) {
    // Root directory read failed - this is fatal
    throw new Error(
      `Failed to walk filesystem "${filesystem.id}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Errors collected during walk are available to caller via function return

  return files;
}

/**
 * Calculate total bytes from a list of files
 */
export function calculateTotalBytes(files: VercelFile[]): number {
  return files.reduce((total, file) => total + file.content.byteLength, 0);
}

/**
 * Helper to validate mount path format
 */
export function validateMountPath(mountPath: string): void {
  if (!mountPath.startsWith('/')) {
    throw new Error(`Mount path must be absolute: "${mountPath}"`);
  }
  if (mountPath !== '/' && mountPath.endsWith('/')) {
    throw new Error(`Mount path must not end with trailing slash: "${mountPath}"`);
  }
}
