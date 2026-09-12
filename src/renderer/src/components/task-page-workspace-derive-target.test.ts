import { describe, expect, it } from 'vitest'
import type { ProjectGroup } from '../../../shared/project-group-types'
import type { Repo } from '../../../shared/repo-types'
import { getTaskWorkspaceProjectGroupId } from './use-task-page-workspace-actions'

const repo = (projectGroupId?: string): Repo => ({
  id: 'repo-1',
  path: '/workspace/repo',
  displayName: 'repo',
  badgeColor: '#000',
  addedAt: 1,
  kind: 'git',
  projectGroupId
})

const group = (createdFrom: ProjectGroup['createdFrom']): ProjectGroup => ({
  id: 'group-1',
  name: 'Platform',
  parentPath: '/workspace',
  parentGroupId: null,
  createdFrom,
  tabOrder: 0,
  isCollapsed: false,
  color: null,
  createdAt: 1,
  updatedAt: 1
})

describe('getTaskWorkspaceProjectGroupId', () => {
  it('targets a repo-managed group so the composer exposes derive mode', () => {
    expect(getTaskWorkspaceProjectGroupId(repo('group-1'), [group('repo-managed')])).toBe('group-1')
  })

  it('uses the active repo-managed group when a GitLab URL was read via a Host anchor', () => {
    expect(
      getTaskWorkspaceProjectGroupId(repo(), [group('repo-managed')], {
        ...repo('group-1'),
        id: 'active-repo'
      })
    ).toBe('group-1')
  })

  it('keeps ordinary repos on the worktree creation path', () => {
    expect(getTaskWorkspaceProjectGroupId(repo('group-1'), [group('manual')])).toBeUndefined()
    expect(getTaskWorkspaceProjectGroupId(repo(), [group('repo-managed')])).toBeUndefined()
  })
})
