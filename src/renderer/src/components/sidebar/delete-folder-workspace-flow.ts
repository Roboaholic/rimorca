import type { ConfirmationDialogContextValue } from '@/components/confirmation-dialog-context'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { folderWorkspaceKey } from '../../../../shared/workspace-scope'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import { isDerivedRepoManagedWorkspace } from '../../../../shared/repo-managed-project'

export async function runFolderWorkspaceDelete(args: {
  folderWorkspaceId: string
  executionHostId?: ExecutionHostId
  confirm: ConfirmationDialogContextValue
}): Promise<boolean> {
  const state = useAppStore.getState()
  const workspace = state.folderWorkspaces.find((item) => item.id === args.folderWorkspaceId)
  if (!workspace) {
    return false
  }
  const group = state.projectGroups.find((item) => item.id === workspace.projectGroupId)
  const derived = isDerivedRepoManagedWorkspace({ workspace, group })
  const confirmed = await args.confirm({
    title: translate('auto.components.sidebar.folderWorkspaceDelete.removeTitle', 'Remove workspace?'),
    description: derived
      ? translate(
          'auto.components.sidebar.folderWorkspaceDelete.removeDerivedDescription',
          'Remove “{{name}}” from Orca? You can choose whether to permanently delete its source files next.',
          { name: workspace.name }
        )
      : translate(
          'auto.components.sidebar.folderWorkspaceDelete.removeDescription',
          'This removes “{{name}}” from Orca. Its source files stay in place.',
          { name: workspace.name }
        ),
    confirmLabel: translate('auto.components.sidebar.folderWorkspaceDelete.remove', 'Remove'),
    confirmVariant: 'destructive'
  })
  if (!confirmed) return false

  const deleteFiles =
    derived &&
    (await args.confirm({
      title: translate(
        'auto.components.sidebar.folderWorkspaceDelete.deleteFilesTitle',
        'Delete source files?'
      ),
      description: translate(
        'auto.components.sidebar.folderWorkspaceDelete.deleteFilesDescription',
        'Permanently delete “{{path}}” and unregister its repo worktrees? This cannot be undone. Cancel keeps the files.',
        { path: workspace.folderPath }
      ),
      confirmLabel: translate(
        'auto.components.sidebar.folderWorkspaceDelete.deleteFiles',
        'Delete files'
      ),
      cancelLabel: translate(
        'auto.components.sidebar.folderWorkspaceDelete.keepFiles',
        'Keep files'
      ),
      confirmVariant: 'destructive'
    }))

  const deleted = await state.deleteFolderWorkspace(args.folderWorkspaceId, {
    executionHostId: args.executionHostId,
    ...(deleteFiles ? { deleteFiles: true } : {})
  })
  const current = useAppStore.getState()
  if (deleted && current.activeWorktreeId === folderWorkspaceKey(args.folderWorkspaceId)) {
    current.setActiveWorktree(null)
  }
  return deleted
}
