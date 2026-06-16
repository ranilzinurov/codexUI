<template>
  <div class="skills-hub">
    <div class="skills-hub-header">
      <h2 class="skills-hub-title">{{ t('Skills Hub') }}</h2>
      <p class="skills-hub-subtitle">{{ t('Manage installed skills on this machine') }}</p>
    </div>

    <div class="skills-sync-panel">
      <div class="skills-sync-header">
        <strong>{{ t('Skills Sync (GitHub)') }}</strong>
        <a
          v-if="syncStatus.configured && githubRepoUrl"
          class="skills-sync-badge skills-sync-badge-link"
          :href="githubRepoUrl"
          target="_blank"
          rel="noopener noreferrer"
        >
          {{ t('Connected') }}: {{ syncStatus.repoOwner }}/{{ syncStatus.repoName }}
        </a>
        <span v-else-if="syncStatus.loggedIn" class="skills-sync-badge">{{ t('Logged in as') }} {{ syncStatus.githubUsername }}</span>
        <span v-else class="skills-sync-badge">{{ t('Not connected') }}</span>
      </div>
      <div class="skills-sync-meta">
        <span>{{ t('Startup') }}: {{ syncStatus.startup.mode }}</span>
        <span>{{ t('Branch') }}: {{ syncStatus.startup.branch }}</span>
        <span>{{ t('Action') }}: {{ syncStatus.startup.lastAction }}</span>
      </div>
      <div v-if="syncStatus.startup.lastError" class="skills-sync-error">
        <span>{{ syncStatus.startup.lastError }}</span>
        <a class="skills-error-feedback" :href="feedbackMailto" @click="prepareSkillsErrorFeedback($event, syncStatus.startup.lastError)">{{ t('Send feedback') }}</a>
      </div>
      <div v-if="syncActionStatus" class="skills-sync-meta">
        <span>{{ t('Manual sync') }}: {{ syncActionStatus }}</span>
      </div>
      <div v-if="syncActionError" class="skills-sync-error">
        <span>{{ syncActionError }}</span>
        <a class="skills-error-feedback" :href="feedbackMailto" @click="prepareSkillsErrorFeedback($event, syncActionError)">{{ t('Send feedback') }}</a>
      </div>
      <div v-if="deviceLogin" class="skills-sync-device">
        <span>{{ t('Open') }} <a :href="deviceLogin.verification_uri" target="_blank" rel="noreferrer">{{ t('GitHub device login') }}</a> {{ t('and enter code:') }}</span>
        <code>{{ deviceLogin.user_code }}</code>
      </div>
      <div class="skills-sync-actions">
        <button v-if="!syncStatus.loggedIn" class="skills-hub-sort" type="button" @click="startGithubFirebaseLogin">{{ t('Login with GitHub') }}</button>
        <button v-if="!syncStatus.loggedIn" class="skills-hub-sort" type="button" @click="startGithubLogin">{{ t('Device Login') }}</button>
        <button v-if="syncStatus.loggedIn" class="skills-hub-sort" type="button" @click="logoutGithub" :disabled="isSyncActionInFlight">{{ t('Logout GitHub') }}</button>
        <button class="skills-hub-sort" type="button" @click="startupSkillsSync" :disabled="isSyncActionInFlight">{{ isStartupSyncInFlight ? t('Syncing...') : t('Startup Sync') }}</button>
        <button class="skills-hub-sort" type="button" @click="pullSkillsSync" :disabled="isSyncActionInFlight">{{ isPullInFlight ? t('Pulling...') : t('Pull') }}</button>
        <button v-if="syncStatus.loggedIn" class="skills-hub-sort" type="button" @click="pushSkillsSync" :disabled="!syncStatus.configured || isSyncActionInFlight">{{ isPushInFlight ? t('Pushing...') : t('Push') }}</button>
      </div>
    </div>

    <div v-if="toast" class="skills-hub-toast" :class="toastClass">{{ toast.text }}</div>

    <div class="skills-search-panel">
      <div class="skills-search-header">
        <div class="skills-search-copy">
          <strong>{{ t('Find skills') }}</strong>
          <span>{{ t('Search the Skills registry with npx skills find.') }}</span>
        </div>
        <a
          class="skills-directory-link"
          href="https://skills.anyclaw.store/"
          target="_blank"
          rel="noopener noreferrer"
        >
          {{ t('Skills directory') }}
        </a>
      </div>
      <form class="skills-search-form" @submit.prevent="searchSkills">
        <input
          v-model="skillSearchQuery"
          class="skills-search-input"
          type="search"
          :placeholder="t('Search skills...')"
          aria-label="Search skills"
        />
        <button class="skills-hub-sort" type="submit" :disabled="isSearchingSkills || skillSearchQuery.trim().length < 2">
          {{ isSearchingSkills ? t('Searching...') : t('Search') }}
        </button>
      </form>
      <div v-if="skillSearchError" class="skills-hub-error">
        <span>{{ skillSearchError }}</span>
        <a class="skills-error-feedback" :href="feedbackMailto" @click="prepareSkillsErrorFeedback($event, skillSearchError)">{{ t('Send feedback') }}</a>
      </div>
    </div>

    <div v-if="skillSearchResults.length > 0" class="skills-hub-section">
      <button class="skills-hub-section-toggle" type="button" @click="isSearchResultsOpen = !isSearchResultsOpen">
        <span class="skills-hub-section-title">{{ t('Search results ({count})', { count: skillSearchResults.length }) }}</span>
        <IconTablerChevronRight class="skills-hub-section-chevron" :class="{ 'is-open': isSearchResultsOpen }" />
      </button>
      <div v-if="isSearchResultsOpen" class="skills-hub-grid">
        <SkillCard
          v-for="skill in skillSearchResults"
          :key="skill.source || `${skill.owner}/${skill.name}`"
          :skill="skill"
          :show-browse-action="false"
          @select="(skill) => openDetail(skill as HubSkill)"
        />
      </div>
    </div>

    <slot name="before-installed" />

    <div v-if="filteredInstalled.length > 0" class="skills-hub-section">
      <button class="skills-hub-section-toggle" type="button" @click="isInstalledOpen = !isInstalledOpen">
        <span class="skills-hub-section-title">{{ t('Installed skills ({count})', { count: filteredInstalled.length }) }}</span>
        <IconTablerChevronRight class="skills-hub-section-chevron" :class="{ 'is-open': isInstalledOpen }" />
      </button>
      <div v-if="isInstalledOpen" class="skills-installed-list">
        <div
          v-for="skill in filteredInstalled"
          :key="skill.path || skill.name"
          class="skills-installed-group"
          :class="{ 'has-children': hasChildSkills(skill), 'is-disabled': skill.enabled === false }"
        >
          <div class="skills-installed-row">
            <button
              v-if="hasChildSkills(skill)"
              class="skills-installed-expand"
              type="button"
              :aria-label="expandedSkillGroups.has(skillGroupKey(skill)) ? 'Collapse skill group' : 'Expand skill group'"
              @click="toggleSkillGroup(skill)"
            >
              <IconTablerChevronRight class="skills-installed-chevron" :class="{ 'is-open': expandedSkillGroups.has(skillGroupKey(skill)) }" />
            </button>
            <span v-else class="skills-installed-spacer" aria-hidden="true"></span>

            <button class="skills-installed-main" type="button" @click="handleInstalledRowClick(skill)">
              <span class="skills-installed-avatar" :class="{ 'is-plugin': hasChildSkills(skill) }">
                <IconTablerFolder v-if="hasChildSkills(skill)" class="skills-installed-folder-icon" />
                <span v-else>{{ (skill.displayName || skill.name).charAt(0) }}</span>
              </span>
              <span class="skills-installed-copy">
                <span class="skills-installed-name">{{ skill.displayName || skill.name }}</span>
                <span v-if="skill.description" class="skills-installed-description">{{ skill.description }}</span>
              </span>
              <span v-if="hasChildSkills(skill)" class="skills-installed-count">
                {{ skill.childSkills?.length }} {{ skill.childSkills?.length === 1 ? 'skill' : 'skills' }}
              </span>
            </button>

            <button
              v-if="skill.path"
              class="skills-installed-browse"
              type="button"
              :title="t('Browse files')"
              @click="browseSkillFiles(skill)"
            >
              <IconTablerFolder class="skills-installed-browse-icon" />
            </button>
            <button
              v-if="skill.path"
              class="skills-installed-switch"
              type="button"
              role="switch"
              :aria-checked="skill.enabled !== false"
              :aria-label="`${skill.displayName || skill.name} ${skill.enabled === false ? t('disabled') : t('enabled')}`"
              :class="{ 'is-on': skill.enabled !== false }"
              :disabled="isSkillToggleBusy(skill)"
              @click.stop="handleToggleEnabled(skill, skill.enabled === false)"
            >
              <span class="skills-installed-switch-knob" aria-hidden="true"></span>
            </button>
          </div>

          <div v-if="hasChildSkills(skill) && expandedSkillGroups.has(skillGroupKey(skill))" class="skills-installed-children">
            <div
              v-for="child in skill.childSkills"
              :key="child.path"
              class="skills-installed-child-row"
              :class="{ 'is-disabled': child.enabled === false }"
            >
              <button class="skills-installed-child-main" type="button" @click="openDetail(childSkillToHubSkill(skill, child))">
                <span class="skills-installed-child-dot" aria-hidden="true"></span>
                <span class="skills-installed-copy">
                  <span class="skills-installed-name">{{ child.displayName || child.name }}</span>
                  <span v-if="child.description" class="skills-installed-description">{{ child.description }}</span>
                </span>
              </button>
              <button
                class="skills-installed-browse"
                type="button"
                :title="t('Browse files')"
                @click="browseSkillFiles(childSkillToHubSkill(skill, child))"
              >
                <IconTablerFolder class="skills-installed-browse-icon" />
              </button>
              <button
                class="skills-installed-switch"
                type="button"
                role="switch"
                :aria-checked="child.enabled !== false"
                :aria-label="`${child.displayName || child.name} ${child.enabled === false ? t('disabled') : t('enabled')}`"
                :class="{ 'is-on': child.enabled !== false }"
                :disabled="isSkillToggleBusy(child)"
                @click.stop="handleToggleEnabled(childSkillToHubSkill(skill, child), child.enabled === false)"
              >
                <span class="skills-installed-switch-knob" aria-hidden="true"></span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="skills-hub-section">
      <div v-if="isLoading" class="skills-hub-loading">{{ t('Loading skills...') }}</div>
      <div v-else-if="error" class="skills-hub-error">
        <span>{{ error }}</span>
        <a class="skills-error-feedback" :href="feedbackMailto" @click="prepareSkillsErrorFeedback($event, error)">{{ t('Send feedback') }}</a>
      </div>
      <div v-else-if="installedSkills.length === 0" class="skills-hub-empty">{{ t('No installed skills found.') }}</div>
    </div>

    <SkillDetailModal
      :skill="detailSkill"
      :visible="isDetailOpen"
      :is-installing="isDetailInstalling"
      :is-uninstalling="isDetailUninstalling"
      :is-trying="props.tryInFlightKey === skillTryKey(detailSkill)"
      @close="isDetailOpen = false"
      @install="handleInstall"
      @uninstall="handleUninstall"
      @toggle-enabled="handleToggleEnabled"
      @try="handleTrySkill"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import IconTablerChevronRight from '../icons/IconTablerChevronRight.vue'
