import type { IpcMainInvokeEvent } from 'electron'
import { isAbsolute, posix } from 'node:path'
import type { z } from 'zod'
import type { NestedRepoScanResult } from '../../../shared/project-group-types'
import { normalizeRuntimePathForComparison } from '../../../shared/cross-platform-path'
import { awaitWindowsHostGitEnvironmentReady } from '../../git/runner'
import { scanNestedRepos } from '../../project-groups/nested-repo-discovery'
import { getSshGitProvider } from '../../providers/ssh-git-dispatch'
import { getSshFilesystemProvider } from '../../providers/ssh-filesystem-dispatch'
import { buildWslExecArgs } from '../../../shared/wsl-login-shell-command'
import { parseWslPath } from '../../wsl'
import { runProcess } from '../../../shared/child-process/run-process'
import { REPO_MANAGED_MARKERS, REPO_METADATA_DIR } from '../../../shared/repo-managed-project'
import { getActiveMultiplexer } from '../ssh'
import type { ProjectGroupScanNestedArgs } from './repo-ipc-arg-schemas'

export const activeNestedRepoScans = new Map<string, AbortController>()
type CompletedNestedRepoScan = {
  scan: NestedRepoScanResult
  parentPath: string
  connectionId: string | null
}
const completedNestedRepoScans = new Map<string, CompletedNestedRepoScan>()
const MAX_COMPLETED_NESTED_SCAN_RESULTS = 50

function validateNestedRepoScanRoot(path: string, connectionId?: string): void {
  if (connectionId) {
    return
  }
  if (!isAbsolute(path)) {
    throw new Error('Repo path must be an absolute path')
  }
}

function rememberCompletedNestedRepoScan(
  scanId: string | undefined,
  context: { parentPath: string; connectionId?: string },
  scan: NestedRepoScanResult
): void {
  if (!scanId) {
    return
  }
  completedNestedRepoScans.set(scanId, {
    scan,
    parentPath: scan.selectedPath,
    connectionId: context.connectionId ?? null
  })
  while (completedNestedRepoScans.size > MAX_COMPLETED_NESTED_SCAN_RESULTS) {
    const oldestScanId = completedNestedRepoScans.keys().next().value
    if (!oldestScanId) {
      break
    }
    completedNestedRepoScans.delete(oldestScanId)
  }
}

export function getCompletedNestedRepoScan(args: {
  scanId?: string
  parentPath: string
  connectionId?: string
}): NestedRepoScanResult | undefined {
  if (!args.scanId) {
    return undefined
  }
  const completed = completedNestedRepoScans.get(args.scanId)
  if (!completed) {
    return undefined
  }
  if (
    completed.connectionId !== (args.connectionId ?? null) ||
    normalizeRuntimePathForComparison(completed.parentPath) !==
      normalizeRuntimePathForComparison(args.parentPath)
  ) {
    return undefined
  }
  return completed.scan
}

async function resolveSshProjectGroupPath(connectionId: string, path: string): Promise<string> {
  if (path === '~' || path === '~/' || path.startsWith('~/')) {
    const mux = getActiveMultiplexer(connectionId)
    if (mux) {
      try {
        const result = (await mux.request('session.resolveHome', { path })) as {
          resolvedPath: string
        }
        return result.resolvedPath
      } catch {
        return path
      }
    }
  }
  return path
}

export async function pathLooksLikeRepoManagedRootInWsl(path: string): Promise<boolean> {
  const wsl = parseWslPath(path)
  if (!wsl) return false
  const result = await runProcess({
    program: 'wsl.exe',
    args: buildWslExecArgs(wsl.distro, [
      '/bin/sh',
      '-c',
      'test -d "$1/.repo" && { test -e "$1/.repo/manifest.xml" || test -e "$1/.repo/project.list"; }',
      'sh',
      wsl.linuxPath
    ]),
    timeoutMs: 5_000
  })
  return result.code === 0
}

