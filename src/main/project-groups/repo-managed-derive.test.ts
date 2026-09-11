import { mkdir, mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FolderWorkspace } from '../../shared/folder-workspace-types'
import type { ProjectGroup } from '../../shared/project-group-types'
import { gitExecFileAsync } from '../git/runner'
import {
  REPO_MANAGED_DERIVE_SSH_UNSUPPORTED,
  REPO_MANAGED_GROUP_REQUIRED,
  REPO_MANAGED_LOCAL_OBJECTS_MISSING,
  REPO_MANAGED_SNAPSHOT_METADATA,
  createRepoSnapshotProgressParser,
  createRepoManagedSnapshot,
  deriveRepoManagedFolderWorkspace,
  resolveRepoManagedSnapshotPath,
  readRepoManagedProjectPaths,
  seedDerivedRepoProjectGitDirs
} from './repo-managed-derive'

const defaultGitMock = async (args: string[]): Promise<{ stdout: string; stderr: string }> => {
  const keyIndex = args.lastIndexOf('--get')
  const key = keyIndex !== -1 ? args[keyIndex + 1] : ''
  if (key === 'remote.origin.url') {
    return { stdout: 'https://example.com/manifest.git\n', stderr: '' }
  }
  if (args.includes('--abbrev-ref') || args.includes('for-each-ref')) {
    return { stdout: 'main\n', stderr: '' }
  }
  return { stdout: '', stderr: '' }
}

vi.mock('../git/runner', () => ({
  gitExecFileAsync: vi.fn()
}))


let tempDirs: string[] = []

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'orca-repo-derive-'))
  tempDirs.push(dir)
  return dir
}

beforeEach(() => {
  vi.mocked(gitExecFileAsync).mockReset().mockImplementation(defaultGitMock)
})

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
  tempDirs = []
})

async function writeMinimalRepoTree(mainPath: string): Promise<void> {
  await mkdir(join(mainPath, '.repo', 'repo'), { recursive: true })
  await mkdir(join(mainPath, '.repo', 'manifests'), { recursive: true })
  await writeFile(join(mainPath, '.repo', 'repo', 'repo'), '#!/bin/sh\n')
  await writeFile(join(mainPath, '.repo', 'manifest.xml'), '<manifest />\n')
  await writeFile(join(mainPath, '.repo', 'manifests', 'default.xml'), '<manifest />\n')
  await writeFile(join(mainPath, '.repo', 'project.list'), 'app\n')
  await mkdir(join(mainPath, '.repo', 'projects', 'app.git'), { recursive: true })
  await mkdir(join(mainPath, 'app', '.git'), { recursive: true })
  await writeFile(join(mainPath, 'app', 'README.md'), 'golden\n')
}

