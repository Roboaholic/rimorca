import { describe, expect, it } from 'vitest'
import {
  REPO_MANAGED_DERIVE_PHASES,
  repoManagedDeriveProgress
} from './repo-managed-derive-progress'

describe('repoManagedDeriveProgress', () => {
  it('maps each derive phase to a determinate percent', () => {
    expect(REPO_MANAGED_DERIVE_PHASES).toEqual([
      'preparing',
      'worktrees',
      'linking',
      'register'
    ])
    expect(repoManagedDeriveProgress('preparing')).toEqual({
      phase: 'preparing',
      step: 1,
      total: 4,
      percent: 25
    })
    expect(
      repoManagedDeriveProgress('worktrees', {
        currentProject: 'app',
        processedProjects: 1,
        totalProjects: 2
      })
    ).toEqual({
      phase: 'worktrees',
      step: 2,
      total: 4,
      percent: 38,
      currentProject: 'app',
      processedProjects: 1,
      totalProjects: 2
    })
    expect(repoManagedDeriveProgress('linking')).toEqual({
      phase: 'linking',
      step: 3,
      total: 4,
      percent: 75
    })
    expect(repoManagedDeriveProgress('register')).toEqual({
      phase: 'register',
      step: 4,
      total: 4,
      percent: 100
    })
  })
})
