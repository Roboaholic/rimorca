// Why: pure helpers for GitLabProjectSettings — kept out of the IPC
// handler so the recents logic is testable without mocking the Store.
import type { GitLabProjectSettings } from './gitlab-types'

/** Default max recents kept before older entries fall off. */
export const GITLAB_RECENTS_MAX = 10

/**
 * Compute the next `recent` list when a project at (host, path) is
 * opened. Most-recent-first ordering, dedupes by host+path, caps at
 * `max` entries. Returns a fresh array — caller is responsible for
 * persisting via `Store.updateSettings`.
 */
export function computeNextGitLabRecents(
  existing: GitLabProjectSettings['recent'],
  host: string,
  path: string,
  now: Date = new Date(),
  max: number = GITLAB_RECENTS_MAX
): GitLabProjectSettings['recent'] {
  // Why: filter before prepend so re-opening an already-recent project
  // moves it to the front rather than producing a duplicate.
  const filtered = existing.filter((entry) => !(entry.host === host && entry.path === path))
  return [{ host, path, lastOpenedAt: now.toISOString() }, ...filtered].slice(0, max)
}

export function parseGitLabProjectAddress(value: string): { host: string; path: string } | null {
  const input = value.trim()
  if (!input) {
    return null
  }
  try {
    const url = new URL(input)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !url.host) {
      return null
    }
    const path = url.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '')
    return path && !path.includes('/-/') ? { host: url.host.toLowerCase(), path } : null
  } catch {
    const match = /^([^\s/]+(?:\:[0-9]+)?)\/(.+)$/.exec(input)
    if (!match) {
      return null
    }
    const path = match[2].replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '')
    return path ? { host: match[1].toLowerCase(), path } : null
  }
}
