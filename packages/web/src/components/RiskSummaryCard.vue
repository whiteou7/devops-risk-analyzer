<script setup lang="ts">
import type { PhaseScore } from '@devops-risk-analyzer/shared';

defineProps<{ phase: PhaseScore }>();

const gradeColors: Record<string, string> = {
  CRITICAL: 'text-red-400 border-red-800 bg-red-950/40',
  HIGH:     'text-orange-400 border-orange-800 bg-orange-950/40',
  MEDIUM:   'text-yellow-400 border-yellow-800 bg-yellow-950/40',
  LOW:      'text-green-400 border-green-800 bg-green-950/40',
};

const barColors: Record<string, string> = {
  CRITICAL: 'bg-red-500',
  HIGH:     'bg-orange-500',
  MEDIUM:   'bg-yellow-500',
  LOW:      'bg-green-500',
};
</script>

<template>
  <div class="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
    <div class="flex items-center justify-between">
      <h3 class="text-sm font-medium text-slate-400 uppercase tracking-wider">
        {{ phase.phase }} Phase
      </h3>
      <span
        class="px-2.5 py-0.5 rounded-full text-xs font-bold border"
        :class="gradeColors[phase.grade]"
      >{{ phase.grade }}</span>
    </div>

    <div class="flex items-end gap-3">
      <span class="text-5xl font-bold text-white">{{ phase.score }}</span>
      <span class="text-slate-500 text-sm mb-1.5">/ 100 risk score</span>
    </div>

    <div class="space-y-1.5">
      <div v-for="b in phase.breakdown" :key="b.grade" class="flex items-center gap-2">
        <span class="text-xs w-16 text-slate-400">{{ b.grade }}</span>
        <div class="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
          <div
            class="h-full rounded-full transition-all duration-500"
            :class="barColors[b.grade]"
            :style="{ width: phase.itemCount > 0 ? `${(b.count / phase.itemCount) * 100}%` : '0%' }"
          />
        </div>
        <span class="text-xs text-slate-500 w-5 text-right">{{ b.count }}</span>
      </div>
    </div>
  </div>
</template>
