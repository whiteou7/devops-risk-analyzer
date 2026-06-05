<script setup lang="ts">
import { onMounted, computed, ref, watch } from 'vue';
import { useJobStore } from '../stores/jobStore.ts';
import { useJobStream } from '../composables/useJobStream.ts';
import { getJob, openTimelineJobStream } from '../api/client.ts';
import JobProgressBar from '../components/JobProgressBar.vue';
import RiskMatrixGrid from '../components/RiskMatrixGrid.vue';
import RiskSummaryCard from '../components/RiskSummaryCard.vue';
import IssueTable from '../components/IssueTable.vue';
import DevOpsPipelineSelector from '../components/DevOpsPipelineSelector.vue';
import RiskTrendGraph from '../components/RiskTrendGraph.vue';
import type { RiskPhase, RiskGrade, PhaseScore, CommitRiskPoint, RiskMatrix } from '@devops-risk-analyzer/shared';

type PhaseFilter = RiskPhase | 'overall';

const ALL_PHASES: RiskPhase[] = ['plan', 'code', 'build', 'test', 'release', 'deploy', 'operate', 'monitor'];

const props = defineProps<{ jobId: string; timelineJobId?: string }>();
const store = useJobStore();
const activePhase = ref<PhaseFilter>('code');
const selectedCommit = ref<CommitRiskPoint | null>(null);

// Bootstrap: if store has no job set (e.g. direct URL navigation), poll once then stream
onMounted(async () => {
  // 'cached' is a virtual job ID used when a result is served from the DB cache
  // without enqueuing a job. The store is already populated by HomePage.
  if (props.jobId !== 'cached') {
    if (store.jobId !== props.jobId) {
      store.setJob(props.jobId); // calls reset(), which clears timelineJobId
      try {
        const response = await getJob(props.jobId);
        const job = response.data;
        if (job.status === 'completed' && job.result) {
          store.applyCompleted(job.result);
        } else if (job.status === 'failed') {
          store.applyFailed(job.error ?? 'Unknown error');
        }
      } catch {
        // Job not found — stream will handle it
      }
    }

    if (store.status !== 'completed' && store.status !== 'failed') {
      useJobStream(props.jobId);
    }
  }

  // Restore timeline job from URL query param — must run after setJob since setJob calls reset()
  if (props.timelineJobId && store.timelineJobId !== props.timelineJobId) {
    store.setTimeline(props.timelineJobId);
  }

  // Start streaming the timeline job if one was requested
  if (store.timelineJobId && store.timelineStatus !== 'completed' && store.timelineStatus !== 'failed') {
    const es = openTimelineJobStream(store.timelineJobId);
    es.onmessage = (e: MessageEvent) => {
      const msg = JSON.parse(e.data as string) as { type: string; progress?: { value?: number; stage?: string }; result?: import('@devops-risk-analyzer/shared').TimelineResult; error?: string };
      if (msg.type === 'progress' && msg.progress) store.applyTimelineProgress(msg.progress);
      if (msg.type === 'completed' && msg.result) { store.applyTimelineCompleted(msg.result); es.close(); }
      if (msg.type === 'failed' && msg.error) { store.applyTimelineFailed(msg.error); es.close(); }
    };
    es.onerror = () => es.close();
  }
});

// When the active phase changes, deselect a commit so the graph feels fresh
watch(activePhase, () => { selectedCommit.value = null; });

// Merge the authoritative main-analysis result into the timeline point for the HEAD commit.
// The timeline runs lighter checks, so its HEAD scores can differ from the full analysis.
const mergedTimelinePoints = computed<CommitRiskPoint[]>(() => {
  const pts = store.timelineResult?.points ?? [];
  const headSha = store.result?.commitSha;
  const headMatrix = store.result?.riskMatrix;
  if (!headSha || !headMatrix) return pts;
  return pts.map(p => p.sha === headSha ? { ...p, riskMatrix: headMatrix } : p);
});

// Display the selected commit's matrix when a node is clicked, otherwise show main result
const displayMatrix = computed<RiskMatrix | null>(() =>
  selectedCommit.value?.riskMatrix ?? store.result?.riskMatrix ?? null,
);

