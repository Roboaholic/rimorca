import { isFolderRepo } from '../../../../shared/repo-kind'
import { isRepoManagedProjectGroup } from '../../../../shared/repo-managed-project'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { OrchestrationError } from '../../orchestration/orchestration-error'

export async function assertOrchestrationWorktreeCreationSupported(args: {
  runtime: OrcaRuntimeService
  repoSelector: string
  existingPlacement: string
}): Promise<void> {
  const repo = await args.runtime.showRepo(args.repoSelector)
  if (!isFolderRepo(repo)) {
    return
  }
  const group = repo.projectGroupId
    ? args.runtime.listProjectGroups().find((candidate) => candidate.id === repo.projectGroupId)
    : undefined
  if (isRepoManagedProjectGroup(group)) {
    return
  }
  throw new OrchestrationError(
    'invalid_argument',
    `Folder projects cannot create orchestration worktrees; use ${args.existingPlacement}.`
  )
}
