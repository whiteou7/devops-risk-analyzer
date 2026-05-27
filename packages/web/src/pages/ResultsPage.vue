<script setup lang="ts">
import { onMounted, computed, ref } from 'vue';
import { useJobStore } from '../stores/jobStore.ts';
import { useJobStream } from '../composables/useJobStream.ts';
import { getJob } from '../api/client.ts';
import JobProgressBar from '../components/JobProgressBar.vue';
import RiskMatrixGrid from '../components/RiskMatrixGrid.vue';
import RiskSummaryCard from '../components/RiskSummaryCard.vue';
import IssueTable from '../components/IssueTable.vue';
import type { RiskPhase } from '@devops-risk-analyzer/shared';

const ALL_PHASES: RiskPhase[] = ['plan', 'code', 'build', 'test', 'release', 'deploy', 'operate', 'monitor'];

const props = defineProps<{ jobId: string }>();
const store = useJobStore();
const activePhase = ref<RiskPhase>('code');

// Bootstrap: if store has no job set (e.g. direct URL navigation), poll once then stream
onMounted(async () => {
  // 'cached' is a virtual job ID used when a result is served from the DB cache
  // without enqueuing a job. The store is already populated by HomePage.
  if (props.jobId === 'cached') return;

  if (store.jobId !== props.jobId) {
    store.setJob(props.jobId);
    try {
      const response = await getJob(props.jobId);
      const job = response.data;
      if (job.status === 'completed' && job.result) {
        store.applyCompleted(job.result);
        return;
      }
      if (job.status === 'failed') {
        store.applyFailed(job.error ?? 'Unknown error');
        return;
      }
    } catch {
      // Job not found — stream will handle it
    }
  }

  if (store.status !== 'completed' && store.status !== 'failed') {
    useJobStream(props.jobId);
  }
});

const matrix = computed(() => store.result?.riskMatrix ?? null);
const correlations = computed(() => matrix.value?.correlations ?? []);

const correlationClass: Record<string, string> = {
  CRITICAL: 'border-red-800 bg-red-950/30 text-red-300',
  HIGH:     'border-orange-800 bg-orange-950/30 text-orange-300',
  MEDIUM:   'border-yellow-800 bg-yellow-950/30 text-yellow-300',
  LOW:      'border-green-800 bg-green-950/30 text-green-300',
};
</script>

<template>
  <div class="space-y-8">
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-2xl font-bold text-white">Risk Analysis</h2>
        <div v-if="store.result" class="flex items-center gap-2 mt-1">
          <p class="text-slate-400 text-sm">{{ store.result.repoUrl }}</p>
          <span
            v-if="jobId === 'cached'"
            class="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-900/50 text-emerald-400 border border-emerald-700"
          >cached</span>
        </div>
      </div>
      <RouterLink to="/" class="text-sm text-slate-400 hover:text-white transition-colors">
        ← New analysis
      </RouterLink>
    </div>

    <!-- In-progress -->
    <JobProgressBar
      v-if="store.status === 'waiting' || store.status === 'active'"
      :progress="store.progress"
      :stage="store.stage"
      :status="store.status"
    />

    <!-- Error -->
    <div
      v-if="store.status === 'failed'"
      class="bg-red-950/40 border border-red-800 rounded-xl p-5 text-red-300"
    >
      <p class="font-semibold">Analysis failed</p>
      <p class="text-sm mt-1 text-red-400">{{ store.error }}</p>
    </div>

    <!-- Results -->
    <template v-if="store.status === 'completed' && matrix">
      <!-- Phase score cards — all 8 pipeline phases -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <RiskSummaryCard
          v-for="phase in ALL_PHASES"
          :key="phase"
          :phase="matrix.phaseScores[phase]"
        />
      </div>

      <!-- Phase selector + Risk matrix -->
      <div class="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
        <div class="flex items-center justify-between flex-wrap gap-3">
          <h3 class="text-lg font-semibold text-white">Risk Matrix</h3>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="phase in ALL_PHASES"
              :key="phase"
              class="px-3 py-1 rounded-full text-xs font-medium capitalize transition-colors"
              :class="activePhase === phase
                ? 'bg-blue-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:text-white'"
              @click="activePhase = phase"
            >{{ phase }}</button>
          </div>
        </div>
        <div class="overflow-x-auto">
          <RiskMatrixGrid :items="matrix.items" :phase="activePhase" />
        </div>
        <p class="text-xs text-slate-600">
          X-axis: Likelihood (1=Rare, 5=Almost Certain) · Y-axis: Impact (1=Negligible, 5=Critical) · Showing findings relevant to the <span class="capitalize text-slate-500">{{ activePhase }}</span> phase
        </p>
      </div>

      <!-- Correlations -->
      <div v-if="correlations.length > 0" class="space-y-3">
        <h3 class="text-lg font-semibold text-white">Cross-Phase Correlations</h3>
        <div
          v-for="c in correlations"
          :key="c.type"
          class="border rounded-lg px-4 py-3 text-sm"
          :class="correlationClass[c.severity]"
        >
          <span class="font-semibold mr-2">{{ c.severity }}</span>
          {{ c.message }}
          <span v-if="c.affectedPhases.length" class="ml-2 text-xs opacity-70">
            ({{ c.affectedPhases.join(' → ') }})
          </span>
        </div>
      </div>

      <!-- Issue table scoped to active phase -->
      <div class="space-y-3">
        <h3 class="text-lg font-semibold text-white">
          Findings — <span class="capitalize text-blue-400">{{ activePhase }}</span> phase
        </h3>
        <IssueTable :items="matrix.items" :phase="activePhase" />
      </div>

      <!-- SonarQube link -->
      <div v-if="store.result?.sonarDashboardUrl" class="text-sm text-slate-500">
        Full SonarQube report:
        <a :href="store.result.sonarDashboardUrl" target="_blank" rel="noopener" class="text-blue-400 hover:underline">
          {{ store.result.sonarDashboardUrl }}
        </a>
      </div>
    </template>
  </div>
</template>
