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
import type { RiskPhase, RiskGrade, PhaseScore, CommitRiskPoint, RiskMatrix, Artifact, RiskItem } from '@devops-risk-analyzer/shared';

type PhaseFilter = RiskPhase | 'overall';

const ALL_PHASES: RiskPhase[] = ['plan', 'code', 'build', 'test', 'release', 'deploy', 'operate', 'monitor'];
const ALL_ARTIFACTS: Artifact[] = ['documentation', 'source-code', 'testing', 'deployment'];
const ARTIFACT_LABELS: Record<Artifact, string> = {
  'documentation': 'Documentation',
  'source-code':   'Source Code',
  'testing':       'Testing',
  'deployment':    'Deployment',
};

const props = defineProps<{ jobId: string; timelineJobId?: string }>();
const store = useJobStore();
const activeArtifact = ref<Artifact>('source-code');
const activePhase = ref<PhaseFilter>('code');
const selectedCommit = ref<CommitRiskPoint | null>(null);

// Bootstrap: if store has no job set (e.g. direct URL navigation), poll once then stream
onMounted(async () => {
  if (props.jobId !== 'cached') {
    if (store.jobId !== props.jobId) {
      store.setJob(props.jobId);
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

  if (props.timelineJobId && store.timelineJobId !== props.timelineJobId) {
    store.setTimeline(props.timelineJobId);
  }

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

watch(activePhase, () => { selectedCommit.value = null; });
watch(activeArtifact, () => { selectedCommit.value = null; });

const mergedTimelinePoints = computed<CommitRiskPoint[]>(() => {
  const pts = store.timelineResult?.points ?? [];
  const headSha = store.result?.commitSha;
  const headMatrix = store.result?.riskMatrix;
  if (!headSha || !headMatrix) return pts;
  return pts.map(p => p.sha === headSha ? { ...p, riskMatrix: headMatrix } : p);
});

const displayMatrix = computed<RiskMatrix | null>(() =>
  selectedCommit.value?.riskMatrix ?? store.result?.riskMatrix ?? null,
);

// Items filtered to the active artifact (or all items for the selected commit's matrix)
const artifactItems = computed<RiskItem[]>(() => {
  const matrix = displayMatrix.value;
  if (!matrix) return [];
  // When a commit is selected from the timeline, it has no artifact scores — show all items
  if (selectedCommit.value) return matrix.items;
  return matrix.items.filter(i => i.artifact === activeArtifact.value);
});

function buildOverallScore(items: RiskItem[], phaseScores: Record<RiskPhase, PhaseScore>): PhaseScore {
  const allScores = ALL_PHASES.map(ph => phaseScores[ph]);
  const avgScore = Math.round(allScores.reduce((sum, s) => sum + s.score, 0) / allScores.length);
  const withPhases = items.filter(i => i.phases.length > 0);
  const gradeMap = new Map<RiskGrade, number>([['CRITICAL', 0], ['HIGH', 0], ['MEDIUM', 0], ['LOW', 0]]);
  for (const item of withPhases) {
    const worst = item.phases.reduce((a, b) => b.riskLevel > a.riskLevel ? b : a);
    gradeMap.set(worst.riskGrade, gradeMap.get(worst.riskGrade)! + 1);
  }
  const grade: RiskGrade = gradeMap.get('CRITICAL')! > 0 ? 'CRITICAL'
    : gradeMap.get('HIGH')! > 0 ? 'HIGH'
    : gradeMap.get('MEDIUM')! > 0 ? 'MEDIUM' : 'LOW';
  return {
    phase: 'plan' as RiskPhase,
    score: avgScore,
    grade,
    itemCount: withPhases.length,
    breakdown: (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as RiskGrade[]).map(g => ({ grade: g, count: gradeMap.get(g)! })),
  };
}

const displayPhaseScore = computed<PhaseScore | null>(() => {
  const matrix = displayMatrix.value;
  if (!matrix) return null;

  // When a commit is selected, use its overall matrix (no artifact breakdown available)
  if (selectedCommit.value) {
    if (activePhase.value !== 'overall') return matrix.phaseScores[activePhase.value];
    return buildOverallScore(matrix.items, matrix.phaseScores);
  }

  const artifactScores = matrix.artifactPhaseScores?.[activeArtifact.value];
  if (!artifactScores) return null;

  if (activePhase.value !== 'overall') return artifactScores[activePhase.value];
  return buildOverallScore(artifactItems.value, artifactScores);
});

// Artifact badge: uses the same logic as the summary card
function artifactBadgeGrade(artifact: Artifact): RiskGrade | null {
  const matrix = displayMatrix.value;
  if (!matrix) return null;
  const artifactScores = matrix.artifactPhaseScores?.[artifact];
  if (!artifactScores) return null;
  const items = matrix.items.filter(i => i.artifact === artifact);
  return buildOverallScore(items, artifactScores).grade;
}

const GRADE_TAB_CLASS: Record<RiskGrade, string> = {
  CRITICAL: 'text-red-400 border-red-700',
  HIGH:     'text-orange-400 border-orange-700',
  MEDIUM:   'text-yellow-400 border-yellow-700',
  LOW:      'text-green-400 border-green-700',
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
    <template v-if="store.status === 'completed' && displayMatrix">

      <!-- Risk Trend Graph -->
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

      <!-- Artifact tabs -->
      <div v-if="!selectedCommit" class="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
        <div class="flex border-b border-slate-800">
          <button
            v-for="artifact in ALL_ARTIFACTS"
            :key="artifact"
            class="flex-1 px-4 py-3 text-sm font-medium transition-colors flex items-center justify-center gap-2"
            :class="activeArtifact === artifact
              ? 'bg-slate-800 text-white border-b-2 border-blue-500'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'"
            @click="activeArtifact = artifact"
          >
            {{ ARTIFACT_LABELS[artifact] }}
            <span
              v-if="artifactBadgeGrade(artifact)"
              class="text-xs px-1.5 py-0.5 rounded border font-semibold"
              :class="GRADE_TAB_CLASS[artifactBadgeGrade(artifact)!]"
            >{{ artifactBadgeGrade(artifact) }}</span>
          </button>
        </div>

        <!-- Empty state for Documentation tab when no Drive URL was submitted -->
        <div
          v-if="activeArtifact === 'documentation' && artifactItems.length === 0"
          class="px-6 py-10 text-center text-slate-500"
        >
          <p class="font-medium text-slate-400">No documentation findings</p>
          <p class="text-sm mt-1">Select a local documentation folder on the analysis form to enable AI-powered documentation risk analysis.</p>
        </div>

        <template v-else>
          <!-- Phase selector inside tab -->
          <div class="px-6 pt-4">
            <DevOpsPipelineSelector v-model="activePhase" />
          </div>

          <!-- Phase score card + Risk matrix -->
          <div class="p-6 flex flex-col lg:flex-row gap-6 items-start">
            <div class="w-full lg:w-64 flex-shrink-0">
              <RiskSummaryCard
                v-if="displayPhaseScore"
                :phase="displayPhaseScore"
                :label="activePhase === 'overall' ? `${ARTIFACT_LABELS[activeArtifact]} — Overall` : undefined"
              />
            </div>
            <div class="flex-1 bg-slate-950 border border-slate-800 rounded-xl p-5 space-y-4">
              <h3 class="text-base font-semibold text-white">Risk Matrix</h3>
              <div class="overflow-x-auto">
                <RiskMatrixGrid :items="artifactItems" :phase="activePhase" />
              </div>
              <p class="text-xs text-slate-600">
                X-axis: Likelihood · Y-axis: Impact ·
                {{ activePhase === 'overall' ? `All ${ARTIFACT_LABELS[activeArtifact]} findings` : `${ARTIFACT_LABELS[activeArtifact]} findings in ${activePhase} phase` }}
              </p>
            </div>
          </div>

          <!-- Findings table -->
          <div class="px-6 pb-6 space-y-3">
            <h3 class="text-base font-semibold text-white">
              Findings —
              <span class="text-blue-400">{{ ARTIFACT_LABELS[activeArtifact] }}</span>
              <span class="text-slate-500"> / </span>
              <span class="capitalize text-blue-400">{{ activePhase === 'overall' ? 'All Phases' : activePhase }}</span>
            </h3>
            <IssueTable :items="artifactItems" :phase="activePhase" />
          </div>
        </template>
      </div>

      <!-- When a commit is selected from timeline, show its full matrix without artifact split -->
      <template v-if="selectedCommit">
        <div class="bg-slate-900 border border-slate-800 rounded-2xl px-6 py-3">
          <DevOpsPipelineSelector v-model="activePhase" />
        </div>
        <div class="flex flex-col lg:flex-row gap-6 items-start">
          <div class="w-full lg:w-64 flex-shrink-0">
            <RiskSummaryCard
              v-if="displayPhaseScore"
              :phase="displayPhaseScore"
              :label="activePhase === 'overall' ? 'Overall' : undefined"
            />
          </div>
          <div class="flex-1 bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
            <div class="flex items-center justify-between gap-2">
              <h3 class="text-lg font-semibold text-white">Risk Matrix</h3>
              <span class="text-xs text-slate-400 bg-slate-800 px-2 py-1 rounded">
                {{ selectedCommit.shortSha }} · {{ new Date(selectedCommit.date).toLocaleDateString() }}
              </span>
            </div>
            <div class="overflow-x-auto">
              <RiskMatrixGrid :items="displayMatrix.items" :phase="activePhase" />
            </div>
          </div>
        </div>
        <div class="space-y-3">
          <h3 class="text-lg font-semibold text-white">
            Findings — <span class="capitalize text-blue-400">{{ activePhase === 'overall' ? 'All Phases' : activePhase }}</span>
          </h3>
          <IssueTable :items="displayMatrix.items" :phase="activePhase" />
        </div>
      </template>

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
