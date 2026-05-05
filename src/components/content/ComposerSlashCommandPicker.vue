<template>
  <div v-if="visible" ref="rootRef" class="slash-picker" :style="positionStyle">
    <ul v-if="filtered.length > 0" class="slash-picker-list" role="listbox">
      <li v-for="(item, idx) in filtered" :key="item.command">
        <button
          class="slash-picker-item"
          :class="{ 'is-highlighted': idx === highlightedIndex }"
          type="button"
          @mousedown.prevent="$emit('select', item)"
          @pointerenter="$emit('highlight', idx)"
        >
          <span class="slash-picker-name">/{{ item.command }}</span>
          <span class="slash-picker-desc">{{ item.description }}</span>
          <span v-if="!item.webSupported" class="slash-picker-badge">TUI</span>
        </button>
      </li>
    </ul>
    <div v-else class="slash-picker-empty">No commands found</div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { CodexSlashCommand } from '../../codexSlashCommands'

const props = defineProps<{
  commands: CodexSlashCommand[]
  query: string
  visible: boolean
  highlightedIndex: number
  anchorBottom?: number
  anchorLeft?: number
}>()

defineEmits<{
  select: [command: CodexSlashCommand]
  highlight: [index: number]
}>()

const rootRef = ref<HTMLElement | null>(null)

const filtered = computed(() => {
  const query = props.query.toLowerCase().trim()
  const rows = query
    ? props.commands.filter((entry) =>
      entry.command.includes(query) || entry.description.toLowerCase().includes(query))
    : props.commands
  return rows.slice(0, 12)
})

const positionStyle = computed(() => {
  const styles: Record<string, string> = {}
  if (props.anchorBottom != null) styles.bottom = `${props.anchorBottom}px`
  if (props.anchorLeft != null) styles.left = `${props.anchorLeft}px`
  return styles
})

defineExpose({
  filtered,
})
</script>

<style scoped>
@reference "tailwindcss";

.slash-picker {
  @apply absolute z-40 w-[22rem] max-sm:!left-4 max-sm:!right-4 max-sm:!w-auto max-h-80 rounded-xl border border-zinc-200 bg-white shadow-lg flex flex-col overflow-hidden;
}

.slash-picker-list {
  @apply m-0 list-none p-1 overflow-y-auto flex-1;
}

.slash-picker-item {
  @apply grid w-full grid-cols-[auto_1fr_auto] items-center gap-2 rounded-lg border-0 bg-transparent px-2.5 py-2 text-left transition hover:bg-zinc-50;
}

.slash-picker-item.is-highlighted {
  @apply bg-zinc-100;
}

.slash-picker-name {
  @apply text-sm font-semibold text-zinc-900;
}

.slash-picker-desc {
  @apply min-w-0 truncate text-xs text-zinc-500;
}

.slash-picker-badge {
  @apply rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-500;
}

.slash-picker-empty {
  @apply p-3 text-center text-sm text-zinc-400;
}
</style>
