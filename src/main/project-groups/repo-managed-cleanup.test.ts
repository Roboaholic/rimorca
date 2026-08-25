import { access, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { FolderWorkspace } from '../../shared/folder-workspace-types'
import { isDerivedRepoManagedWorkspace } from '../../shared/repo-managed-project'
import { deleteFolderWorkspaceWithDerivedRepo, removeDerivedRepoPath } from './repo-managed-cleanup'

const group = {
  id: 'group-1',
  name: 'AOSP',
  parentPath: '/workspace/aosp',
  createdFrom: 'repo-managed' as const,
  parentGroupId: null,
  tabOrder: 0,
  isCollapsed: false,
  color: null,
  createdAt: 0,
  updatedAt: 0
}

const workspace = {
  id: 'workspace-1',
  projectGroupId: 'group-1',
  name: 'change-1',
  folderPath: '/workspace/aosp/change-1'
} as FolderWorkspace

describe('repo-managed workspace cleanup', () => {
  it('recognizes a strict derived child of a repo-managed group', () => {
    expect(isDerivedRepoManagedWorkspace({ workspace, group })).toBe(true)
  })

  it('does not recognize the repo root or ordinary folder workspaces', () => {
    expect(
      isDerivedRepoManagedWorkspace({
        workspace: { ...workspace, folderPath: '/workspace/aosp' },
        group
      })
    ).toBe(false)
    expect(
      isDerivedRepoManagedWorkspace({
        workspace,
        group: { ...group, createdFrom: 'folder-scan' }
      })
    ).toBe(false)
  })

  it('removes derived files before removing the persisted workspace', async () => {
    const removePath = vi.fn(async () => undefined)
    const removeFolderWorkspace = vi.fn(() => true)

    await expect(
      deleteFolderWorkspaceWithDerivedRepo({
        folderWorkspaceId: workspace.id,
        getFolderWorkspace: () => workspace,
        getProjectGroups: () => [group],
        removeFolderWorkspace,
        removePath
      })
    ).resolves.toBe(true)

    expect(removePath).toHaveBeenCalledWith(workspace.folderPath, null)
    expect(removeFolderWorkspace).toHaveBeenCalledWith(workspace.id)
  })

  it('keeps ordinary folder workspace files untouched', async () => {
    const removePath = vi.fn(async () => undefined)
    const removeFolderWorkspace = vi.fn(() => true)
    const ordinary = { ...workspace, folderPath: '/home/user/project' }

    await deleteFolderWorkspaceWithDerivedRepo({
      folderWorkspaceId: ordinary.id,
      getFolderWorkspace: () => ordinary,
      getProjectGroups: () => [{ ...group, createdFrom: 'folder-scan' }],
      removeFolderWorkspace,
      removePath
    })

    expect(removePath).not.toHaveBeenCalled()
    expect(removeFolderWorkspace).toHaveBeenCalledWith(ordinary.id)
  })

  it('deletes a real derived directory through the cleanup function', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-derived-cleanup-'))
    const derived = join(root, 'derived')
    try {
      await mkdir(derived, { recursive: true })
      await writeFile(join(derived, 'marker.txt'), 'derived')
      await removeDerivedRepoPath(derived)
      await expect(access(derived)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