import IconTablerFolder from '../icons/IconTablerFolder.vue'
import SkillCard from './SkillCard.vue'
import SkillDetailModal, { type HubSkill } from './SkillDetailModal.vue'
import { useGithubSkillsSync } from '../../composables/useGithubSkillsSync'
import { useFeedbackDiagnostics } from '../../composables/useFeedbackDiagnostics'
import { useUiLanguage } from '../../composables/useUiLanguage'
import { resolveBackendHttpUrl } from '../../backendUrl'
import { buildSkillEnabledRpcBody, type SkillToggleRow } from './skillsHubUtils'

const EMPTY_SKILL: HubSkill = { name: '', owner: '', description: '', url: '', installed: false }
type SkillsHubPayload = { installed?: HubSkill[] }
type SkillsSearchPayload = { results?: HubSkill[]; error?: string }
type HubChildSkill = NonNullable<HubSkill['childSkills']>[number]

const installedSkills = ref<HubSkill[]>([])
const skillSearchResults = ref<HubSkill[]>([])
const isLoading = ref(false)
const isSearchingSkills = ref(false)
const error = ref('')
const skillSearchQuery = ref('')
const skillSearchError = ref('')
const isInstalledOpen = ref(true)
const isSearchResultsOpen = ref(true)
const isDetailOpen = ref(false)
const detailSkill = ref<HubSkill>(EMPTY_SKILL)
const expandedSkillGroups = ref<Set<string>>(new Set())
const toast = ref<{ text: string; type: 'success' | 'error' } | null>(null)
const actionSkillKey = ref('')
const togglingSkillPath = ref('')
const isInstallActionInFlight = ref(false)
const isUninstallActionInFlight = ref(false)
let toastTimer: ReturnType<typeof setTimeout> | null = null
const { t } = useUiLanguage()
const { buildFeedbackMailto, feedbackMailtoBase, recordVisibleFailure } = useFeedbackDiagnostics()
const feedbackMailto = feedbackMailtoBase()

