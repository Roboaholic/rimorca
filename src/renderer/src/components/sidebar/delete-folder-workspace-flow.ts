import type { ConfirmationDialogContextValue } from '@/components/confirmation-dialog-context'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { folderWorkspaceKey } from '../../../../shared/workspace-scope'
import type { ExecutionHostId } from '../../../../shared/execution-host'

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


  const deleted = await state.deleteFolderWorkspace(args.folderWorkspaceId, {
    executionHostId: args.executionHostId
  })
  const current = useAppStore.getState()
  if (deleted && current.activeWorktreeId === folderWorkspaceKey(args.folderWorkspaceId)) {
    current.setActiveWorktree(null)
  }
  return deleted
}
