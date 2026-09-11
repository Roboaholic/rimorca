import type { ComposerModel } from './composer-model'

type FolderSubmitOrchestrationInput = Pick<
  ComposerModel,
  | 'clearNewWorkspaceDraft'
  | 'createFolderWorkspace'
  | 'decisions'
  | 'disabledTuiAgents'
  | 'folderCreateDisabled'
  | 'deriveRepoManaged'
  | 'deriveRepoManagedFolderWorkspace'
  | 'folderWorkspaces'
  | 'repoCliProbe'
  | 'setDeriveProgress'
  | 'folderSourceRepos'
  | 'folderTargetConnectionId'
  | 'folderTargetIsRemote'
  | 'folderTargetRuntimeEnvironmentId'
  | 'isSubmissionCancelled'
  | 'lastAutoNameRef'
  | 'linkedWorkItem'
  | 'name'
  | 'note'
  | 'onCreated'
  | 'persistDraft'
  | 'resolvePendingSmartGitHubSubmit'
  | 'selectedProjectGroup'
  | 'setCreateError'
  | 'setCreating'
  | 'settings'
  | 'taskSourceContext'
  | 'telemetrySource'
>

import { useCallback } from 'react'
import type { TuiAgent } from '../../../../shared/tui-agent'
import { settleComposerSubmit } from '@/lib/composer-submit-cancellation'
import { resolveFolderWorkspaceCreateIntent } from '../../../../shared/repo-managed-project'
import { isTuiAgentEnabled } from '../../../../shared/tui-agent-selection'
import { submitFolderWorkspaceCreate } from '@/components/sidebar/folder-workspace-composer-submit'
import {
  resolveTuiAgentLaunchArgs,
  resolveTuiAgentLaunchEnv
} from '../../../../shared/tui-agent-launch-defaults'
import {
  formatWorkspaceCreateError,
  getWorkspaceCreateErrorToastMessage
} from '@/lib/workspace-create-error-format'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'

export function useFolderSubmitOrchestration(input: FolderSubmitOrchestrationInput) {
  const {
    clearNewWorkspaceDraft,
    createFolderWorkspace,
    deriveRepoManaged,
    deriveRepoManagedFolderWorkspace,
    decisions,
    disabledTuiAgents,
    folderCreateDisabled,
    folderSourceRepos,
    folderTargetIsRemote,
    folderTargetRuntimeEnvironmentId,
    folderWorkspaces,
    isSubmissionCancelled,
    lastAutoNameRef,
    linkedWorkItem,
    name,
    note,
    onCreated,
    persistDraft,
    repoCliProbe,
    resolvePendingSmartGitHubSubmit,
    selectedProjectGroup,
    setCreateError,
    setCreating,
    setDeriveProgress,
    settings,
    taskSourceContext,
    telemetrySource
  } = input
  const { canResolveFolderSmartGitHubSubmit } = decisions

  const effectiveFolderCreateDisabled =
    folderCreateDisabled || (deriveRepoManaged && repoCliProbe !== null && !repoCliProbe.available)
  const submitFolderTarget = useCallback(
    async (requestedAgent: TuiAgent | null): Promise<void> => {
      if (!selectedProjectGroup?.parentPath || effectiveFolderCreateDisabled) return
      setCreateError(null)
      setCreating(true)
      setDeriveProgress(null)
      try {
        const settlement = await settleComposerSubmit(
          canResolveFolderSmartGitHubSubmit({ hasFolderSourceRepos: folderSourceRepos.length > 0 })
            ? resolvePendingSmartGitHubSubmit()
            : Promise.resolve({ kind: 'none' } as const),
          isSubmissionCancelled
        )
        if (settlement.status === 'cancelled') return
        const metadata = settlement.value.kind === 'none' ? null : settlement.value
        const linked = metadata?.linkedWorkItem ?? linkedWorkItem
        const agent =
          requestedAgent && isTuiAgentEnabled(requestedAgent, disabledTuiAgents)
            ? requestedAgent
            : null
        const createIntent = resolveFolderWorkspaceCreateIntent({
          group: selectedProjectGroup,
          folderWorkspaces,
          deriveRepoManaged
        })
        const created = await submitFolderWorkspaceCreate({
          projectGroup: selectedProjectGroup,
          name: metadata?.workspaceName ?? name,
          lastAutoName: lastAutoNameRef.current,
          linkedWorkItem: linked,
          linkedTaskSourceContext: taskSourceContext,
          note,
          quickAgent: agent,
          autoRenameBranchFromWork: settings?.autoRenameBranchFromWork,
          agentCmdOverrides: settings?.agentCmdOverrides,
          agentArgs: agent
            ? resolveTuiAgentLaunchArgs(agent, settings?.agentDefaultArgs)
            : undefined,
          agentEnv: agent ? resolveTuiAgentLaunchEnv(agent, settings?.agentDefaultEnv) : undefined,
          terminalWindowsShell: settings?.terminalWindowsShell,
          isRemote: folderTargetIsRemote,
          launchSource: telemetrySource === 'onboarding' ? 'onboarding' : 'new_workspace_composer',
          runtimeEnvironmentId: folderTargetRuntimeEnvironmentId,
          deriveRepoManaged: createIntent.kind === 'derive',
          createFolderWorkspace: (input) =>
            createFolderWorkspace(input, {
              runtimeEnvironmentId: folderTargetRuntimeEnvironmentId
            }),
          deriveRepoManagedFolderWorkspace: (input) =>
            deriveRepoManagedFolderWorkspace(input, {
              runtimeEnvironmentId: folderTargetRuntimeEnvironmentId,
              onProgress: (progress) => setDeriveProgress(progress)
            }),
          onOpenChange: (open) => {
            if (!open) {
              if (persistDraft) clearNewWorkspaceDraft()
              onCreated?.()
            }
          }
        })
        if (!created) {
          setCreateError({
            title: translate(
              'auto.hooks.useComposerState.folderWorkspaceCreateFailedTitle',
              'Folder workspace creation failed'
            ),
            message: translate(
              'auto.hooks.useComposerState.folderWorkspaceCreateFailedMessage',
              'The folder workspace could not be created. Check the error details above, then try again.'
            )
          })
        }
      } catch (error) {
        if (!isSubmissionCancelled()) {
          const formattedError = formatWorkspaceCreateError(error)
          setCreateError(formattedError)
          toast.error(getWorkspaceCreateErrorToastMessage(formattedError))
        }
      } finally {
        setCreating(false)
        setDeriveProgress(null)
      }
    },
    [
      canResolveFolderSmartGitHubSubmit,
      clearNewWorkspaceDraft,
      createFolderWorkspace,
      deriveRepoManaged,
      deriveRepoManagedFolderWorkspace,
      disabledTuiAgents,
      effectiveFolderCreateDisabled,
      folderSourceRepos.length,
      folderTargetIsRemote,
      folderTargetRuntimeEnvironmentId,
      folderWorkspaces,
      isSubmissionCancelled,
      linkedWorkItem,
      name,
      note,
      onCreated,
      persistDraft,
      resolvePendingSmartGitHubSubmit,
      selectedProjectGroup,
      setCreateError,
      setCreating,
      setDeriveProgress,
      settings,
      taskSourceContext,
      telemetrySource,
      lastAutoNameRef,
      repoCliProbe
    ]
  )

  return {
    submitFolderTarget
  }
}
