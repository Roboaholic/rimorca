import { access, link, lstat, mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { basename, dirname, join, relative, sep, win32 } from 'node:path'
import { homedir } from 'node:os'
import type { FolderWorkspace } from '../../shared/folder-workspace-types'
import type { ProjectGroup } from '../../shared/project-group-types'
import { isRepoManagedProjectGroup } from '../../shared/repo-managed-project'
import { runProcess } from '../../shared/child-process/run-process'
import { parseWslPath } from '../wsl'
import { toLinuxPath } from '../../shared/wsl-paths'
import { buildWslExecArgs, quotePosixShell } from '../../shared/wsl-login-shell-command'
import { gitExecFileAsync } from '../git/runner'
import { computeWorktreePathAsync, sanitizeWorktreeName } from '../ipc/worktree-logic'
import type { RepoManagedSeedProgress } from './repo-managed-seed'
import { removeDerivedRepoPath } from './repo-managed-cleanup'
import type { RepoManagedDerivePhase } from '../../shared/repo-managed-derive-progress'
export type { RepoManagedDerivePhase } from '../../shared/repo-managed-derive-progress'
export {
  REPO_MANAGED_LOCAL_OBJECTS_MISSING,
  seedDerivedRepoProjectGitDirs
} from './repo-managed-seed'
export const REPO_MANAGED_DERIVE_SSH_UNSUPPORTED =
  'Deriving a repo workspace on SSH requires an Orca runtime on that host.'
export const REPO_TOOL_MISSING =
  'The repo CLI was not found. Install it from the workspace composer, or open a checkout that contains .repo/repo.'
export const REPO_MANAGED_GROUP_REQUIRED = 'Selected project is not a repo-managed checkout.'
const REPO_COMMAND_TIMEOUT_MS = 3_600_000
export type RepoManagedCommandRunner = (args: {
  program: string
  args: readonly string[]
  cwd: string
  signal?: AbortSignal
  onStdout?: (chunk: string) => void
  onStderr?: (chunk: string) => void
}) => Promise<{ code: number | null; stdout: string; stderr: string }>
export type RepoManagedDeriveStore = {
  getSettings: () => { nestWorkspaces: boolean; workspaceDir: string }
  getProjectGroups: () => ProjectGroup[]
  createFolderWorkspace: (input: {
    projectGroupId: string
    name?: string
    folderPath?: string | null
    connectionId?: string | null
    linkedTask?: FolderWorkspace['linkedTask']
    linkedTaskSourceContext?: FolderWorkspace['linkedTaskSourceContext']
    createdWithAgent?: FolderWorkspace['createdWithAgent']
    pendingFirstAgentMessageRename?: boolean
    creatorProvenance?: FolderWorkspace['creatorProvenance']
  }) => FolderWorkspace
}
async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}
export async function defaultRepoCommandRunner(args: {
  program: string
  args: readonly string[]
  cwd: string
  signal?: AbortSignal
  onStdout?: (chunk: string) => void
  onStderr?: (chunk: string) => void
}): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const wsl = parseWslPath(args.cwd)
  if (wsl) {
    const isSync = args.args[0] === 'sync'
    const linuxCwd = wsl.linuxPath
    const argv = [toLinuxPath(args.program), ...args.args]
    const invocation = argv.map(quotePosixShell).join(' ')
    const command = [
      `cd ${quotePosixShell(linuxCwd)}`,
      isSync ? `exec script -qefc ${quotePosixShell(invocation)} /dev/null` : `exec ${invocation}`
    ].join('\n')
    const result = await runProcess({
      program: 'wsl.exe',
      args: buildWslExecArgs(wsl.distro, ['/bin/bash', '-s', '--']),
      input: command,
      cwd: undefined,
      timeoutMs: REPO_COMMAND_TIMEOUT_MS,
      signal: args.signal,
      onStdout: args.onStdout,
      onStderr: args.onStderr
    })
    return { code: result.code, stdout: result.stdout, stderr: result.stderr }
  }
  const result = await runProcess({
    program: args.program,
    args: args.args,
    cwd: args.cwd,
    timeoutMs: REPO_COMMAND_TIMEOUT_MS,
    signal: args.signal,
    onStdout: args.onStdout,
    onStderr: args.onStderr
  })
  return { code: result.code, stdout: result.stdout, stderr: result.stderr }
}

export const REPO_MANAGED_SNAPSHOT_METADATA = '.orca-repo-snapshot.json'

export type RepoManagedSnapshotMetadata = {
  version: 1
  sourcePath: string
  topic: string
  createdAt: string
  projectPaths: string[]
}

export type RepoManagedSnapshotResult = {
  projectPaths: string[]
  topic: string
  metadataPath: string
}