const props = defineProps<{
  tryInFlightKey?: string
}>()

const emit = defineEmits<{
  'skills-changed': []
  'try-item': [payload: { kind: 'skill'; name: string; displayName: string; skillPath?: string }]
}>()

const toastClass = computed(() => toast.value?.type === 'error' ? 'skills-hub-toast-error' : 'skills-hub-toast-success')
const currentDetailSkillKey = computed(() => `${detailSkill.value.owner}/${detailSkill.value.name}`)
const isDetailInstalling = computed(() =>
  isInstallActionInFlight.value && actionSkillKey.value === currentDetailSkillKey.value,
)
const isDetailUninstalling = computed(() =>
  isUninstallActionInFlight.value && actionSkillKey.value === currentDetailSkillKey.value,
)
const githubRepoUrl = computed(() => {
  if (!syncStatus.value.configured) return ''
  const owner = syncStatus.value.repoOwner.trim()
  const repo = syncStatus.value.repoName.trim()
  if (!owner || !repo) return ''
  return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
})
const filteredInstalled = computed(() => installedSkills.value)

function hasChildSkills(skill: HubSkill): boolean {
  return Array.isArray(skill.childSkills) && skill.childSkills.length > 0
}

function skillGroupKey(skill: HubSkill): string {
  return skill.path || skill.name
}

