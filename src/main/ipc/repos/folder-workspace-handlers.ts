import type { BrowserWindow } from 'electron'
import { ipcMain } from 'electron'
import { z } from 'zod'
import type { Store } from '../../persistence'
import type { FolderWorkspace } from '../../../shared/folder-workspace-types'
import type { FolderWorkspacePathStatusRequest } from '../../../shared/folder-workspace-path-status'
import {
  assertFolderWorkspacePathUsable,
  getFolderWorkspacePathStatus,
  getFolderWorkspacePathStatusForPath
} from '../../project-groups/folder-workspace-path-status'
import { deriveRepoManagedFolderWorkspace } from '../../project-groups/repo-managed-derive'
import { installRepoCli, probeRepoCli } from '../../project-groups/repo-managed-cli'
import { repoManagedDeriveProgress } from '../../../shared/repo-managed-derive-progress'
import type { RepoCliProbe } from '../../../shared/repo-managed-cli'
import { getSshFilesystemProvider } from '../../providers/ssh-filesystem-dispatch'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { notifyReposChanged } from './repos-changed-notification'
import {
  FolderWorkspaceCreateArgs,
  FolderWorkspacePathStatusArgs,
  FolderWorkspaceSelectorArgs,
  FolderWorkspaceUpdateArgs,
  parseProjectGroupIpcArgs
} from './repo-ipc-arg-schemas'

export function registerFolderWorkspaceHandlers(
  mainWindow: BrowserWindow,
  store: Store,
  runtime: OrcaRuntimeService
): void {
  ipcMain.handle('folderWorkspaces:list', (): FolderWorkspace[] => store.getFolderWorkspaces())

  ipcMain.handle('folderWorkspaces:getPathStatus', async (_event, rawArgs: unknown) => {
    const args = parseProjectGroupIpcArgs(
      FolderWorkspacePathStatusArgs,
      rawArgs,
      'invalid_folder_workspace_path_status_args'
    ) as FolderWorkspacePathStatusRequest
    return getFolderWorkspacePathStatus(store, args, { getSshFilesystemProvider })
  })

  ipcMain.handle(
    'folderWorkspaces:create',
    async (_event, rawArgs: unknown): Promise<FolderWorkspace> => {
      const args = parseProjectGroupIpcArgs(
        FolderWorkspaceCreateArgs,
        rawArgs,
        'invalid_folder_workspace_create_args'
      )
      const projectGroups = store.getProjectGroups()
      const group = projectGroups.find((entry) => entry.id === args.projectGroupId)
      const folderPath =
        typeof args.folderPath === 'string' && args.folderPath.trim().length > 0
          ? args.folderPath
          : group?.parentPath
      if (!group || !folderPath) {
        throw new Error('folder_workspace_project_group_not_found')
      }
      const status = await getFolderWorkspacePathStatusForPath(
        {
          folderPath,
          projectGroupId: group.id,
          connectionId: args.connectionId ?? group.connectionId ?? null,
          projectGroups,
          repos: store.getRepos()
        },
        { getSshFilesystemProvider }
      )
      assertFolderWorkspacePathUsable(status)
      const workspace = store.createFolderWorkspace({
        ...args,
        creatorProvenance: { kind: 'host' }
      })
      notifyReposChanged(mainWindow)
      return workspace
    }
  )

  ipcMain.handle(
    'folderWorkspaces:deriveRepoManaged',
    async (event, rawArgs: unknown): Promise<FolderWorkspace> => {
      const args = parseProjectGroupIpcArgs(
        FolderWorkspaceCreateArgs,
        rawArgs,
        'invalid_folder_workspace_derive_args'
      )
      const workspace = await deriveRepoManagedFolderWorkspace({
        store,
        projectGroupId: args.projectGroupId,
        name: args.name,
        connectionId: args.connectionId,
        linkedTask: args.linkedTask,
        linkedTaskSourceContext: args.linkedTaskSourceContext,
        createdWithAgent: args.createdWithAgent,
        pendingFirstAgentMessageRename: args.pendingFirstAgentMessageRename,
        onPhase: (phase) =>
          event.sender.send('folderWorkspaces:deriveProgress', repoManagedDeriveProgress(phase)),
        onSeedProgress: (progress) =>
          event.sender.send(
            'folderWorkspaces:deriveProgress',
            repoManagedDeriveProgress('worktrees', progress)
          ),
        onSyncProgress: () => {}
      })
      notifyReposChanged(mainWindow)
      return workspace
    }
  )

  ipcMain.handle(
    'folderWorkspaces:probeRepoCli',
    async (_event, rawArgs: unknown): Promise<RepoCliProbe> => {
      const args = parseProjectGroupIpcArgs(
        z.object({ mainPath: z.string().optional() }),
        rawArgs ?? {},
        'invalid_repo_cli_probe_args'
      )
      return probeRepoCli({ mainPath: args.mainPath })
    }
  )

  ipcMain.handle('folderWorkspaces:installRepoCli', async () => installRepoCli())

  ipcMain.handle(
    'folderWorkspaces:update',
    async (_event, rawArgs: unknown): Promise<FolderWorkspace | null> => {
      const args = parseProjectGroupIpcArgs(
        FolderWorkspaceUpdateArgs,
        rawArgs,
        'invalid_folder_workspace_update_args'
      )
      if (
        typeof args.updates.folderPath === 'string' &&
        args.updates.folderPath.trim().length > 0
      ) {
        const workspace = store.getFolderWorkspace(args.folderWorkspaceId)
        if (!workspace) {
          return null
        }
        const projectGroups = store.getProjectGroups()
        const status = await getFolderWorkspacePathStatusForPath(
          {
            folderPath: args.updates.folderPath,
            projectGroupId: workspace.projectGroupId,
            connectionId:
              workspace.connectionId ??
              projectGroups.find((entry) => entry.id === workspace.projectGroupId)?.connectionId ??
              null,
            projectGroups,
            repos: store.getRepos()
          },
          { getSshFilesystemProvider }
        )
        assertFolderWorkspacePathUsable(status)
      }
      const updated = store.updateFolderWorkspace(args.folderWorkspaceId, args.updates)
      if (updated) {
        notifyReposChanged(mainWindow)
      }
      return updated
    }
  )

  ipcMain.handle('folderWorkspaces:delete', async (_event, rawArgs: unknown): Promise<boolean> => {
    const args = parseProjectGroupIpcArgs(
      FolderWorkspaceSelectorArgs,
      rawArgs,
      'invalid_folder_workspace_delete_args'
    )
    return (
      await runtime.deleteFolderWorkspace(args.folderWorkspaceId, { deleteFiles: args.deleteFiles })
    ).deleted
  })
}
