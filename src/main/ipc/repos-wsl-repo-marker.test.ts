import { beforeEach, describe, expect, it, vi } from 'vitest'

const { runProcessMock, parseWslPathMock } = vi.hoisted(() => ({
  runProcessMock: vi.fn(),
  parseWslPathMock: vi.fn()
}))

vi.mock('../../shared/child-process/run-process', () => ({ runProcess: runProcessMock }))
vi.mock('../wsl', () => ({ parseWslPath: parseWslPathMock }))
vi.mock('electron', () => ({ dialog: {}, ipcMain: { handle: vi.fn(), removeHandler: vi.fn() } }))

import { pathLooksLikeRepoManagedRootInWsl } from './repos'

beforeEach(() => {
  runProcessMock.mockReset()
  parseWslPathMock.mockReset()
})

describe('WSL repo-managed marker probe', () => {
  it('checks repo markers inside the owning distro', async () => {
    parseWslPathMock.mockReturnValue({
      distro: 'Ubuntu-24.04',
      linuxPath: '/home/miles/pyoneer05'
    })
    runProcessMock.mockResolvedValue({
      code: 0,
      signal: null,
      stdout: '',
      stderr: '',
      timedOut: false
    })

    await expect(
      pathLooksLikeRepoManagedRootInWsl('\\\\wsl.localhost\\Ubuntu-24.04\\home\\miles\\pyoneer05')
    ).resolves.toBe(true)

    expect(runProcessMock).toHaveBeenCalledWith({
      program: 'wsl.exe',
      args: [
        '-d',
        'Ubuntu-24.04',
        '--exec',
        '/bin/sh',
        '-c',
        'test -d "$1/.repo" && { test -e "$1/.repo/manifest.xml" || test -e "$1/.repo/project.list"; }',
        'sh',
        '/home/miles/pyoneer05'
      ],
      timeoutMs: 5_000
    })
  })

  it('returns false for ordinary Windows paths without spawning WSL', async () => {
    parseWslPathMock.mockReturnValue(null)

    await expect(pathLooksLikeRepoManagedRootInWsl('C:\\Users\\miles\\Documents')).resolves.toBe(
      false
    )
    expect(runProcessMock).not.toHaveBeenCalled()
  })
})
