import type { Repo } from '../../../shared/repo-types'

export function resolveGitLabExecutionRepo(
  repos: readonly Repo[],
  selectedRepoId: string | null,
  fallbackRepos: readonly Repo[]
): Repo | null {
  return (
    repos.find((repo) => repo.id === selectedRepoId) ??
    repos.find((repo) => {
      const isLocalHost =
        !repo.connectionId && (!repo.executionHostId || repo.executionHostId === 'local')
      return isLocalHost && !/^\\\\wsl(?:\.localhost)?\\/i.test(repo.path)
    }) ??
    fallbackRepos[0] ??
    repos[0] ??
    null
  )
}
