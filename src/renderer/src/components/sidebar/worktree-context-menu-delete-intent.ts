import { runWorktreeBatchDelete, runWorktreeDelete } from './delete-worktree-flow'
import type { WorktreeDeleteIdentity } from './worktree-delete-request'
import type { Worktree } from '../../../../shared/worktree/types'
import type { ConfirmationDialogContextValue } from '@/components/confirmation-dialog-context'
import { runFolderWorkspaceDelete } from './delete-folder-workspace-flow'

import type { AppState } from '@/store/types'
import { useAppStore } from '@/store'
import { folderWorkspaceKey } from '../../../../shared/workspace-scope'
export type WorktreeContextMenuDeleteIntent =
  | { kind: 'worktree'; worktree: WorktreeDeleteIdentity }
  | { kind: 'batch'; worktrees: readonly WorktreeDeleteIdentity[] }
  | { kind: 'folder'; folderWorkspaceId: string }

export function createWorktreeContextMenuDeleteIntent(args: {
  worktree: Pick<Worktree, 'id' | 'instanceId' | 'hostId'>
  batchDeleteWorktrees: readonly Pick<Worktree, 'id' | 'instanceId' | 'hostId'>[]
  isMultiContext: boolean
  folderWorkspaceId?: string
}): WorktreeContextMenuDeleteIntent {
  if (args.isMultiContext) {
    return {
      kind: 'batch',
      worktrees: args.batchDeleteWorktrees.map(({ id, instanceId, hostId }) => ({
        id,
        instanceId,
        hostId
      }))
    }
  }
  if (args.folderWorkspaceId) {
    return { kind: 'folder', folderWorkspaceId: args.folderWorkspaceId }
  }
  const { id, instanceId, hostId } = args.worktree
  return { kind: 'worktree', worktree: { id, instanceId, hostId } }
}

export function runWorktreeContextMenuDeleteIntent(
  intent: WorktreeContextMenuDeleteIntent,
  confirm?: ConfirmationDialogContextValue
): void {
  if (intent.kind === 'batch') {
    runWorktreeBatchDelete(intent.worktrees)
    return
  }
  if (intent.kind === 'worktree') {
    runWorktreeDelete(intent.worktree.id, {
      expectedInstanceId: intent.worktree.instanceId,
      ...(intent.worktree.hostId ? { expectedHostId: intent.worktree.hostId } : {})
    })
    return
  }
  if (confirm) {
    void runFolderWorkspaceDelete({ folderWorkspaceId: intent.folderWorkspaceId, confirm })
    return
  }
  const state = useAppStore.getState() as AppState
  void state
    .deleteFolderWorkspace(intent.folderWorkspaceId, { deleteFiles: false })
    .then((deleted) => {
      const current = useAppStore.getState()
      if (deleted && current.activeWorktreeId === folderWorkspaceKey(intent.folderWorkspaceId)) {
        current.setActiveWorktree(null)
      }
    })
}

export function deferWorktreeContextMenuDeleteIntent(
  intent: WorktreeContextMenuDeleteIntent,
  onDispatched?: () => void,
  defer: (callback: () => void) => void = (callback) => window.setTimeout(callback, 0),
  confirm?: ConfirmationDialogContextValue
): void {
  defer(() => {
    runWorktreeContextMenuDeleteIntent(intent, confirm)
    onDispatched?.()
  })
}
