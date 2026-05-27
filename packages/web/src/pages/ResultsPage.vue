<script setup lang="ts">
import { onMounted, computed, ref } from 'vue';
import { useJobStore } from '../stores/jobStore.ts';
import { useJobStream } from '../composables/useJobStream.ts';
import { getJob } from '../api/client.ts';
import JobProgressBar from '../components/JobProgressBar.vue';
import RiskMatrixGrid from '../components/RiskMatrixGrid.vue';
import RiskSummaryCard from '../components/RiskSummaryCard.vue';
import IssueTable from '../components/IssueTable.vue';
import DevOpsPipelineSelector from '../components/DevOpsPipelineSelector.vue';
import type { RiskPhase } from '@devops-risk-analyzer/shared';

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
      <!-- DevOps pipeline phase selector -->
      <div class="bg-slate-900 border border-slate-800 rounded-2xl px-6 py-3">
        <DevOpsPipelineSelector v-model="activePhase" />
      </div>

      <!-- Phase score card + Risk matrix side by side -->
      <div class="flex flex-col lg:flex-row gap-6 items-start">
        <!-- Single score card for the active phase -->
        <div class="w-full lg:w-64 flex-shrink-0">
          <RiskSummaryCard :phase="matrix.phaseScores[activePhase]" />
        </div>

        <!-- Risk matrix -->
        <div class="flex-1 bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
          <h3 class="text-lg font-semibold text-white">Risk Matrix</h3>
          <div class="overflow-x-auto">
            <RiskMatrixGrid :items="matrix.items" :phase="activePhase" />
          </div>
          <p class="text-xs text-slate-600">
            X-axis: Likelihood (1=Rare, 5=Almost Certain) · Y-axis: Impact (1=Negligible, 5=Critical) · Showing findings relevant to the <span class="capitalize text-slate-500">{{ activePhase }}</span> phase
          </p>
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
