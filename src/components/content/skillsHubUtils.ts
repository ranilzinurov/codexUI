export type SkillToggleRow = {
  path?: string
}

export type SkillEnabledRpcBody = {
  method: 'skills/config/write'
  params: {
    path: string
    enabled: boolean
  }
}

export function buildSkillEnabledRpcBody(skill: SkillToggleRow, enabled: boolean): SkillEnabledRpcBody {
  if (!skill.path) {
    throw new Error('Cannot update skill without a local path')
  }
  return {
    method: 'skills/config/write',
    params: { path: skill.path, enabled },
  }
}
