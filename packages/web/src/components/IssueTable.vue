<script setup lang="ts">
import { computed, ref } from 'vue';
import type { RiskItem, RiskGrade, RiskPhase } from '@devops-risk-analyzer/shared';

const props = defineProps<{ items: RiskItem[] }>();

const gradeOrder: Record<RiskGrade, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

const filterGrade = ref<RiskGrade | 'ALL'>('ALL');
const filterPhase = ref<RiskPhase | 'ALL'>('ALL');
const sortBy = ref<'riskLevel' | 'source' | 'phase'>('riskLevel');

const filtered = computed(() =>
  [...props.items]
    .filter(i => filterGrade.value === 'ALL' || i.riskGrade === filterGrade.value)
    .filter(i => filterPhase.value === 'ALL' || i.phase === filterPhase.value)
    .sort((a, b) => {
      if (sortBy.value === 'riskLevel') return b.riskLevel - a.riskLevel;
      if (sortBy.value === 'source') return a.source.localeCompare(b.source);
      return gradeOrder[a.riskGrade] - gradeOrder[b.riskGrade];
    }),
);

const gradeClass: Record<RiskGrade, string> = {
  CRITICAL: 'bg-red-950 text-red-400 border border-red-800',
  HIGH:     'bg-orange-950 text-orange-400 border border-orange-800',
  MEDIUM:   'bg-yellow-950 text-yellow-400 border border-yellow-800',
  LOW:      'bg-green-950 text-green-400 border border-green-800',
};

const sourceLabel: Record<string, string> = {
  sonarqube: 'SonarQube',
  trivy: 'Trivy',
  gitleaks: 'Gitleaks',
  hadolint: 'Hadolint',
  checkov: 'Checkov',
  'git-hygiene': 'Git',
};
</script>

<template>
  <div class="space-y-3">
    <div class="flex gap-3 flex-wrap">
      <select
        v-model="filterPhase"
        class="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-sm text-slate-300 focus:outline-none"
      >
        <option value="ALL">All phases</option>
        <option value="DEV">Dev</option>
        <option value="OPS">Ops</option>
      </select>
      <select
        v-model="filterGrade"
        class="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-sm text-slate-300 focus:outline-none"
      >
        <option value="ALL">All grades</option>
        <option value="CRITICAL">Critical</option>
        <option value="HIGH">High</option>
        <option value="MEDIUM">Medium</option>
        <option value="LOW">Low</option>
      </select>
      <select
        v-model="sortBy"
        class="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-sm text-slate-300 focus:outline-none"
      >
        <option value="riskLevel">Sort: Risk Level</option>
        <option value="source">Sort: Source</option>
        <option value="phase">Sort: Phase</option>
      </select>
      <span class="self-center text-xs text-slate-500">{{ filtered.length }} item(s)</span>
    </div>

    <div class="rounded-xl border border-slate-800 overflow-hidden">
      <table class="w-full text-sm">
        <thead>
          <tr class="bg-slate-900 border-b border-slate-800">
            <th class="text-left px-4 py-2.5 text-slate-400 font-medium">Finding</th>
            <th class="text-left px-4 py-2.5 text-slate-400 font-medium w-24">Source</th>
            <th class="text-left px-4 py-2.5 text-slate-400 font-medium w-16">Phase</th>
            <th class="text-center px-4 py-2.5 text-slate-400 font-medium w-20">L × I</th>
            <th class="text-center px-4 py-2.5 text-slate-400 font-medium w-24">Grade</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="item in filtered"
            :key="item.id"
            class="border-b border-slate-800/60 hover:bg-slate-800/40 transition-colors"
          >
            <td class="px-4 py-3">
              <div class="font-medium text-slate-200 leading-snug">{{ item.title }}</div>
              <div class="text-slate-500 text-xs mt-0.5 max-w-md">{{ item.detail }}</div>
              <div v-if="item.file" class="text-slate-600 text-xs mt-0.5 font-mono truncate max-w-md">
                {{ item.file }}<span v-if="item.line">:{{ item.line }}</span>
              </div>
            </td>
            <td class="px-4 py-3 text-slate-400 text-xs">{{ sourceLabel[item.source] ?? item.source }}</td>
            <td class="px-4 py-3">
              <span class="text-xs px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">{{ item.phase }}</span>
            </td>
            <td class="px-4 py-3 text-center text-slate-300 font-mono text-xs">
              {{ item.likelihood }} × {{ item.impact }} = {{ item.riskLevel }}
            </td>
            <td class="px-4 py-3 text-center">
              <span class="text-xs px-2 py-0.5 rounded-full font-semibold" :class="gradeClass[item.riskGrade]">
                {{ item.riskGrade }}
              </span>
            </td>
          </tr>
          <tr v-if="filtered.length === 0">
            <td colspan="5" class="px-4 py-8 text-center text-slate-600">No findings match the current filter</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
