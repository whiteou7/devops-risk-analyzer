<script setup lang="ts">
import { computed, ref } from 'vue';
import type { RiskItem, RiskGrade, RiskPhase } from '@devops-risk-analyzer/shared';

type PhaseFilter = RiskPhase | 'overall';

const props = defineProps<{ items: RiskItem[]; phase: PhaseFilter }>();

const gradeOrder: Record<RiskGrade, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

const filterGrade = ref<RiskGrade | 'ALL'>('ALL');
const sortBy = ref<'riskLevel' | 'source'>('riskLevel');

const enriched = computed(() => {
  if (props.phase === 'overall') {
    return props.items.flatMap(item => {
      if (item.phases.length === 0) return [];
      const worst = item.phases.reduce((a, b) => b.riskLevel > a.riskLevel ? b : a);
      return [{ item, riskLevel: worst.riskLevel, riskGrade: worst.riskGrade, likelihood: worst.likelihood, impact: worst.impact }];
    });
  }
  return props.items.flatMap(item => {
    const pm = item.phases.find(p => p.phase === props.phase);
    if (!pm) return [];
    return [{ item, riskLevel: pm.riskLevel, riskGrade: pm.riskGrade, likelihood: pm.likelihood, impact: pm.impact }];
  });
});

const filtered = computed(() =>
  [...enriched.value]
    .filter(e => filterGrade.value === 'ALL' || e.riskGrade === filterGrade.value)
    .sort((a, b) => {
      if (sortBy.value === 'riskLevel') return b.riskLevel - a.riskLevel;
      return a.item.source.localeCompare(b.item.source);
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
  'github-actions': 'GH Actions',
};
</script>

<template>
  <div class="space-y-3">
    <div class="flex gap-3 flex-wrap">
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
      </select>
      <span class="self-center text-xs text-slate-500">
        {{ filtered.length }} finding(s) {{ phase === 'overall' ? 'across all phases' : `in ${phase} phase` }}
      </span>
    </div>

    <div class="rounded-xl border border-slate-800 overflow-hidden">
      <table class="w-full text-sm">
        <thead>
          <tr class="bg-slate-900 border-b border-slate-800">
            <th class="text-left px-4 py-2.5 text-slate-400 font-medium">Finding</th>
            <th class="text-left px-4 py-2.5 text-slate-400 font-medium w-24">Source</th>
            <th class="text-left px-4 py-2.5 text-slate-400 font-medium w-28">All phases</th>
            <th class="text-center px-4 py-2.5 text-slate-400 font-medium w-20">L × I</th>
            <th class="text-center px-4 py-2.5 text-slate-400 font-medium w-24">Grade</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="{ item, riskLevel, riskGrade, likelihood, impact } in filtered"
            :key="item.id"
            class="border-b border-slate-800/60 hover:bg-slate-800/40 transition-colors"
          >
            <td class="px-4 py-3">
              <div class="font-medium text-slate-200 leading-snug">{{ item.title }}</div>
              <div class="text-slate-500 text-xs mt-0.5">{{ item.detail }}</div>
              <div v-if="item.file" class="text-slate-600 text-xs mt-0.5 font-mono max-w-md">
                {{ item.file }}<span v-if="item.line">:{{ item.line }}</span>
              </div>
            </td>
            <td class="px-4 py-3 text-slate-400 text-xs">{{ sourceLabel[item.source] ?? item.source }}</td>
            <td class="px-4 py-3">
              <div class="flex flex-wrap gap-1">
                <span
                  v-for="pm in item.phases"
                  :key="pm.phase"
                  class="text-xs px-1.5 py-0.5 rounded capitalize"
                  :class="pm.phase === phase ? 'bg-blue-900 text-blue-300' : 'bg-slate-800 text-slate-500'"
                >{{ pm.phase }}</span>
              </div>
            </td>
            <td class="px-4 py-3 text-center text-slate-300 font-mono text-xs">
              {{ likelihood }} × {{ impact }} = {{ riskLevel }}
            </td>
            <td class="px-4 py-3 text-center">
              <span class="text-xs px-2 py-0.5 rounded-full font-semibold" :class="gradeClass[riskGrade]">
                {{ riskGrade }}
              </span>
            </td>
          </tr>
          <tr v-if="filtered.length === 0">
            <td colspan="5" class="px-4 py-8 text-center text-slate-600">
              {{ phase === 'overall' ? 'No findings across all phases' : `No findings for the ${phase} phase` }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