function repoManagedGroup(parentPath: string, overrides: Partial<ProjectGroup> = {}): ProjectGroup {
  return {
    id: 'group-1',
    name: 'AOSP',
    parentPath,
    connectionId: null,
    parentGroupId: null,
    createdFrom: 'repo-managed',
    tabOrder: 0,
    isCollapsed: false,
    color: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

function folderWorkspace(overrides: Partial<FolderWorkspace> = {}): FolderWorkspace {
  return {
    id: 'ws-1',
    projectGroupId: 'group-1',
    name: 'AOSP workspace',
    folderPath: '/tmp/task-a',
    connectionId: null,
    linkedTask: null,
    comment: '',
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 1,
    lastActivityAt: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}


describe('createRepoManagedSnapshot', () => {
  it('parses chunked WSL worktree and linking progress', () => {
    const phases: string[] = []
    const progress: Array<{ currentProject: string; processedProjects: number }> = []
    const parse = createRepoSnapshotProgressParser({
      totalProjects: 2,
      onPhase: (phase) => phases.push(phase),
      onProgress: (value) => progress.push(value)
    })

    parse('__ORCA_REPO_WORKTREE_DONE__app\n__ORCA_REPO_WORK')
    parse('TREE_DONE__libs/core\n__ORCA_REPO_LINKING__\n')

    expect(progress).toEqual([
      { currentProject: 'app', processedProjects: 1, totalProjects: 2 },
      { currentProject: 'libs/core', processedProjects: 2, totalProjects: 2 }
    ])
    expect(phases).toEqual(['linking'])
  })

  it('enumerates normalized unique project paths safely', async () => {
    const root = await tempRoot()
    await mkdir(join(root, '.repo'), { recursive: true })
    await writeFile(join(root, '.repo', 'project.list'), 'app\n# comment\nlibs/core\napp\n')
    await expect(readRepoManagedProjectPaths(root)).resolves.toEqual(['app', 'libs/core'])
    await writeFile(join(root, '.repo', 'project.list'), '../escape\n')
    await expect(readRepoManagedProjectPaths(root)).rejects.toThrow(/Unsafe repo project path/)
  })

  it('creates one worktree per project, hardlinks files, omits .repo, and writes metadata', async () => {
    const root = await tempRoot()
    const mainPath = join(root, 'main')
    const destPath = join(root, 'task-a')
    await writeMinimalRepoTree(mainPath)
    const sourceFile = join(mainPath, 'app', 'README.md')

    const result = await createRepoManagedSnapshot({ mainPath, destPath, topic: 'feature/task-a' })

    const { gitExecFileAsync } = await import('../git/runner')
    expect(vi.mocked(gitExecFileAsync)).toHaveBeenCalledWith(
      [
        'worktree',
        'add',
        '--no-checkout',
        '--no-track',
        '-b',
        'feature-task-a',
        join(destPath, 'app'),
        'HEAD'
      ],
      { cwd: join(mainPath, 'app'), signal: undefined }
    )
    await expect(stat(join(destPath, '.repo'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await stat(sourceFile)).ino).toBe((await stat(join(destPath, 'app', 'README.md'))).ino)
    expect(JSON.parse(await readFile(result.metadataPath, 'utf8'))).toMatchObject({
      version: 1,
      topic: 'feature-task-a',
      projectPaths: ['app']
    })
    expect(result.metadataPath).toBe(join(destPath, REPO_MANAGED_SNAPSHOT_METADATA))
  })

  it('removes registered partial worktrees and destination after failure', async () => {
    const root = await tempRoot()
    const mainPath = join(root, 'main')
    const destPath = join(root, 'task-a')
    await writeMinimalRepoTree(mainPath)
    await mkdir(join(mainPath, 'second', '.git'), { recursive: true })
    await writeFile(join(mainPath, 'second', 'README.md'), 'second\n')
    await writeFile(join(mainPath, '.repo', 'project.list'), 'app\nsecond\n')
    const { gitExecFileAsync } = await import('../git/runner')
    vi.mocked(gitExecFileAsync).mockImplementation(async (command) => {
      if (command[0] === 'worktree' && command.includes(join(destPath, 'second'))) {
        throw new Error('worktree failed')
      }
      return { stdout: '', stderr: '' }
    })

    await expect(createRepoManagedSnapshot({ mainPath, destPath, topic: 'task-a' })).rejects.toThrow(
      'worktree failed'
    )
    expect(vi.mocked(gitExecFileAsync)).toHaveBeenCalledWith(
      ['worktree', 'remove', '--force', join(destPath, 'app')],
      { cwd: join(mainPath, 'app') }
    )
    await expect(stat(destPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses to overwrite an existing destination', async () => {
    const root = await tempRoot()
    const mainPath = join(root, 'main')
    const destPath = join(root, 'task-a')
    await writeMinimalRepoTree(mainPath)
    await mkdir(destPath, { recursive: true })
    await expect(createRepoManagedSnapshot({ mainPath, destPath })).rejects.toThrow(
      `Derive destination already exists: ${destPath}`
    )
  })
})

describe('seedDerivedRepoProjectGitDirs', () => {
  it('clones by reference from the main working trees and publishes origin heads', async () => {
    const root = await tempRoot()
    const mainPath = join(root, 'main')
    const destPath = join(root, 'task-a')
    await mkdir(join(mainPath, '.repo'), { recursive: true })
    await mkdir(join(mainPath, 'bionic', '.git'), { recursive: true })
    await writeFile(join(mainPath, '.repo', 'project.list'), 'bionic\n')
    await mkdir(destPath, { recursive: true })

    const { gitExecFileAsync } = await import('../git/runner')
    await seedDerivedRepoProjectGitDirs({ mainPath, destPath })

    const destGit = join(destPath, '.repo', 'projects', 'bionic.git')
    const sourceGit = join(mainPath, 'bionic', '.git')
    const timeoutOptions = { cwd: destPath, timeout: 120_000 }
    expect(vi.mocked(gitExecFileAsync)).toHaveBeenCalledWith(
      ['clone', '--bare', '--no-local', '--reference', sourceGit, sourceGit, destGit],
      timeoutOptions
    )
    expect(
      vi.mocked(gitExecFileAsync).mock.calls.some((call) => call[0].includes('--shared'))
    ).toBe(false)
    expect(vi.mocked(gitExecFileAsync)).toHaveBeenCalledWith(
      ['--git-dir', destGit, 'config', 'core.bare', 'false'],
      timeoutOptions
    )
    expect(vi.mocked(gitExecFileAsync)).toHaveBeenCalledWith(
      [
        '--git-dir',
        destGit,
        'config',
        'remote.origin.fetch',
        '+refs/heads/*:refs/remotes/origin/*'
      ],
      timeoutOptions
    )
    expect(vi.mocked(gitExecFileAsync)).toHaveBeenCalledWith(
      [
        '--git-dir',
        destGit,
        'fetch',
        '--no-tags',
        sourceGit,
        '+refs/heads/*:refs/remotes/origin/*'
      ],
      timeoutOptions
    )
    expect(vi.mocked(gitExecFileAsync)).toHaveBeenCalledWith(
      [
        '--git-dir',
        destGit,
        'fetch',
        '--no-tags',
        sourceGit,
        '+refs/remotes/origin/*:refs/remotes/origin/*'
      ],
      timeoutOptions
    )
    expect(vi.mocked(gitExecFileAsync)).toHaveBeenCalledWith(
      ['--git-dir', destGit, 'update-ref', 'refs/remotes/origin/main', 'refs/heads/main'],
      timeoutOptions
    )
  })

  it('seeds from the object farm instead of a gitfile worktree', async () => {
    const root = await tempRoot()
    const mainPath = join(root, 'main')
    const destPath = join(root, 'task-a')
    const farm = join(mainPath, '.repo', 'projects', 'frameworks', 'base.git')
    await mkdir(farm, { recursive: true })
    await mkdir(join(mainPath, 'frameworks', 'base'), { recursive: true })
    await writeFile(
      join(mainPath, 'frameworks', 'base', '.git'),
      'gitdir: ../../.repo/projects/frameworks/base.git\n'
    )
    await writeFile(join(mainPath, '.repo', 'project.list'), 'frameworks/base\n')
    await mkdir(destPath, { recursive: true })

    const { gitExecFileAsync } = await import('../git/runner')
    await seedDerivedRepoProjectGitDirs({ mainPath, destPath })

    const destGit = join(destPath, '.repo', 'projects', 'frameworks', 'base.git')
    expect(vi.mocked(gitExecFileAsync)).toHaveBeenCalledWith(
      ['clone', '--bare', '--no-local', '--reference', farm, farm, destGit],
      { cwd: destPath, timeout: 120_000 }
    )
    expect(
      vi
        .mocked(gitExecFileAsync)
        .mock.calls.some((call) => call[0].includes(join(mainPath, 'frameworks', 'base', '.git')))
    ).toBe(false)
  })

  it('prefers the destination project.list after repo init', async () => {
    const root = await tempRoot()
    const mainPath = join(root, 'main')
    const destPath = join(root, 'task-a')
    await mkdir(join(mainPath, '.repo'), { recursive: true })
    await mkdir(join(mainPath, 'bionic', '.git'), { recursive: true })
    await mkdir(join(mainPath, 'art', '.git'), { recursive: true })
    await writeFile(join(mainPath, '.repo', 'project.list'), 'bionic\nart\n')
    await mkdir(join(destPath, '.repo'), { recursive: true })
    await writeFile(join(destPath, '.repo', 'project.list'), 'bionic\n')

    const { gitExecFileAsync } = await import('../git/runner')
    await seedDerivedRepoProjectGitDirs({ mainPath, destPath })

    const cloneCalls = vi
      .mocked(gitExecFileAsync)
      .mock.calls.filter((call) => call[0][0] === 'clone')
    expect(cloneCalls).toHaveLength(1)
    expect(cloneCalls[0]?.[0].at(-1)).toBe(join(destPath, '.repo', 'projects', 'bionic.git'))
  })

  it('skips projects without local objects and still seeds the rest', async () => {
    const root = await tempRoot()
    const mainPath = join(root, 'main')
    const destPath = join(root, 'task-a')
    await mkdir(join(mainPath, '.repo'), { recursive: true })
    await mkdir(join(mainPath, 'bionic', '.git'), { recursive: true })
    await writeFile(join(mainPath, '.repo', 'project.list'), 'missing\nbionic\n')
    await mkdir(destPath, { recursive: true })

    await expect(seedDerivedRepoProjectGitDirs({ mainPath, destPath })).resolves.toBe(1)
  })

  it('does not re-clone an existing destination gitdir but still publishes origin refs', async () => {
    const root = await tempRoot()
    const mainPath = join(root, 'main')
    const destPath = join(root, 'task-a')
    const destGit = join(destPath, '.repo', 'projects', 'bionic.git')
    await mkdir(join(mainPath, '.repo'), { recursive: true })
    await mkdir(join(mainPath, 'bionic', '.git'), { recursive: true })
    await writeFile(join(mainPath, '.repo', 'project.list'), 'bionic\n')
    await mkdir(destGit, { recursive: true })

    const { gitExecFileAsync } = await import('../git/runner')
    await seedDerivedRepoProjectGitDirs({ mainPath, destPath })

    expect(vi.mocked(gitExecFileAsync).mock.calls.some((call) => call[0][0] === 'clone')).toBe(
      false
    )
    expect(vi.mocked(gitExecFileAsync)).toHaveBeenCalledWith(
      ['--git-dir', destGit, 'update-ref', 'refs/remotes/origin/main', 'refs/heads/main'],
      { cwd: destPath, timeout: 120_000 }
    )
  })

  it('fails when the manifest lists projects but none have local git objects', async () => {
    const root = await tempRoot()
    const mainPath = join(root, 'main')
    const destPath = join(root, 'task-a')
    await mkdir(join(mainPath, '.repo'), { recursive: true })
    await writeFile(join(mainPath, '.repo', 'project.list'), 'bionic\n')
    await mkdir(destPath, { recursive: true })

    await expect(seedDerivedRepoProjectGitDirs({ mainPath, destPath })).rejects.toThrow(
      REPO_MANAGED_LOCAL_OBJECTS_MISSING
    )
  })
})

describe('deriveRepoManagedFolderWorkspace', () => {
  it('rejects SSH-backed repo groups', async () => {
    await expect(
      deriveRepoManagedFolderWorkspace({
        store: {
          getSettings: () => ({ nestWorkspaces: true, workspaceDir: '/tmp/workspaces' }),
          getProjectGroups: () => [repoManagedGroup('/src/aosp', { connectionId: 'ssh-1' })],
          createFolderWorkspace: () => {
            throw new Error('should not create')
          }
        },
        projectGroupId: 'group-1'
      })
    ).rejects.toThrow(REPO_MANAGED_DERIVE_SSH_UNSUPPORTED)
  })

  it('rejects groups that are not repo-managed checkouts', async () => {
    await expect(
      deriveRepoManagedFolderWorkspace({
        store: {
          getSettings: () => ({ nestWorkspaces: true, workspaceDir: '/tmp/workspaces' }),
          getProjectGroups: () => [repoManagedGroup('/src/app', { createdFrom: 'folder-scan' })],
          createFolderWorkspace: () => {
            throw new Error('should not create')
          }
        },
        projectGroupId: 'group-1'
      })
    ).rejects.toThrow(REPO_MANAGED_GROUP_REQUIRED)
  })

  it('rejects a missing project group', async () => {
    await expect(
      deriveRepoManagedFolderWorkspace({
        store: {
          getSettings: () => ({ nestWorkspaces: true, workspaceDir: '/tmp/workspaces' }),
          getProjectGroups: () => [],
          createFolderWorkspace: () => {
            throw new Error('should not create')
          }
        },
        projectGroupId: 'missing'
      })
    ).rejects.toThrow(REPO_MANAGED_GROUP_REQUIRED)
  })

  it('materializes a checkout then registers the folder workspace', async () => {
    const root = await tempRoot()
    const mainPath = join(root, 'main')
    const workspaceDir = join(root, 'workspaces')
    await writeMinimalRepoTree(mainPath)
    await mkdir(workspaceDir, { recursive: true })
    const phases: string[] = []
    const created: FolderWorkspace[] = []

    const workspace = await deriveRepoManagedFolderWorkspace({
      store: {
        getSettings: () => ({ nestWorkspaces: false, workspaceDir }),
        getProjectGroups: () => [repoManagedGroup(mainPath)],
        createFolderWorkspace: (input) => {
          const next = folderWorkspace({
            folderPath: input.folderPath ?? '',
            name: input.name ?? 'workspace',
            projectGroupId: input.projectGroupId
          })
          created.push(next)
          return next
        }
      },
      projectGroupId: 'group-1',
      name: 'task a',
      onPhase: (phase) => {
        phases.push(phase)
      },
      runCommand: async () => ({ code: 0, stdout: '', stderr: '' })
    })

    expect(phases).toEqual(['preparing', 'worktrees', 'linking', 'register'])
    expect(workspace.folderPath).toBe(join(workspaceDir, 'task-a'))
    expect(created).toHaveLength(1)
    await expect(stat(workspace.folderPath)).resolves.toBeTruthy()
  })

  it('derives WSL snapshots beside the golden checkout when desktop workspaceDir is local', async () => {
    const mainPath = String.raw`\\wsl.localhost\Ubuntu-24.04\home\miles\golden`

    await expect(
      resolveRepoManagedSnapshotPath({
        mainPath,
        workspaceName: 'task a',
        settings: {
          nestWorkspaces: false,
          workspaceDir: String.raw`C:\Users\miles\orca\workspaces`
        }
      })
    ).resolves.toBe(String.raw`\\wsl.localhost\Ubuntu-24.04\home\miles\task-a`)
  })

})