const SNAPSHOT_EXCLUDED_DIRECTORIES: Record<string, true> = {
  '.git': true,
  '.repo': true,
  node_modules: true,
  out: true,
  dist: true,
  build: true,
  '.next': true,
  '.turbo': true,
  target: true
}

export async function readRepoManagedProjectPaths(mainPath: string): Promise<string[]> {
  const contents = await readFile(join(mainPath, '.repo', 'project.list'), 'utf8')
  const seen = new Set<string>()
  const projects: string[] = []
  for (const rawLine of contents.split(/\r?\n/)) {
    const projectPath = rawLine.trim()
    if (!projectPath || projectPath.startsWith('#')) {
      continue
    }
    const normalized = projectPath.replaceAll('\\', '/')
    if (
      normalized.startsWith('/') ||
      /^[A-Za-z]:\//.test(normalized) ||
      normalized.split('/').some((part) => !part || part === '.' || part === '..')
    ) {
      throw new Error(`Unsafe repo project path in .repo/project.list: ${projectPath}`)
    }
    if (!seen.has(normalized)) {
      seen.add(normalized)
      projects.push(normalized)
    }
  }
  if (projects.length === 0) {
    throw new Error('The repo checkout has no projects in .repo/project.list.')
  }
  return projects
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error('Snapshot creation was aborted.')
  }
}

async function hardlinkGoldenTree(args: {
  sourcePath: string
  destPath: string
  sourceRoot: string
  destRoot: string
  signal?: AbortSignal
}): Promise<void> {
  throwIfAborted(args.signal)
  await mkdir(args.destPath, { recursive: true })
  for (const entry of await readdir(args.sourcePath, { withFileTypes: true })) {
    throwIfAborted(args.signal)
    if (SNAPSHOT_EXCLUDED_DIRECTORIES[entry.name]) {
      continue
    }
    const source = join(args.sourcePath, entry.name)
    const destination = join(args.destPath, entry.name)
    const sourceRelative = relative(args.sourceRoot, source)
    const destinationRelative = relative(args.sourceRoot, args.destRoot)
    if (
      destinationRelative &&
      destinationRelative !== '..' &&
      !destinationRelative.startsWith(`..${sep}`) &&
      (sourceRelative === destinationRelative || sourceRelative.startsWith(`${destinationRelative}${sep}`))
    ) {
      continue
    }
    if (entry.isDirectory()) {
      await hardlinkGoldenTree({ ...args, sourcePath: source, destPath: destination })
      continue
    }
    if (!entry.isFile()) {
      continue
    }
    await mkdir(dirname(destination), { recursive: true })
    try {
      await link(source, destination)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error
      }
    }
  }
}

const WSL_WORKTREE_CREATE_SCRIPT = `set -euo pipefail
golden=$1
dest=$2
topic=$3
shift 3
jobs=8
state="$dest/.orca-worktree-create"
mkdir -p "$state/ok"
cleanup() {
  for record in "$state/ok"/*; do
    [ -f "$record" ] || continue
    IFS=$'\\t' read -r project gitdir < "$record"
    git --git-dir="$gitdir" worktree remove --force "$dest/$project" >/dev/null 2>&1 || true
    git --git-dir="$gitdir" branch -D "$topic" >/dev/null 2>&1 || true
  done
  rm -rf "$dest"
}
trap cleanup ERR INT TERM
export golden dest topic state
printf '%s\\n' "$@" | xargs -P "$jobs" -I{} bash -c '
  set -euo pipefail
  project=$1
  src="$golden/$project"
  dst="$dest/$project"
  key=$(printf %s "$project" | sha256sum | cut -d" " -f1)
  gitdir=$(git -C "$src" rev-parse --path-format=absolute --git-common-dir)
  mkdir -p "$(dirname "$dst")"
  git --git-dir="$gitdir" worktree add --no-checkout --no-track -b "$topic" "$dst" HEAD
  printf "%s\\t%s\\n" "$project" "$gitdir" > "$state/ok/$key"
  printf "__ORCA_REPO_WORKTREE_DONE__%s\\n" "$project"
' _ {}
printf '__ORCA_REPO_LINKING__\\n'
rsync -a --link-dest="$golden/" \
  --exclude=.git --exclude=/.repo/ --exclude=/.repo-worktrees/ \
  --exclude=/out/ --exclude=/dist/ --exclude=/build/ --exclude=/node_modules/ \
  "$golden/" "$dest/"
rm -rf "$state"
trap - ERR INT TERM
`

