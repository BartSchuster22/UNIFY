import { constants } from 'node:fs';
import { access, lstat, mkdir, open, readdir, realpath, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface Workspace { id: string; path: string; root: string; name: string }
export interface ProjectTeam { projectManager: string; agents: string[]; teamConfigurationOwner: 'dsh-hermes-adapter' }
export class ProjectSetupStore {
  readonly home: string;
  readonly roots: string[];
  constructor(home = process.env.HERMES_HOME || join(homedir(), '.hermes'), roots?: string[]) {
    this.home = resolve(home);
    const configured: unknown = roots ?? (process.env.HERMES_WORKSPACE_ROOTS ? JSON.parse(process.env.HERMES_WORKSPACE_ROOTS) : [join(this.home, 'workspace')]);
    if (!Array.isArray(configured) || !configured.length || configured.length > 20 || configured.some(x => typeof x !== 'string' || !isAbsolute(x))) throw new Error('Invalid configured workspace roots');
    this.roots = configured.map(x => resolve(x));
  }
  async workspaces(): Promise<Workspace[]> {
    const items: Workspace[] = [];
    const visit = async (path: string, root: string, depth: number): Promise<void> => {
      if (items.length >= 500) throw new Error('Workspace inventory exceeds 500 directories; narrow configured roots');
      let entries;
      try {
        if ((await lstat(path)).isSymbolicLink() || await realpath(path) !== path) return;
        await access(path, constants.R_OK | constants.W_OK | constants.X_OK);
        entries = await readdir(path, { withFileTypes: true });
      } catch (error) {
        if (path === root && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        return;
      }
      items.push({ id: path, path, root, name: relative(root, path) || root });
      if (depth >= 3) return;
      for (const entry of entries.sort((a,b) => a.name.localeCompare(b.name))) {
        if (entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith('.') && !['node_modules', '__pycache__'].includes(entry.name)) await visit(join(path, entry.name), root, depth + 1);
      }
    };
    for (const root of this.roots) await visit(root, root, 0);
    return [...new Map(items.map(item => [item.path, item])).values()];
  }
  async validateWorkspace(value: unknown): Promise<string | undefined> {
    if (value === undefined || value === '') return undefined;
    if (typeof value !== 'string' || !isAbsolute(value) || value.includes('\0') || resolve(value) !== value) throw new Error('Select a valid approved workspace');
    if (!(await this.workspaces()).some(item => item.path === value)) throw new Error('Workspace is unavailable or outside the approved inventory');
    return value;
  }
  private directory() { return join(this.home, 'state', 'dsh-project-teams'); }
  private file(id: string) {
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)) throw new Error('Invalid project slug');
    return join(this.directory(), id + '.json');
  }
  async read(id: string): Promise<ProjectTeam | undefined> {
    const path = this.file(id);
    try {
      const dir = this.directory();
      if ((await realpath(dir)) !== dir) throw new Error('Project configuration directory must not be a symlink');
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        if ((await handle.stat()).size > 65536) throw new Error('Project configuration too large');
        const value = JSON.parse(await handle.readFile('utf8')) as ProjectTeam;
        if (value.teamConfigurationOwner !== 'dsh-hermes-adapter' || typeof value.projectManager !== 'string' || !Array.isArray(value.agents) || value.agents.length > 50 || value.agents.some(x => typeof x !== 'string')) throw new Error('Invalid project team configuration');
        return value;
      } finally { await handle.close(); }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }
  async write(id: string, team: ProjectTeam): Promise<void> {
    const path = this.file(id);
    await mkdir(this.directory(), { recursive: true, mode: 0o700 });
    if (await realpath(this.directory()) !== this.directory()) throw new Error('Project configuration directory must not be a symlink');
    const temporary = path + '.' + randomUUID() + '.tmp';
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(team) + '\n'); await handle.sync(); }
    finally { await handle.close(); }
    try { await rename(temporary, path); } finally { await unlink(temporary).catch(() => undefined); }
  }
}
