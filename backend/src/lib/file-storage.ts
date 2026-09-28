import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';

/**
 * Original files live under STORAGE_DIR with random names; the user's file name is
 * only kept in the database. That rules out path traversal through file names.
 */
export class FileStorage {
  readonly root: string;
  readonly tmpDir: string;

  constructor(root: string) {
    this.root = path.resolve(root);
    this.tmpDir = path.join(this.root, 'tmp');
  }

  async init(): Promise<void> {
    await mkdir(path.join(this.root, 'documents'), { recursive: true });
    await mkdir(this.tmpDir, { recursive: true });
  }

  /** Moves an uploaded temp file into permanent storage and returns its relative path. */
  async moveIn(tempPath: string, extension: string): Promise<string> {
    const relativePath = `documents/${randomUUID()}${extension.toLowerCase()}`;
    await rename(tempPath, this.absolutePath(relativePath));
    return relativePath;
  }

  read(relativePath: string): Promise<Buffer> {
    return readFile(this.absolutePath(relativePath));
  }

  async remove(relativePath: string): Promise<void> {
    await rm(this.absolutePath(relativePath), { force: true });
  }

  absolutePath(relativePath: string): string {
    const absolute = path.resolve(this.root, relativePath);
    if (!absolute.startsWith(this.root + path.sep)) {
      throw new Error(`Path escapes storage root: ${relativePath}`);
    }
    return absolute;
  }
}