export function createRepoSnapshotProgressParser(args: {
  totalProjects: number
  onPhase?: (phase: RepoManagedDerivePhase) => void
  onProgress?: (progress: RepoManagedSeedProgress) => void
}): (chunk: string) => void {
  let buffered = ''
  let processedProjects = 0
  return (chunk) => {
    buffered += chunk
    const lines = buffered.split(/\r?\n/)
    buffered = lines.pop() ?? ''
    for (const line of lines) {
      if (line === '__ORCA_REPO_LINKING__') {
        args.onPhase?.('linking')
        continue
      }
      const marker = '__ORCA_REPO_WORKTREE_DONE__'
      if (!line.startsWith(marker)) {
        continue
      }
      processedProjects += 1
      args.onProgress?.({
        currentProject: line.slice(marker.length),
        processedProjects,
        totalProjects: args.totalProjects
      })
    }
  }
}

async function createWslRepoManagedSnapshot(args: {
  mainPath: string
  destPath: string
  topic: string
  projectPaths: string[]
  distro: string
  signal?: AbortSignal
  onPhase?: (phase: RepoManagedDerivePhase) => void
  onProgress?: (progress: RepoManagedSeedProgress) => void
}): Promise<void> {
  const main = parseWslPath(args.mainPath)!.linuxPath
  const dest = parseWslPath(args.destPath)!.linuxPath
  args.onPhase?.('worktrees')
  const onStdout = createRepoSnapshotProgressParser({
    totalProjects: args.projectPaths.length,
    onPhase: args.onPhase,
    onProgress: args.onProgress
  })
  const result = await runProcess({
    program: 'wsl.exe',
    args: buildWslExecArgs(args.distro, [
      '/bin/bash',
      '-s',
      '--',
      main,
      dest,
      args.topic,
      ...args.projectPaths
    ]),
    input: WSL_WORKTREE_CREATE_SCRIPT,
    timeoutMs: REPO_COMMAND_TIMEOUT_MS,
    signal: args.signal,
    onStdout
  })
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || 'WSL snapshot creation failed.')
  }
  args.onPhase?.('linking')
}

export async function createRepoManagedSnapshot(args: {
  mainPath: string
  destPath: string
  topic?: string
  signal?: AbortSignal
  onPhase?: (phase: RepoManagedDerivePhase) => void
  onProgress?: (progress: RepoManagedSeedProgress) => void
}): Promise<RepoManagedSnapshotResult> {
  args.onPhase?.('preparing')
  const wsl = parseWslPath(args.mainPath)
  if (wsl && parseWslPath(args.destPath)?.distro !== wsl.distro) {
    throw new Error('Derived repo workspaces must stay on the same WSL distro as the main tree.')
  }
  if (await pathExists(args.destPath)) {
    throw new Error(`Derive destination already exists: ${args.destPath}`)
  }
  const projectPaths = await readRepoManagedProjectPaths(args.mainPath)
  const topic = sanitizeWorktreeName(args.topic?.trim() || basename(args.destPath))
  const attempted: string[] = []
  let complete = false
  await mkdir(args.destPath, { recursive: true })
  if (wsl) {
    const metadataPath = join(args.destPath, REPO_MANAGED_SNAPSHOT_METADATA)
    await createWslRepoManagedSnapshot({
      mainPath: args.mainPath,
      destPath: args.destPath,
      topic,
      projectPaths,
      distro: wsl.distro,
      signal: args.signal,
      onPhase: args.onPhase,
      onProgress: args.onProgress
    })
    const metadata: RepoManagedSnapshotMetadata = {
      version: 1,
      sourcePath: await realpath(args.mainPath),
      topic,
      createdAt: new Date().toISOString(),
      projectPaths
    }
    await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, { flag: 'wx' })
    return { projectPaths, topic, metadataPath }
  }
  try {
    args.onPhase?.('worktrees')
    for (const [index, projectPath] of projectPaths.entries()) {
      throwIfAborted(args.signal)
      const sourceProject = join(args.mainPath, ...projectPath.split('/'))
      const destProject = join(args.destPath, ...projectPath.split('/'))
      const sourceStat = await lstat(sourceProject)
      if (!sourceStat.isDirectory()) {
        throw new Error(`Repo project is not a directory: ${projectPath}`)
      }
      await mkdir(dirname(destProject), { recursive: true })
      attempted.push(projectPath)
      await gitExecFileAsync(
        ['worktree', 'add', '--no-checkout', '--no-track', '-b', topic, destProject, 'HEAD'],
        { cwd: sourceProject, signal: args.signal }
      )
      args.onProgress?.({
        processedProjects: index + 1,
        totalProjects: projectPaths.length,
        currentProject: projectPath
      })
    }
    args.onPhase?.('linking')
    await hardlinkGoldenTree({
      sourcePath: args.mainPath,
      destPath: args.destPath,
      sourceRoot: args.mainPath,
      destRoot: args.destPath,
      signal: args.signal
    })
    const metadataPath = join(args.destPath, REPO_MANAGED_SNAPSHOT_METADATA)
    const metadata: RepoManagedSnapshotMetadata = {
      version: 1,
      sourcePath: await realpath(args.mainPath),
      topic,
      createdAt: new Date().toISOString(),
      projectPaths
    }
    await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, { flag: 'wx' })
    complete = true
    return { projectPaths, topic, metadataPath }
  } finally {
    if (!complete) {
      for (const projectPath of attempted.reverse()) {
        const sourceProject = join(args.mainPath, ...projectPath.split('/'))
        const destProject = join(args.destPath, ...projectPath.split('/'))
        await gitExecFileAsync(['worktree', 'remove', '--force', destProject], {
          cwd: sourceProject
        }).catch(() => {})
        await gitExecFileAsync(['branch', '-D', topic], { cwd: sourceProject }).catch(() => {})
      }
      await removeDerivedRepoPath(args.destPath).catch(() => {})
    }
  }
}