export async function scanNestedReposForIpc(args: {
  path: string
  connectionId?: string
  options?: unknown
  signal?: AbortSignal
  onProgress?: (scan: NestedRepoScanResult) => void
}): Promise<NestedRepoScanResult> {
  if (!args.connectionId && (await pathLooksLikeRepoManagedRootInWsl(args.path))) {
    return {
      selectedPath: args.path,
      selectedPathKind: 'repo_managed',
      repos: [],
      truncated: false,
      timedOut: false,
      stopped: false,
      durationMs: 0,
      maxDepth: 0,
      maxRepos: 0,
      timeoutMs: null
    }
  }
  validateNestedRepoScanRoot(args.path, args.connectionId)
  if (!args.connectionId) {
    await awaitWindowsHostGitEnvironmentReady({
      cwd: args.path,
      ...(args.signal ? { signal: args.signal } : {})
    })
    return scanNestedRepos({
      path: args.path,
      options: args.options,
      signal: args.signal,
      onProgress: args.onProgress
    })
  }
  const gitProvider = getSshGitProvider(args.connectionId)
  const fsProvider = getSshFilesystemProvider(args.connectionId)
  if (!gitProvider || !fsProvider) {
    throw new Error('ssh_connection_unavailable')
  }
  const resolvedPath = await resolveSshProjectGroupPath(args.connectionId, args.path)
  return scanNestedRepos({
    path: resolvedPath,
    options: args.options,
    signal: args.signal,
    onProgress: args.onProgress,
    filesystem: {
      readDirectory: async (dirPath) =>
        (await fsProvider.readDir(dirPath)).map((entry) => ({
          name: entry.name,
          isDirectory: entry.isDirectory,
          isSymlink: entry.isSymlink
        })),
      readTextFile: async (filePath) => (await fsProvider.readFile(filePath)).content,
      joinPath: (parentPath, childName) => posix.join(parentPath, childName),
      basename: (path) => posix.basename(path),
      hasRepoMarker: async (path) => {
        try {
          const repoDir = await fsProvider.stat(posix.join(path, REPO_METADATA_DIR))
          if (repoDir.type !== 'directory') return false
        } catch {
          return false
        }
        for (const markerName of REPO_MANAGED_MARKERS) {
          try {
            if (await fsProvider.stat(posix.join(path, REPO_METADATA_DIR, markerName))) return true
          } catch {}
        }
        return false
      },

      hasGitMarker: async (path) => {
        try {
          const marker = await fsProvider.stat(posix.join(path, '.git'))
          if (marker.type === 'directory' || marker.type === 'file') {
            return true
          }
        } catch {
          // Continue to cheap bare-repository marker checks below.
        }
        const [head, objects, refs] = await Promise.all([
          fsProvider.stat(posix.join(path, 'HEAD')).catch(() => null),
          fsProvider.stat(posix.join(path, 'objects')).catch(() => null),
          fsProvider.stat(posix.join(path, 'refs')).catch(() => null)
        ])
        return head?.type === 'file' && objects?.type === 'directory' && refs?.type === 'directory'
      },
      isSelectedPathGitRepo: async (path) => {
        try {
          return (await gitProvider.isGitRepoAsync(path)).isRepo
        } catch {
          return false
        }
      }
    }
  })
}

export async function runNestedRepoScanForIpc(
  event: IpcMainInvokeEvent,
  args: z.infer<typeof ProjectGroupScanNestedArgs>
): Promise<NestedRepoScanResult> {
  const controller = args.scanId ? new AbortController() : undefined
  if (args.scanId && controller) {
    activeNestedRepoScans.get(args.scanId)?.abort()
    activeNestedRepoScans.set(args.scanId, controller)
  }

  try {
    const scan = await scanNestedReposForIpc({
      ...args,
      signal: controller?.signal,
      onProgress: args.scanId
        ? (scan) => {
            event.sender.send('projectGroups:scanNestedProgress', {
              scanId: args.scanId,
              scan
            })
          }
        : undefined
    })
    rememberCompletedNestedRepoScan(
      args.scanId,
      { parentPath: args.path, connectionId: args.connectionId },
      scan
    )
    return scan
  } finally {
    if (args.scanId && activeNestedRepoScans.get(args.scanId) === controller) {
      activeNestedRepoScans.delete(args.scanId)
    }
  }
}
