import type { ConfirmationDialogContextValue } from '@/components/confirmation-dialog-context'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { isDerivedRepoManagedWorkspace } from '../../../../shared/repo-managed-project'
import { folderWorkspaceKey } from '../../../../shared/workspace-scope'
import type { ExecutionHostId } from '../../../../shared/execution-host'

export async function runFolderWorkspaceDelete(args: {
  folderWorkspaceId: string
  executionHostId?: ExecutionHostId
  confirm: ConfirmationDialogContextValue
}): Promise<boolean> {
  const state = useAppStore.getState()
  const workspace = state.folderWorkspaces.find((item) => item.id === args.folderWorkspaceId)
  const group = workspace
    ? state.projectGroups.find((item) => item.id === workspace.projectGroupId)
    : undefined
  if (!workspace) {
    return false
  }
  const confirmed = await args.confirm({
    title: translate(
      'auto.components.sidebar.folderWorkspaceDelete.removeTitle',
      'Remove workspace?'
    ),
    description: translate(
      'auto.components.sidebar.folderWorkspaceDelete.removeDescription',
      'This removes “{{name}}” from Orca.',
      { name: workspace.name }
    ),
    confirmLabel: translate('auto.components.sidebar.folderWorkspaceDelete.remove', 'Remove'),
    confirmVariant: 'destructive'
  })
  if (!confirmed) {
    return false
  }

  let deleteFiles = false
  if (isDerivedRepoManagedWorkspace({ workspace, group })) {
    deleteFiles = await args.confirm({
      title: translate(
        'auto.components.sidebar.folderWorkspaceDelete.filesTitle',
        'Delete workspace files?'
      ),
      description: translate(
        'auto.components.sidebar.folderWorkspaceDelete.filesDescription',
        'Delete the derived files at {{path}} and unregister its Git worktrees. Choose Keep files to remove only the Orca entry.',
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
    })
  }

  const deleted = await state.deleteFolderWorkspace(args.folderWorkspaceId, {
    executionHostId: args.executionHostId,
    deleteFiles
  })
  const current = useAppStore.getState()
  if (deleted && current.activeWorktreeId === folderWorkspaceKey(args.folderWorkspaceId)) {
    current.setActiveWorktree(null)
  }
  return deleted
}