export async function materializeRepoManagedCheckout(args: {
  mainPath: string
  destPath: string
  topic?: string
  signal?: AbortSignal
  onPhase?: (phase: RepoManagedDerivePhase) => void
  onSeedProgress?: (progress: RepoManagedSeedProgress) => void
  onSyncProgress?: (progress: RepoManagedSeedProgress) => void
  runCommand?: RepoManagedCommandRunner
}): Promise<void> {
  await createRepoManagedSnapshot({
    mainPath: args.mainPath,
    destPath: args.destPath,
    topic: args.topic,
    signal: args.signal,
    onPhase: args.onPhase,
    onProgress: args.onSeedProgress
  })
}

export async function resolveRepoManagedSnapshotPath(args: {
  mainPath: string
  workspaceName: string
  settings: { nestWorkspaces: boolean; workspaceDir: string }
}): Promise<string> {
  const sanitizedName = sanitizeWorktreeName(args.workspaceName)
  const sourceWsl = parseWslPath(args.mainPath)
  return sourceWsl
    ? win32.join(win32.dirname(args.mainPath), sanitizedName)
    : computeWorktreePathAsync(sanitizedName, args.mainPath, {
        nestWorkspaces: args.settings.nestWorkspaces,
        workspaceDir: args.settings.workspaceDir || join(homedir(), 'orca', 'workspaces')
      })
}

export async function deriveRepoManagedFolderWorkspace(args: {
  store: RepoManagedDeriveStore
  projectGroupId: string
  name?: string
  connectionId?: string | null
  linkedTask?: FolderWorkspace['linkedTask']
  linkedTaskSourceContext?: FolderWorkspace['linkedTaskSourceContext']
  createdWithAgent?: FolderWorkspace['createdWithAgent']
  pendingFirstAgentMessageRename?: boolean
  signal?: AbortSignal
  onPhase?: (phase: RepoManagedDerivePhase) => void
  onSeedProgress?: (progress: RepoManagedSeedProgress) => void
  onSyncProgress?: (progress: RepoManagedSeedProgress) => void
  runCommand?: RepoManagedCommandRunner
}): Promise<FolderWorkspace> {
  const group = args.store.getProjectGroups().find((entry) => entry.id === args.projectGroupId)
  if (!group?.parentPath || !isRepoManagedProjectGroup(group)) {
    throw new Error(REPO_MANAGED_GROUP_REQUIRED)
  }
  if (args.connectionId ?? group.connectionId) {
    throw new Error(REPO_MANAGED_DERIVE_SSH_UNSUPPORTED)
  }
  const workspaceName = args.name?.trim() || `${group.name} workspace`
  const settings = args.store.getSettings()
  const destPath = await resolveRepoManagedSnapshotPath({
    mainPath: group.parentPath,
    workspaceName,
    settings
  })
  await materializeRepoManagedCheckout({
    mainPath: group.parentPath,
    destPath,
    signal: args.signal,
    onPhase: args.onPhase,
    onSeedProgress: args.onSeedProgress,
    onSyncProgress: args.onSyncProgress,
    runCommand: args.runCommand
  })
  args.onPhase?.('register')
  if (!(await pathExists(destPath))) {
    throw new Error(`Derived repo workspace was not created: ${destPath}`)
  }
  return args.store.createFolderWorkspace({
    projectGroupId: group.id,
    name: workspaceName,
    folderPath: destPath,
    connectionId: null,
    linkedTask: args.linkedTask,
    linkedTaskSourceContext: args.linkedTaskSourceContext,
    createdWithAgent: args.createdWithAgent,
    pendingFirstAgentMessageRename: args.pendingFirstAgentMessageRename,
    creatorProvenance: { kind: 'host' }
  })
}
