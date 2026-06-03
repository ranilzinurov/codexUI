<template>
  <div v-if="visible" ref="rootRef" class="skill-picker" :style="positionStyle">
    <div class="skill-picker-header">
      <input
        ref="searchInputRef"
        v-model="query"
        class="skill-picker-search"
        type="text"
        :placeholder="t('Search skills or plugins...')"
        @keydown.escape.prevent="$emit('close')"
        @keydown.enter.prevent="selectHighlighted"
        @keydown.arrow-down.prevent="moveHighlight(1)"
        @keydown.arrow-up.prevent="moveHighlight(-1)"
      />
    </div>
    <ul v-if="filtered.length > 0" class="skill-picker-list" role="listbox">
      <li v-for="(skill, idx) in filtered" :key="skill.path">
        <button
          class="skill-picker-item"
          :class="{ 'is-highlighted': idx === highlightIndex }"
          type="button"
          @click="$emit('select', skill)"
          @pointerenter="highlightIndex = idx"
        >
          <span class="skill-picker-title-row">
            <span class="skill-picker-name">{{ skill.displayName || skill.name }}</span>
            <span
              v-if="skill.kind"
              class="skill-picker-kind"
              :class="`is-${skill.kind}`"
            >
              {{ skill.kind === 'plugin' ? 'Plugin' : 'Skill' }}
            </span>
          </span>
          <span v-if="skill.description" class="skill-picker-desc">{{ skill.description }}</span>
        </button>
      </li>
    </ul>
    <div v-else class="skill-picker-empty">{{ t('No skills or plugins found') }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useUiLanguage } from '../../composables/useUiLanguage'

export type SkillOption = {
  name: string
  displayName?: string
  description: string
  path: string
  kind?: 'skill' | 'plugin'
}

const props = defineProps<{
  skills: SkillOption[]
  visible: boolean
  anchorBottom?: number
  anchorLeft?: number
}>()

const emit = defineEmits<{
  select: [skill: SkillOption]
  close: []
}>()

const rootRef = ref<HTMLElement | null>(null)
const searchInputRef = ref<HTMLInputElement | null>(null)
const query = ref('')
const highlightIndex = ref(0)
const { t } = useUiLanguage()

const filtered = computed(() => {
  const q = query.value.toLowerCase().trim()
  if (!q) return props.skills
  return props.skills.filter(
    (s) =>
      s.name.toLowerCase().includes(q)
      || (s.displayName ?? '').toLowerCase().includes(q)
      || s.description.toLowerCase().includes(q),
  )
})

const positionStyle = computed(() => {
  const styles: Record<string, string> = {}
  if (props.anchorBottom != null) styles.bottom = `${props.anchorBottom}px`
  if (props.anchorLeft != null) styles.left = `${props.anchorLeft}px`
  return styles
})

function moveHighlight(delta: number): void {
  if (filtered.value.length === 0) return
  highlightIndex.value = (highlightIndex.value + delta + filtered.value.length) % filtered.value.length
}

function selectHighlighted(): void {
  const skill = filtered.value[highlightIndex.value]
  if (!skill) return
  emit('select', skill)
}

watch(() => props.visible, (v) => {
  if (v) {
    query.value = ''
    highlightIndex.value = 0
    nextTick(() => searchInputRef.value?.focus())
  }
})

watch(query, () => {
  highlightIndex.value = 0
})
</script>

<style scoped>
@reference "tailwindcss";

.skill-picker {
  @apply absolute z-40 w-72 max-sm:!left-4 max-sm:!right-4 max-sm:!w-auto max-h-64 rounded-xl border border-zinc-200 bg-white shadow-lg flex flex-col overflow-hidden;
}

.skill-picker-header {
  @apply p-2 border-b border-zinc-100;
}

.skill-picker-search {
  @apply w-full rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-sm text-zinc-800 outline-none placeholder-zinc-400 transition focus:border-zinc-300 focus:bg-white;
}

.skill-picker-list {
  @apply m-0 list-none p-1 overflow-y-auto flex-1;
}

.skill-picker-item {
  @apply flex w-full flex-col items-start gap-0.5 rounded-lg border-0 bg-transparent px-2.5 py-1.5 text-left transition hover:bg-zinc-50;
}

.skill-picker-item.is-highlighted {
  @apply bg-zinc-100;
}

.skill-picker-title-row {
  @apply flex w-full min-w-0 items-center gap-2;
}

.skill-picker-name {
  @apply min-w-0 truncate text-sm font-medium text-zinc-800;
}

.skill-picker-kind {
  @apply shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-normal;
}

.skill-picker-kind.is-skill {
  @apply border-zinc-200 bg-zinc-50 text-zinc-500;
}

.skill-picker-kind.is-plugin {
  @apply border-violet-200 bg-violet-50 text-violet-700;
}

.skill-picker-desc {
  @apply text-xs text-zinc-500 line-clamp-1;
}

.skill-picker-empty {
  @apply p-3 text-center text-sm text-zinc-400;
}

:global(:root.dark) .skill-picker {
  @apply border-zinc-700 bg-zinc-900 shadow-black/30;
}

:global(:root.dark) .skill-picker-header {
  @apply border-zinc-800;
}

:global(:root.dark) .skill-picker-search {
  @apply border-zinc-700 bg-zinc-800 text-zinc-100 placeholder-zinc-500 focus:border-zinc-600 focus:bg-zinc-800;
}

:global(:root.dark) .skill-picker-item {
  @apply hover:bg-zinc-800;
}

:global(:root.dark) .skill-picker-item.is-highlighted {
  @apply bg-zinc-800;
}

:global(:root.dark) .skill-picker-name {
  @apply text-zinc-100;
}

:global(:root.dark) .skill-picker-desc {
  @apply text-zinc-400;
}

:global(:root.dark) .skill-picker-kind.is-skill {
  @apply border-zinc-700 bg-zinc-800 text-zinc-400;
}

:global(:root.dark) .skill-picker-kind.is-plugin {
  @apply border-violet-800 bg-violet-950 text-violet-300;
}
</style>
