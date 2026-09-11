import type React from 'react'
import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { parseGitLabProjectAddress } from '../../../../shared/gitlab-projects'
import { translate } from '@/i18n/i18n'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { SearchableSetting } from './SearchableSetting'
import { SettingsSubsectionHeader } from './SettingsFormControls'

type Props = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

export function GitLabProjectsSettingsSection({
  settings,
  updateSettings
}: Props): React.JSX.Element {
  const projects = settings.gitlabProjects?.configured ?? []
  const [address, setAddress] = useState('')
  const [addressError, setAddressError] = useState<string | null>(null)

  const writeProjects = (configured: typeof projects): void => {
    updateSettings({
      gitlabProjects: {
        pinned: settings.gitlabProjects?.pinned ?? [],
        recent: settings.gitlabProjects?.recent ?? [],
        configured
      }
    })
  }
  const add = (): void => {
    const next = parseGitLabProjectAddress(address)
    if (!next) {
      setAddressError(
        translate(
          'settings.gitlabProjects.invalidAddress',
          'Enter a GitLab project URL, for example https://gitlab.example.com/group/project.'
        )
      )
      return
    }
    if (projects.some((project) => project.host === next.host && project.path === next.path)) {
      setAddressError(
        translate('settings.gitlabProjects.duplicateAddress', 'Project already added.')
      )
      return
    }
    writeProjects([...projects, next])
    setAddress('')
    setAddressError(null)
  }
  return (
    <section
      id="gitlab-projects"
      data-settings-section="gitlab-projects"
      className="scroll-mt-6 space-y-4"
    >
      <SettingsSubsectionHeader
        title={translate('settings.gitlabProjects.title', 'GitLab projects')}
        description={translate(
          'settings.gitlabProjects.description',
          'Browse issues and merge requests from projects without opening their local checkout.'
        )}
      />
      <SearchableSetting
        title={translate('settings.gitlabProjects.sources', 'Task sources')}
        description={translate(
          'settings.gitlabProjects.sourcesDescription',
          'Add project addresses for the GitLab Tasks view.'
        )}
        keywords={['gitlab', 'project', 'repository', 'tasks', 'issues', 'merge requests']}
        className="space-y-3"
      >
        {projects.map((project, index) => (
          <div key={`${project.host}/${project.path}`} className="flex items-center gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate font-mono">
              {project.host}/{project.path}
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => writeProjects(projects.filter((_, itemIndex) => itemIndex !== index))}
              aria-label={translate('settings.gitlabProjects.remove', 'Remove GitLab project')}
            >
              <Trash2 />
            </Button>
          </div>
        ))}
        <div className="flex gap-2">
          <Input
            className="h-8 min-w-64 flex-1 text-xs"
            value={address}
            onChange={(event) => {
              setAddress(event.target.value)
              setAddressError(null)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                add()
              }
            }}
            placeholder="https://gitlab.example.com/group/project"
            aria-label={translate('settings.gitlabProjects.address', 'GitLab project URL')}
            aria-invalid={Boolean(addressError)}
          />
          <Button size="sm" variant="outline" onClick={add} disabled={!address.trim()}>
            <Plus />
            {translate('settings.gitlabProjects.add', 'Add')}
          </Button>
        </div>
        {addressError ? <p className="text-xs text-destructive">{addressError}</p> : null}
        <p className="text-xs text-muted-foreground">
          {translate(
            'settings.gitlabProjects.help',
            'Authentication uses the glab account on the selected execution host.'
          )}
        </p>
      </SearchableSetting>
    </section>
  )
}
