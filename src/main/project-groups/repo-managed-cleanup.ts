import { readFile, rm } from 'node:fs/promises'
import type { FolderWorkspace } from '../../shared/folder-workspace-types'
import type { ProjectGroup } from '../../shared/project-group-types'
import { isDerivedRepoManagedWorkspace } from '../../shared/repo-managed-project'
import { runProcess } from '../../shared/child-process/run-process'
import { buildWslExecArgs } from '../../shared/wsl-login-shell-command'
import { parseWslPath } from '../wsl'
import { join } from 'node:path'
import { gitExecFileAsync } from '../git/runner'

const REPO_MANAGED_SNAPSHOT_METADATA = '.orca-repo-snapshot.json'
type RepoManagedSnapshotMetadata = {
  version: 1
  sourcePath: string
  topic: string
  projectPaths: string[]
}

export { isDerivedRepoManagedWorkspace }

export async function deleteFolderWorkspaceWithDerivedRepo(args: {
  folderWorkspaceId: string
  deleteFiles?: boolean
  getFolderWorkspace: (id: string) => FolderWorkspace | undefined
  getProjectGroups: () => ProjectGroup[]
  removeFolderWorkspace: (id: string) => boolean
  removePath: (path: string, connectionId: string | null) => Promise<void>
}): Promise<boolean> {
  const workspace = args.getFolderWorkspace(args.folderWorkspaceId)
  if (!workspace) {
    return false
  }
  const group = args.getProjectGroups().find((entry) => entry.id === workspace.projectGroupId)
  if (args.deleteFiles === true && isDerivedRepoManagedWorkspace({ workspace, group })) {
    await args.removePath(
      workspace.folderPath,
      workspace.connectionId ?? group?.connectionId ?? null
    )
  }
  return args.removeFolderWorkspace(args.folderWorkspaceId)
}

async function readSnapshotMetadata(path: string): Promise<RepoManagedSnapshotMetadata | null> {
  try {
    const parsed = JSON.parse(
      await readFile(join(path, REPO_MANAGED_SNAPSHOT_METADATA), 'utf8')
    ) as Partial<RepoManagedSnapshotMetadata>
    if (
      parsed.version !== 1 ||
      typeof parsed.sourcePath !== 'string' ||
      typeof parsed.topic !== 'string' ||
      !Array.isArray(parsed.projectPaths) ||
      !parsed.projectPaths.every((projectPath) => typeof projectPath === 'string')
    ) {
      throw new Error(`Invalid repo snapshot metadata at ${path}`)
    }
    return parsed as RepoManagedSnapshotMetadata
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
}

async function unregisterSnapshotWorktrees(
  path: string,
  metadata: RepoManagedSnapshotMetadata
): Promise<void> {
  for (const projectPath of metadata.projectPaths) {
    const sourceProject = join(metadata.sourcePath, ...projectPath.split('/'))
    const workspaceProject = join(path, ...projectPath.split('/'))
    await gitExecFileAsync(['worktree', 'remove', '--force', workspaceProject], {
      cwd: sourceProject
    })
    await gitExecFileAsync(['branch', '-D', metadata.topic], { cwd: sourceProject }).catch(() => {})
  }
}

export async function removeDerivedRepoPath(path: string): Promise<void> {
  const metadata = await readSnapshotMetadata(path)
  if (metadata) {
    await unregisterSnapshotWorktrees(path, metadata)
  }
  const wsl = parseWslPath(path)
  if (!wsl) {
    await rm(path, { recursive: true, force: true })
    return
  }
  await runProcess({
    program: 'wsl.exe',
    args: buildWslExecArgs(wsl.distro, ['/bin/rm', '-rf', '--', wsl.linuxPath]),
    timeoutMs: 120_000
  })
}
