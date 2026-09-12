import type { TaskPageComposerActionsModel } from '../../use-task-page-composer-actions'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { LoaderCircle, Plus, RefreshCw } from 'lucide-react'
export function TaskPageGitLabFilters({
  model
}: {
  model: TaskPageComposerActionsModel
}): React.JSX.Element | null {
  const {
    eligibleRepos,
    gitLabIssueFilters,
    gitLabMRFilters,
    setGitlabFilter,
    gitlabLoading,
    setGitlabRefreshNonce,
    gitlabView,
    setGitlabView,
    gitlabTodosLoading,
    activeGitlabFilter,
    configuredGitLabProjects,
    gitlabProjectScope,
    setGitlabProjectScope,
    gitlabExecutionRepo,
    setGitlabExecutionRepoId
  } = model
  const openGitLabProjectSettings = (): void => {
    const state = useAppStore.getState()
    state.openSettingsTarget({ pane: 'general', repoId: null, sectionId: 'gitlab-projects' })
    state.openSettingsPage()
  }
  return (
    <>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 text-xs">
          {(['issues', 'mrs', 'todos'] as const).map((view) => {
            const active = gitlabView === view
            const label = view === 'issues' ? 'Issues' : view === 'mrs' ? 'MRs' : 'My Todos'
            return (
              <button
                key={view}
                type="button"
                onClick={() => setGitlabView(view)}
                className={cn(
                  'rounded-md border px-2.5 py-1 text-xs transition',
                  active
                    ? 'border-foreground/40 bg-foreground/90 text-background'
                    : 'border-border/50 bg-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                )}
              >
                {label}
              </button>
            )
          })}
        </div>
        {configuredGitLabProjects.length > 0 && gitlabView !== 'todos' ? (
          <Select value={gitlabProjectScope} onValueChange={setGitlabProjectScope}>
            <SelectTrigger className="h-8 w-[220px] rounded-md border-border/50 bg-muted/50 text-xs font-medium shadow-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All configured GitLab projects</SelectItem>
              {configuredGitLabProjects.map((project) => (
                <SelectItem key={`${project.host}/${project.path}`} value={`${project.host}/${project.path}`}>
                  {project.path}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {eligibleRepos.length > 0 ? (
          <Select value={gitlabExecutionRepo?.id ?? undefined} onValueChange={setGitlabExecutionRepoId}>
            <SelectTrigger className="h-8 w-[240px] rounded-md border-border/50 bg-muted/50 text-xs font-medium shadow-sm" aria-label="GitLab read location">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {eligibleRepos.map((repo) => (
                <SelectItem key={repo.id} value={repo.id}>Read via {repo.displayName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" variant="outline" size="icon-sm" onClick={openGitLabProjectSettings} aria-label="Add GitLab project" className="h-8 w-8 border-border/50 bg-muted/50">
              <Plus className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={6}>Add GitLab project</TooltipContent>
        </Tooltip>
      </div>
      <div
        className="min-w-0 rounded-md rounded-b-none border border-border/50 bg-muted/50 px-3 pt-2 pb-0 shadow-sm"
        data-contextual-tour-target="tasks-search-presets"
      >
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-2">
              {gitlabView === 'issues' || gitlabView === 'mrs'
                ? (gitlabView === 'issues' ? gitLabIssueFilters : gitLabMRFilters).map(
                    ({ id, label }) => {
                      const active = activeGitlabFilter === id
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => {
                            setGitlabFilter(id)
                            setGitlabRefreshNonce((n) => n + 1)
                          }}
                          className={cn(
                            'rounded-md border px-2 py-1 text-xs transition',
                            active
                              ? 'border-border/50 bg-foreground/90 text-background backdrop-blur-md'
                              : 'border-border/50 bg-transparent text-foreground hover:bg-muted/50'
                          )}
                        >
                          {label}
                        </button>
                      )
                    }
                  )
                : null}
            </div>
          </div>
          <div
            className="flex shrink-0 items-center gap-2"
            data-contextual-tour-target="tasks-actions"
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setGitlabRefreshNonce((n) => n + 1)}
                  disabled={gitlabLoading || gitlabTodosLoading}
                  aria-label={
                    gitlabView === 'todos'
                      ? translate('auto.components.TaskPage.c679af7ad9', 'Refresh My Todos')
                      : translate(
                          'auto.components.TaskPage.d4c2830063',
                          'Refresh GitLab work items'
                        )
                  }
                  className="border-border/50 bg-transparent hover:bg-muted/50 backdrop-blur-md supports-[backdrop-filter]:bg-transparent"
                >
                  {gitlabLoading || gitlabTodosLoading ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <RefreshCw className="size-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={6}>
                {gitlabView === 'todos'
                  ? translate('auto.components.TaskPage.c679af7ad9', 'Refresh My Todos')
                  : translate('auto.components.TaskPage.d4c2830063', 'Refresh GitLab work items')}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>
    </>
  )
}
