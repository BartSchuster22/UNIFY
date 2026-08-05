import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

async function productionTypescriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await productionTypescriptFiles(path)));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) files.push(path);
  }
  return files;
}

describe('standalone runtime boundary', () => {
  it('contains no Agency or DMM runtime code or configuration', async () => {
    const files = await productionTypescriptFiles(new URL('.', import.meta.url).pathname);
    const violations: string[] = [];
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      if (/agency|dmm/i.test(source)) violations.push(file);
    }
    expect(violations).toEqual([]);
  });
});
