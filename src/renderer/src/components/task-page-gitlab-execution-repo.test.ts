import { describe, expect, it } from 'vitest'
import type { Repo } from '../../../shared/repo-types'
import { resolveGitLabExecutionRepo } from './task-page-gitlab-execution-repo'

const repo = (id: string): Repo => ({
  id,
  path: `/repos/${id}`,
  displayName: id,
  badgeColor: '#000',
  addedAt: 1,
  kind: 'git'
})

describe('resolveGitLabExecutionRepo', () => {
  const repos = [
    { ...repo('wsl'), path: '\\\\wsl.localhost\\Ubuntu-24.04\\home\\miles\\repo' },
    { ...repo('windows'), path: 'C:\\repos\\windows' },
    { ...repo('ssh'), connectionId: 'builder', executionHostId: 'ssh:builder' as const }
  ]

  it('uses the explicit read location', () => {
    expect(resolveGitLabExecutionRepo(repos, 'ssh', [repos[0]])?.id).toBe('ssh')
  })

  it('defaults to the Local Host before selected WSL or SSH projects', () => {
    expect(resolveGitLabExecutionRepo(repos, null, [repos[1]])?.id).toBe('windows')
    expect(resolveGitLabExecutionRepo(repos, null, [])?.id).toBe('windows')
  })
})