const displayPhaseScore = computed<PhaseScore | null>(() => {
  const matrix = displayMatrix.value;
  if (!matrix) return null;
  if (activePhase.value !== 'overall') return matrix.phaseScores[activePhase.value];

  const allScores = ALL_PHASES.map(ph => matrix.phaseScores[ph]);
  const avgScore = Math.round(allScores.reduce((sum, s) => sum + s.score, 0) / allScores.length);
  const grade: RiskGrade = avgScore >= 75 ? 'CRITICAL' : avgScore >= 50 ? 'HIGH' : avgScore >= 25 ? 'MEDIUM' : 'LOW';
  const allItems = matrix.items.filter(i => i.phases.length > 0);
  const gradeMap = new Map<RiskGrade, number>([['CRITICAL', 0], ['HIGH', 0], ['MEDIUM', 0], ['LOW', 0]]);
  for (const item of allItems) {
    const worst = item.phases.reduce((a, b) => b.riskLevel > a.riskLevel ? b : a);
    gradeMap.set(worst.riskGrade, gradeMap.get(worst.riskGrade)! + 1);
  }
  return {
    phase: 'plan' as RiskPhase,
    score: avgScore,
    grade,
    itemCount: allItems.length,
    breakdown: (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as RiskGrade[]).map(g => ({ grade: g, count: gradeMap.get(g)! })),
  };
});

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
    <template v-if="store.status === 'completed' && displayMatrix">
      <!-- DevOps pipeline phase selector -->
      <div class="bg-slate-900 border border-slate-800 rounded-2xl px-6 py-3">
        <DevOpsPipelineSelector v-model="activePhase" />
      </div>

      <!-- Risk Trend Graph (shown below phase selector when timeline is requested) -->
      <div v-if="store.timelineJobId" class="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
        <div class="flex items-center justify-between flex-wrap gap-2">
          <h3 class="text-lg font-semibold text-white">Risk Trend — Past Month</h3>
          <span
            v-if="store.timelineStatus !== 'completed' && store.timelineStatus !== 'failed'"
            class="text-sm text-slate-400 animate-pulse"
          >
            Analyzing… {{ store.timelineProgress }}%
            <span v-if="store.timelineStage"> · {{ store.timelineStage }}</span>
          </span>
          <span v-else-if="store.timelineStatus === 'failed'" class="text-sm text-red-400">
            Trend analysis failed
          </span>
          <span v-else-if="selectedCommit" class="text-sm text-slate-400">
            Showing: {{ selectedCommit.shortSha }}
            <button
              class="ml-1 text-blue-400 hover:underline"
              @click="selectedCommit = null"
            >reset to HEAD</button>
          </span>
        </div>
        <RiskTrendGraph
          :points="mergedTimelinePoints"
          :phase="activePhase"
          :loading="store.timelineStatus !== 'completed' && store.timelineStatus !== 'failed'"
          :selected-sha="selectedCommit?.sha"
          @commit-click="selectedCommit = $event.sha === store.result?.commitSha ? null : $event"
        />
        <p class="text-xs text-slate-600">
          Click a node to view that commit's risk matrix below. "Code" phase scores for newly analyzed commits may exclude SonarQube.
        </p>
      </div>

      <!-- Phase score card + Risk matrix side by side -->
      <div class="flex flex-col lg:flex-row gap-6 items-start">
        <!-- Single score card for the active phase -->
        <div class="w-full lg:w-64 flex-shrink-0">
          <RiskSummaryCard
            v-if="displayPhaseScore"
            :phase="displayPhaseScore"
            :label="activePhase === 'overall' ? 'Overall' : undefined"
          />
        </div>

        <!-- Risk matrix -->
        <div class="flex-1 bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
          <div class="flex items-center justify-between gap-2">
            <h3 class="text-lg font-semibold text-white">Risk Matrix</h3>
            <span v-if="selectedCommit" class="text-xs text-slate-400 bg-slate-800 px-2 py-1 rounded">
              {{ selectedCommit.shortSha }} · {{ new Date(selectedCommit.date).toLocaleDateString() }}
            </span>
          </div>
          <div class="overflow-x-auto">
            <RiskMatrixGrid :items="displayMatrix.items" :phase="activePhase" />
          </div>
          <p class="text-xs text-slate-600">
            X-axis: Likelihood (1=Rare, 5=Almost Certain) · Y-axis: Impact (1=Negligible, 5=Critical) ·
            {{ activePhase === 'overall' ? 'Showing all findings (worst-phase position)' : `Showing findings relevant to the ${activePhase} phase` }}
          </p>
        </div>
      </div>

      <!-- Issue table scoped to active phase -->
      <div class="space-y-3">
        <h3 class="text-lg font-semibold text-white">
          Findings —
          <span class="capitalize text-blue-400">{{ activePhase === 'overall' ? 'All Phases' : activePhase }}</span>
        </h3>
        <IssueTable :items="displayMatrix.items" :phase="activePhase" />
      </div>

      <!-- SonarQube link -->
      <div v-if="store.result?.sonarDashboardUrl && !selectedCommit" class="text-sm text-slate-500">
        Full SonarQube report:
        <a :href="store.result.sonarDashboardUrl" target="_blank" rel="noopener" class="text-blue-400 hover:underline">
          {{ store.result.sonarDashboardUrl }}
        </a>
      </div>
    </template>
  </div>
</template>
