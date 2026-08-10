import type { TrustedRelease, TrustedReleaseClient } from './types.js';

const API_ORIGIN = 'https://api.github.com';
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

function validRepository(repository: string): boolean {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository);
}

export class GitHubTrustedReleaseClient implements TrustedReleaseClient {
  readonly #repository: string;

  constructor(
    repository: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 12_000,
  ) {
    if (!validRepository(repository)) throw new Error('Invalid trusted GitHub repository');
    this.#repository = repository;
  }

  async latestStableRelease(): Promise<TrustedRelease> {
    const releases = await this.#json<
      Array<{
        tag_name?: unknown;
        name?: unknown;
        body?: unknown;
        html_url?: unknown;
        published_at?: unknown;
        prerelease?: unknown;
        draft?: unknown;
      }>
    >(`/repos/${this.#repository}/releases?per_page=20`);
    const release = releases.find((item) => item.draft === false && item.prerelease === false);
    if (!release) throw new Error('Trusted upstream returned no stable release');
    const tagName = requiredString(release.tag_name, 'release tag', 200);
    const publishedAt = requiredTimestamp(release.published_at);
    const releaseUrl = requiredString(release.html_url, 'release URL', 1000);
    const parsedReleaseUrl = new URL(releaseUrl);
    if (parsedReleaseUrl.protocol !== 'https:' || parsedReleaseUrl.hostname !== 'github.com')
      throw new Error('Trusted upstream returned an invalid release URL');
    const commit = await this.#json<{ sha?: unknown }>(
      `/repos/${this.#repository}/commits/${encodeURIComponent(tagName)}`,
    );
    const commitSha = requiredString(commit.sha, 'release commit', 40);
    if (!/^[a-f0-9]{40}$/.test(commitSha))
      throw new Error('Trusted upstream returned an invalid release commit');
    return {
      tagName,
      releaseName:
        typeof release.name === 'string' && release.name.trim()
          ? release.name.trim().slice(0, 500)
          : tagName,
      commitSha,
      releaseUrl,
      releaseNotes: typeof release.body === 'string' ? release.body.slice(0, 100_000) : '',
      publishedAt,
      prerelease: false,
      draft: false,
    };
  }

  async compare(installedCommit: string, candidateTag: string) {
    if (!/^[a-f0-9]{40}$/.test(installedCommit)) throw new Error('Invalid installed commit');
    const result = await this.#json<{
      status?: unknown;
      ahead_by?: unknown;
      behind_by?: unknown;
    }>(
      `/repos/${this.#repository}/compare/${installedCommit}...${encodeURIComponent(candidateTag)}`,
    );
    const allowed = new Set(['identical', 'behind', 'ahead', 'diverged']);
    const status: 'identical' | 'behind' | 'ahead' | 'diverged' | 'unknown' =
      typeof result.status === 'string' && allowed.has(result.status)
        ? (result.status as 'identical' | 'behind' | 'ahead' | 'diverged')
        : 'unknown';
    return {
      status,
      aheadBy: nonnegativeInteger(result.ahead_by),
      behindBy: nonnegativeInteger(result.behind_by),
    };
  }

  async #json<T>(path: string): Promise<T> {
    const url = new URL(path, API_ORIGIN);
    if (url.origin !== API_ORIGIN) throw new Error('Trusted upstream URL escaped its origin');
    const response = await this.fetchImpl(url, {
      signal: AbortSignal.timeout(this.timeoutMs),
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'UNIFY-framework-update-visibility/1',
        'x-github-api-version': '2022-11-28',
      },
    });
    if (new URL(response.url || url).origin !== API_ORIGIN)
      throw new Error('Trusted upstream redirected outside its API origin');
    if (!response.ok) throw new Error(`Trusted upstream request failed (${response.status})`);
    const length = Number(response.headers.get('content-length') ?? 0);
    if (length > MAX_RESPONSE_BYTES)
      throw new Error('Trusted upstream response exceeded size limit');
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES)
      throw new Error('Trusted upstream response exceeded size limit');
    return JSON.parse(text) as T;
  }
}

function requiredString(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum)
    throw new Error(`Trusted upstream returned an invalid ${label}`);
  return value.trim();
}

function requiredTimestamp(value: unknown): string {
  const raw = requiredString(value, 'published timestamp', 100);
  const date = new Date(raw);
  if (Number.isNaN(date.valueOf()))
    throw new Error('Trusted upstream returned an invalid timestamp');
  return date.toISOString();
}

function nonnegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}