function toggleSkillGroup(skill: HubSkill): void {
  const key = skillGroupKey(skill)
  const next = new Set(expandedSkillGroups.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expandedSkillGroups.value = next
}

function handleInstalledRowClick(skill: HubSkill): void {
  if (hasChildSkills(skill)) {
    toggleSkillGroup(skill)
    return
  }
  openDetail(skill)
}

function childSkillToHubSkill(parent: HubSkill, child: HubChildSkill): HubSkill {
  return {
    name: child.name,
    owner: parent.displayName || parent.name || 'local',
    description: child.description,
    displayName: child.displayName,
    url: '',
    installed: true,
    path: child.path,
    enabled: child.enabled,
  }
}

function skillDirPath(skill: Pick<HubSkill, 'path'>): string {
  const p = skill.path
  if (!p) return ''
  return p.endsWith('/SKILL.md') ? p.slice(0, -'/SKILL.md'.length) : p
}

function browseSkillFiles(skill: Pick<HubSkill, 'path'>): void {
  const dir = skillDirPath(skill)
  if (!dir) return
  window.open(resolveBackendHttpUrl(`/codex-local-browse${encodeURI(dir)}`), '_blank', 'noopener,noreferrer')
}

function isSkillToggleBusy(skill: SkillToggleRow): boolean {
  return !!skill.path && togglingSkillPath.value === skill.path
}

function showToast(text: string, type: 'success' | 'error' = 'success'): void {
  toast.value = { text, type }
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.value = null }, 3000)
}

