import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const folderWorkspacesApi = {
  list: () => ipcRenderer.invoke('folderWorkspaces:list'),
  getPathStatus: (args) => ipcRenderer.invoke('folderWorkspaces:getPathStatus', args),
  create: (args) => ipcRenderer.invoke('folderWorkspaces:create', args),
  deriveRepoManaged: (args) => ipcRenderer.invoke('folderWorkspaces:deriveRepoManaged', args),
  probeRepoCli: (args) => ipcRenderer.invoke('folderWorkspaces:probeRepoCli', args),
  installRepoCli: () => ipcRenderer.invoke('folderWorkspaces:installRepoCli'),
  onDeriveProgress: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: Parameters<typeof callback>[0]) =>
      callback(progress)
    ipcRenderer.on('folderWorkspaces:deriveProgress', listener)
    return () => ipcRenderer.removeListener('folderWorkspaces:deriveProgress', listener)
  },
  update: (args) => ipcRenderer.invoke('folderWorkspaces:update', args),
  delete: (args) => ipcRenderer.invoke('folderWorkspaces:delete', args)
} satisfies PreloadApi['folderWorkspaces']
