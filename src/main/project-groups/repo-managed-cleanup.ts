import { rm } from 'node:fs/promises'
import type { FolderWorkspace } from '../../shared/folder-workspace-types'
import type { ProjectGroup } from '../../shared/project-group-types'
import { isDerivedRepoManagedWorkspace } from '../../shared/repo-managed-project'
import { runProcess } from '../../shared/child-process/run-process'
import { buildWslExecArgs } from '../../shared/wsl-login-shell-command'
import { parseWslPath } from '../wsl'

export { isDerivedRepoManagedWorkspace }

export async function deleteFolderWorkspaceWithDerivedRepo(args: {
  folderWorkspaceId: string
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
  if (isDerivedRepoManagedWorkspace({ workspace, group })) {
    await args.removePath(
      workspace.folderPath,
      workspace.connectionId ?? group?.connectionId ?? null
    )
  }
  return args.removeFolderWorkspace(args.folderWorkspaceId)
}

export async function removeDerivedRepoPath(path: string): Promise<void> {
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