function prepareSkillsErrorFeedback(event: MouseEvent, message: string): void {
  recordVisibleFailure(message)
  const target = event.currentTarget
  if (target instanceof HTMLAnchorElement) {
    target.href = buildFeedbackMailto()
  }
}

function applySkillsPayload(payload: SkillsHubPayload): void {
  installedSkills.value = payload.installed ?? []
  if (skillSearchResults.value.length > 0) {
    const installedByName = new Map(installedSkills.value.map((skill) => [skill.name, skill]))
    skillSearchResults.value = skillSearchResults.value.map((skill) => {
      const installed = installedByName.get(skill.name)
      return installed ? registrySearchSkillWithLocalState(skill, installed) : skill
    })
  }
}

function registrySearchSkillWithLocalState(registrySkill: HubSkill, installed: HubSkill): HubSkill {
  return {
    ...registrySkill,
    installed: true,
    path: installed.path,
    enabled: installed.enabled,
  }
}

function localSearchSkill(installed: HubSkill, registrySkill: HubSkill): HubSkill {
  return {
    ...installed,
    installed: true,
    source: registrySkill.source,
    publishedAt: registrySkill.publishedAt,
  }
}

async function fetchSkills(): Promise<void> {
  isLoading.value = true
  error.value = ''
  try {
    const resp = await fetch('/codex-api/skills-hub')
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data = (await resp.json()) as SkillsHubPayload
    applySkillsPayload(data)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load skills'
  } finally {
    isLoading.value = false
  }
}

function openDetail(skill: HubSkill): void {
  const installedSkill = skill.installed ? installedSkills.value.find((candidate) => candidate.name === skill.name) : undefined
  detailSkill.value = installedSkill ? localSearchSkill(installedSkill, skill) : skill
  isDetailOpen.value = true
}

