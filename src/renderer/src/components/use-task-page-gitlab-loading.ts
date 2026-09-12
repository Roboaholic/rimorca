import type { TaskPageProviderMetadataModel } from './use-task-page-provider-metadata'
import { useEffect } from 'react'
import type { GitLabWorkItem, GitLabTodo } from '../../../shared/gitlab-types'
import {
  getTaskPageRepoSourceContext,
  isGitLabIssueFilter,
  isGitLabMRFilter
} from './task-page-source-context'
export function useTaskPageGitLabLoading(model: TaskPageProviderMetadataModel) {
  const {
    selectedRepos,
    selectedReposKey,
    primaryRepo,
    taskSource,
    setGitlabItems,
    setGitlabLoading,
    setGitlabError,
    gitlabRefreshNonce,
    gitlabView,
    setGitlabTodos,
    setGitlabTodosLoading,
    activeGitlabFilter,
    selectedConfiguredGitLabProjects,
    gitlabExecutionRepo,
    taskSourceHostAvailability
  } = model
  useEffect(() => {
    if (taskSource !== 'gitlab' || gitlabView === 'todos') {
      return
    }
    const activeIssueFilter =
      gitlabView === 'issues' && isGitLabIssueFilter(activeGitlabFilter) ? activeGitlabFilter : null
    const activeMRFilter =
      gitlabView === 'mrs' && isGitLabMRFilter(activeGitlabFilter) ? activeGitlabFilter : null
    if (!activeIssueFilter && !activeMRFilter) {
      return
    }
    if (taskSourceHostAvailability.length > 0) {
      setGitlabItems([])
      setGitlabLoading(false)
      return
    }
    const anchorRepo = gitlabExecutionRepo
    const explicitTargets = anchorRepo
      ? selectedConfiguredGitLabProjects.map((projectRef) => ({ repo: anchorRepo, projectRef }))
      : []
    const targets =
      explicitTargets.length > 0
        ? explicitTargets
        : selectedRepos.map((repo) => ({ repo, projectRef: null }))
    if (targets.length === 0) {
      setGitlabItems([])
      setGitlabLoading(false)
      setGitlabError(null)
      return
    }
    let stale = false
    setGitlabLoading(true)
    setGitlabError(null)
    const fetchItems = async (target: (typeof targets)[0]) => {
      const { repo, projectRef } = target
      const result =
        gitlabView === 'issues'
          ? await window.api.gl.listIssues({
              repoPath: repo.path,
              repoId: repo.id,
              sourceContext: getTaskPageRepoSourceContext(repo, 'gitlab', projectRef),
              projectRef,
              state: 'opened',
              assignee: activeIssueFilter === 'assigned-to-me' ? '@me' : undefined,
              limit: 50
            })
          : await window.api.gl.listWorkItems({
              repoPath: repo.path,
              repoId: repo.id,
              sourceContext: getTaskPageRepoSourceContext(repo, 'gitlab', projectRef),
              projectRef,
              state: activeMRFilter ?? 'opened',
              page: 1,
              perPage: 50
            })
      const typed = result as {
        items: GitLabWorkItem[]
        error?: { type?: string; message: string }
      }
      return { repoId: repo.id, projectRef, items: typed.items, error: typed.error }
    }
    void Promise.allSettled(targets.map(fetchItems))
      .then((results) => {
        if (stale) return
        const merged: GitLabWorkItem[] = []
        const errors: string[] = []
        for (const result of results) {
          if (result.status !== 'fulfilled') {
            errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason))
            continue
          }
          merged.push(
            ...result.value.items.map((item) => ({
              ...item,
              repoId: result.value.repoId,
              ...(result.value.projectRef ? { projectRef: result.value.projectRef } : {})
            }))
          )
          if (result.value.error?.type !== 'not_found' && result.value.error) {
            errors.push(result.value.error.message)
          }
        }
        merged.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
        setGitlabItems(merged)
        if (errors.length > 0 && merged.length === 0) setGitlabError(errors[0])
      })
      .finally(() => {
        if (!stale) setGitlabLoading(false)
      })
    return () => {
      stale = true
    }
  }, [
    activeGitlabFilter,
    gitlabExecutionRepo,
    gitlabRefreshNonce,
    gitlabView,
    selectedConfiguredGitLabProjects,
    selectedRepos,
    selectedReposKey,
    setGitlabError,
    setGitlabItems,
    setGitlabLoading,
    taskSource,
    taskSourceHostAvailability
  ])
  // Why: Todos fetch has its own effect — different trigger (no chip filter) and data path (gl.todos is user-scoped, not repo-scoped).
  useEffect(() => {
    if (taskSource !== 'gitlab' || gitlabView !== 'todos') {
      return
    }
    if (!gitlabExecutionRepo?.path || taskSourceHostAvailability.length > 0) {
      setGitlabTodos([])
      setGitlabTodosLoading(false)
      return
    }
    let stale = false
    setGitlabTodosLoading(true)
    void window.api.gl
      .todos({
        repoPath: gitlabExecutionRepo.path,
        repoId: gitlabExecutionRepo.id,
        sourceContext: getTaskPageRepoSourceContext(gitlabExecutionRepo, 'gitlab')
      })
      .then((todos) => {
        if (!stale) {
          setGitlabTodos(todos as GitLabTodo[])
        }
      })
      .catch(() => {
        if (!stale) {
          setGitlabTodos([])
        }
      })
      .finally(() => {
        if (!stale) {
          setGitlabTodosLoading(false)
        }
      })
    return () => {
      stale = true
    }
  }, [
    taskSource,
    gitlabView,
    gitlabRefreshNonce,
    gitlabExecutionRepo,
    setGitlabTodosLoading,
    setGitlabTodos,
    taskSourceHostAvailability
  ])
  return model
}
export type TaskPageGitLabLoadingModel = ReturnType<typeof useTaskPageGitLabLoading>
