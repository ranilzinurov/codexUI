import { describe, expect, it } from 'vitest'
import { buildSkillEnabledRpcBody } from './skillsHubUtils'

describe('buildSkillEnabledRpcBody', () => {
  it('targets the exact installed skill path when toggling a row', () => {
    expect(buildSkillEnabledRpcBody({ path: '/home/user/.codex/skills/build-web-apps' }, false)).toEqual({
      method: 'skills/config/write',
      params: {
        path: '/home/user/.codex/skills/build-web-apps',
        enabled: false,
      },
    })

    expect(buildSkillEnabledRpcBody({ path: '/home/user/.codex/skills/build-web-apps/frontend-app-builder/SKILL.md' }, true)).toEqual({
      method: 'skills/config/write',
      params: {
        path: '/home/user/.codex/skills/build-web-apps/frontend-app-builder/SKILL.md',
        enabled: true,
      },
    })
  })

  it('rejects rows without a path before sending a toggle request', () => {
    expect(() => buildSkillEnabledRpcBody({}, true)).toThrow('Cannot update skill without a local path')
  })
})