async function searchSkills(): Promise<void> {
  const query = skillSearchQuery.value.trim()
  if (query.length < 2) return
  isSearchingSkills.value = true
  skillSearchError.value = ''
  try {
    const params = new URLSearchParams({ q: query })
    const resp = await fetch(`/codex-api/skills-hub/search?${params}`)
    const data = (await resp.json()) as SkillsSearchPayload
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`)
    const installedByName = new Map(installedSkills.value.map((skill) => [skill.name, skill]))
    skillSearchResults.value = (data.results ?? []).map((skill) => {
      const installed = installedByName.get(skill.name)
      return installed ? registrySearchSkillWithLocalState(skill, installed) : skill
    })
    isSearchResultsOpen.value = true
    if (skillSearchResults.value.length === 0) {
      showToast(t('No matching skills found.'), 'error')
    }
  } catch (e) {
    skillSearchError.value = e instanceof Error ? e.message : 'Failed to search skills'
  } finally {
    isSearchingSkills.value = false
  }
}

async function handleInstall(skill: HubSkill): Promise<void> {
  actionSkillKey.value = `${skill.owner}/${skill.name}`
  isInstallActionInFlight.value = true
  try {
    const resp = await fetch('/codex-api/skills-hub/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner: skill.owner, name: skill.name, source: skill.source }),
    })
    const data = (await resp.json()) as { ok?: boolean; error?: string; path?: string }
    if (!data.ok) throw new Error(data.error || 'Install failed')
    if (!data.path) throw new Error('Install completed but no local skill path was returned')
    await fetchSkills()
    const installed = installedSkills.value.find((candidate) => candidate.name === skill.name)
    if (!installed?.path) {
      throw new Error('Install completed but the local skill was not found after refresh')
    }
    detailSkill.value = localSearchSkill(installed, skill)
    showToast(`${skill.displayName || skill.name} skill installed`)
    isDetailOpen.value = false
    emit('skills-changed')
  } catch (e) {
    showToast(e instanceof Error ? e.message : 'Failed to install skill', 'error')
  } finally {
    isInstallActionInFlight.value = false
  }
}

async function handleUninstall(skill: HubSkill): Promise<void> {
  actionSkillKey.value = `${skill.owner}/${skill.name}`
  isUninstallActionInFlight.value = true
  try {
    const resp = await fetch('/codex-api/skills-hub/uninstall', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: skill.name, path: skill.path }),
    })
    const data = (await resp.json()) as { ok?: boolean; error?: string }
    if (!data.ok) throw new Error(data.error || 'Uninstall failed')
    installedSkills.value = installedSkills.value.filter((s) => s.name !== skill.name)
    showToast(`${skill.displayName || skill.name} skill uninstalled`)
    isDetailOpen.value = false
    emit('skills-changed')
  } catch (e) {
    showToast(e instanceof Error ? e.message : 'Failed to uninstall skill', 'error')
  } finally {
    isUninstallActionInFlight.value = false
  }
}

async function handleToggleEnabled(skill: HubSkill, enabled: boolean): Promise<void> {
  togglingSkillPath.value = skill.path || ''
  try {
    const resp = await fetch('/codex-api/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildSkillEnabledRpcBody(skill, enabled)),
    })
    if (!resp.ok) throw new Error('Failed to update skill')
    await fetch('/codex-api/skills-sync/push', { method: 'POST' })
    showToast(`${skill.displayName || skill.name} skill ${enabled ? 'enabled' : 'disabled'}`)
    await fetchSkills()
  } catch (e) {
    showToast(e instanceof Error ? e.message : 'Failed to update skill', 'error')
  } finally {
    togglingSkillPath.value = ''
  }
}

function handleTrySkill(skill: HubSkill): void {
  if (!skill.installed || skill.enabled === false) return
  if (props.tryInFlightKey) return
  emit('try-item', {
    kind: 'skill',
    name: skill.name,
    displayName: skill.displayName || skill.name,
    skillPath: skill.path,
  })
  isDetailOpen.value = false
}

function skillTryKey(skill: HubSkill): string {
  return `skill:${skill.name}:${skill.path ?? ''}`
}

const {
  deviceLogin,
  isPullInFlight,
  isPushInFlight,
  isStartupSyncInFlight,
  isSyncActionInFlight,
  loadSyncStatus,
  logoutGithub,
  pullSkillsSync,
  pushSkillsSync,
  startupSkillsSync,
  startGithubFirebaseLogin,
  startGithubLogin,
  syncActionError,
  syncActionStatus,
  syncStatus,
} = useGithubSkillsSync({
  showToast,
  onPulled: async () => {
    await fetchSkills()
    emit('skills-changed')
  },
})
const visibleSkillErrors = [
  computed(() => syncStatus.value.startup.lastError),
  syncActionError,
  skillSearchError,
  error,
]

onMounted(() => {
  void fetchSkills()
  void loadSyncStatus()
})

watch(visibleSkillErrors, (values, oldValues) => {
  values.forEach((value, index) => {
    if (value === oldValues[index]) return
    const message = value.trim()
    if (message) {
      recordVisibleFailure(message)
    }
  })
})
</script>

<style scoped>
@reference "tailwindcss";

.skills-hub {
  @apply flex flex-col gap-3 sm:gap-4 p-3 sm:p-6 max-w-4xl mx-auto w-full overflow-y-auto h-full;
}

.skills-hub-header {
  @apply flex flex-col gap-1;
}

.skills-hub-title {
  @apply text-xl sm:text-2xl font-semibold text-zinc-900 m-0;
}

.skills-hub-subtitle {
  @apply text-sm text-zinc-500 m-0;
}

.skills-hub-sort {
  @apply shrink-0 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50 hover:border-zinc-300 cursor-pointer;
}

.skills-sync-panel {
  @apply rounded-xl border border-zinc-200 bg-zinc-50 p-3 flex flex-col gap-2;
}

.skills-sync-header {
  @apply flex flex-wrap items-center gap-2 text-sm text-zinc-700;
}

.skills-sync-badge {
  @apply text-xs rounded-md border border-zinc-300 bg-white px-2 py-0.5;
}

.skills-sync-badge-link {
  @apply text-zinc-700 hover:text-zinc-900 hover:border-zinc-400;
}

.skills-sync-device {
  @apply text-xs text-zinc-600 flex items-center gap-2 flex-wrap;
}

.skills-sync-meta {
  @apply text-xs text-zinc-600 flex items-center gap-3 flex-wrap;
}

.skills-sync-error {
  @apply flex items-start justify-between gap-3 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-2 py-1;
}

.skills-sync-actions {
  @apply flex flex-wrap gap-2;
}

.skills-search-panel {
  @apply rounded-xl border border-zinc-200 bg-white p-3 flex flex-col gap-2;
}

.skills-search-header {
  @apply flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between;
}

.skills-search-copy {
  @apply flex flex-col gap-0.5 text-sm text-zinc-700;
}

.skills-search-copy span {
  @apply text-xs text-zinc-500;
}

.skills-directory-link {
  @apply inline-flex shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:border-zinc-300 hover:bg-white hover:text-zinc-900;
}

.skills-search-form {
  @apply flex flex-col gap-2 sm:flex-row;
}

.skills-search-input {
  @apply min-w-0 flex-1 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-800 outline-none placeholder-zinc-400 transition focus:border-zinc-300 focus:bg-white;
}

.skills-hub-toast {
  @apply rounded-lg px-3 py-2 text-sm font-medium;
}

.skills-hub-toast-success {
  @apply border border-emerald-200 bg-emerald-50 text-emerald-700;
}

.skills-hub-toast-error {
  @apply border border-rose-200 bg-rose-50 text-rose-700;
}

.skills-hub-section {
  @apply flex flex-col gap-2;
}

.skills-hub-section-toggle {
  @apply flex items-center gap-1.5 border-0 bg-transparent p-0 text-sm font-medium text-zinc-600 transition hover:text-zinc-900 cursor-pointer;
}

.skills-hub-section-title {
  @apply text-sm font-medium;
}

.skills-hub-section-chevron {
  @apply w-3.5 h-3.5 transition-transform;
}

.skills-hub-section-chevron.is-open {
  @apply rotate-90;
}

.skills-hub-grid {
  @apply grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3;
}

.skills-installed-list {
  @apply overflow-hidden rounded-xl border border-zinc-200 bg-white;
}

.skills-installed-group {
  @apply border-b border-zinc-100 last:border-b-0;
}

.skills-installed-group.is-disabled,
.skills-installed-child-row.is-disabled {
  @apply opacity-50;
}

.skills-installed-row,
.skills-installed-child-row {
  @apply flex min-h-14 items-stretch gap-1 px-2 py-1.5;
}

.skills-installed-child-row {
  @apply min-h-12 pl-11;
}

.skills-installed-expand,
.skills-installed-spacer {
  @apply flex h-9 w-7 shrink-0 items-center justify-center self-center rounded-md border-0 bg-transparent text-zinc-400;
}

.skills-installed-expand {
  @apply cursor-pointer transition hover:bg-zinc-100 hover:text-zinc-700;
}

.skills-installed-chevron {
  @apply h-3.5 w-3.5 transition-transform;
}

.skills-installed-chevron.is-open {
  @apply rotate-90;
}

.skills-installed-main,
.skills-installed-child-main {
  @apply flex min-w-0 flex-1 items-center gap-2.5 rounded-lg border-0 bg-transparent px-2 py-1.5 text-left transition hover:bg-zinc-50 cursor-pointer;
}

.skills-installed-avatar {
  @apply flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-xs font-medium uppercase text-zinc-500;
}

.skills-installed-avatar.is-plugin {
  @apply bg-emerald-50 text-emerald-700;
}

.skills-installed-folder-icon,
.skills-installed-browse-icon {
  @apply h-4 w-4;
}

.skills-installed-copy {
  @apply flex min-w-0 flex-1 flex-col gap-0.5;
}

.skills-installed-name {
  @apply truncate text-sm font-medium text-zinc-900;
}

.skills-installed-description {
  @apply line-clamp-1 text-xs text-zinc-500;
}

.skills-installed-count {
  @apply ml-auto shrink-0 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs font-medium text-zinc-500;
}

.skills-installed-browse {
  @apply flex h-9 w-9 shrink-0 items-center justify-center self-center rounded-lg border-0 bg-transparent text-zinc-300 transition hover:bg-zinc-100 hover:text-zinc-600 cursor-pointer;
}

.skills-installed-switch {
  @apply relative flex h-6 w-10 shrink-0 items-center self-center rounded-full border border-zinc-200 bg-zinc-200 p-0.5 transition hover:border-zinc-300 hover:bg-zinc-300 focus:outline-none focus:ring-2 focus:ring-emerald-200 disabled:cursor-wait disabled:opacity-60;
}

.skills-installed-switch.is-on {
  @apply border-emerald-500 bg-emerald-500 hover:border-emerald-600 hover:bg-emerald-600;
}

.skills-installed-switch-knob {
  @apply h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-transform;
}

.skills-installed-switch.is-on .skills-installed-switch-knob {
  @apply translate-x-4;
}

.skills-installed-children {
  @apply relative border-t border-zinc-100 bg-zinc-50/60 py-1;
}

.skills-installed-children::before {
  @apply absolute bottom-3 left-8 top-3 w-px bg-zinc-200 content-[''];
}

.skills-installed-child-dot {
  @apply h-2 w-2 shrink-0 rounded-full bg-zinc-300;
}

.skills-hub-loading {
  @apply text-sm text-zinc-400 py-8 text-center;
}

.skills-hub-error {
  @apply flex items-start justify-between gap-3 text-sm text-rose-600 p-4 text-left rounded-lg border border-rose-200 bg-rose-50;
}

.skills-error-feedback {
  @apply shrink-0 rounded-full border border-rose-200 bg-white px-2.5 py-1 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 focus:outline-none focus:ring-2 focus:ring-rose-300;
}

.skills-hub-empty {
  @apply text-sm text-zinc-400 py-8 text-center;
}

:global(:root.dark) .skills-installed-list {
  @apply border-zinc-700 bg-zinc-900;
}

:global(:root.dark) .skills-installed-group {
  @apply border-zinc-800;
}

:global(:root.dark) .skills-installed-main,
:global(:root.dark) .skills-installed-child-main {
  @apply hover:bg-zinc-800;
}

:global(:root.dark) .skills-installed-expand {
  @apply text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200;
}

:global(:root.dark) .skills-installed-avatar {
  @apply bg-zinc-800 text-zinc-300;
}

:global(:root.dark) .skills-installed-avatar.is-plugin {
  @apply bg-emerald-950 text-emerald-300;
}

:global(:root.dark) .skills-installed-name {
  @apply text-zinc-100;
}

:global(:root.dark) .skills-installed-description {
  @apply text-zinc-400;
}

:global(:root.dark) .skills-installed-count {
  @apply border-zinc-700 bg-zinc-800 text-zinc-300;
}

:global(:root.dark) .skills-installed-browse {
  @apply text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200;
}

:global(:root.dark) .skills-installed-children {
  @apply border-zinc-800 bg-zinc-950/50;
}

:global(:root.dark) .skills-installed-children::before {
  @apply bg-zinc-700;
}

:global(:root.dark) .skills-installed-child-dot {
  @apply bg-zinc-600;
}
</style>
