<script setup lang="ts">
import { computed } from 'vue';
import type { CommitRiskPoint, RiskPhase } from '@devops-risk-analyzer/shared';

type PhaseFilter = RiskPhase | 'overall';

const ALL_PHASES: RiskPhase[] = ['plan', 'code', 'build', 'test', 'release', 'deploy', 'operate', 'monitor'];

const props = defineProps<{
  points: CommitRiskPoint[];
  phase: PhaseFilter;
  loading: boolean;
  selectedSha?: string;
}>();

const emit = defineEmits<{
  (e: 'commit-click', point: CommitRiskPoint): void;
}>();

// SVG layout constants
const W = 1000;
const H = 300;
const PAD_LEFT = 52;
const PAD_RIGHT = 20;
const PAD_TOP = 20;
const PAD_BOTTOM = 48;
const PLOT_W = W - PAD_LEFT - PAD_RIGHT;
const PLOT_H = H - PAD_TOP - PAD_BOTTOM;

const GRADE_COLORS: Record<string, string> = {
  LOW: '#15803d',
  MEDIUM: '#a16207',
  HIGH: '#c2410c',
  CRITICAL: '#b91c1c',
};

const GRADE_STROKE: Record<string, string> = {
  LOW: '#16a34a',
  MEDIUM: '#ca8a04',
  HIGH: '#ea580c',
  CRITICAL: '#dc2626',
};

const PHASE_COLORS: Record<RiskPhase, string> = {
  plan:    '#8b5cf6',
  code:    '#3b82f6',
  build:   '#f97316',
  test:    '#22c55e',
  release: '#ec4899',
  deploy:  '#14b8a6',
  operate: '#f59e0b',
  monitor: '#ef4444',
};

interface PlotPoint {
  x: number;
  y: number;
  score: number;
  grade: string;
  point: CommitRiskPoint;
  dateLabel: string;
}

function buildXCoords(points: CommitRiskPoint[]) {
  const timestamps = points.map(p => new Date(p.date).getTime());
  const minT = Math.min(...timestamps);
  const maxT = Math.max(...timestamps);
  const rangeT = maxT - minT || 1;
  return points.map(p => {
    const t = new Date(p.date).getTime();
    const xFrac = points.length === 1 ? 0.5 : (t - minT) / rangeT;
    return PAD_LEFT + xFrac * PLOT_W;
  });
}

// Single-phase plot points
const plotPoints = computed<PlotPoint[]>(() => {
  if (props.phase === 'overall' || props.points.length === 0) return [];
  const xs = buildXCoords(props.points);
  return props.points.map((p, i) => {
    const score = p.riskMatrix.phaseScores[props.phase as RiskPhase]?.score ?? 0;
    const grade = p.riskMatrix.phaseScores[props.phase as RiskPhase]?.grade ?? 'LOW';
    const y = PAD_TOP + PLOT_H - (score / 100) * PLOT_H;
    const d = new Date(p.date);
    const dateLabel = `${d.getMonth() + 1}/${d.getDate()}`;
    return { x: xs[i], y, score, grade, point: p, dateLabel };
  });
});

const polylinePoints = computed(() =>
  plotPoints.value.map(p => `${p.x},${p.y}`).join(' '),
);

// Overall mode — one line per phase
const phaseLines = computed(() => {
  if (props.phase !== 'overall' || props.points.length === 0) return [];
  const xs = buildXCoords(props.points);
  return ALL_PHASES.map(ph => ({
    phase: ph,
    color: PHASE_COLORS[ph],
    pts: props.points.map((p, i) => {
      const score = p.riskMatrix.phaseScores[ph]?.score ?? 0;
      const y = PAD_TOP + PLOT_H - (score / 100) * PLOT_H;
      const d = new Date(p.date);
      return { x: xs[i], y, score, point: p, dateLabel: `${d.getMonth() + 1}/${d.getDate()}` };
    }),
  }));
});

// X positions for the overall selected-commit indicator
const selectedOverallX = computed(() => {
  if (props.phase !== 'overall' || !props.selectedSha || phaseLines.value.length === 0) return null;
  const pt = phaseLines.value[0].pts.find(p => p.point.sha === props.selectedSha);
  return pt?.x ?? null;
});

// Y-axis gridlines at 0, 25, 50, 75, 100
const gridLines = [0, 25, 50, 75, 100].map(v => ({
  value: v,
  y: PAD_TOP + PLOT_H - (v / 100) * PLOT_H,
}));

// X-axis date labels — at most 8, evenly spaced
const xLabels = computed(() => {
  const source = props.phase === 'overall' ? phaseLines.value[0]?.pts ?? [] : plotPoints.value;
  if (source.length === 0) return [];
  const step = Math.max(1, Math.ceil(source.length / 8));
  return source.filter((_, i) => i % step === 0 || i === source.length - 1);
});
</script>

<template>
  <!-- Loading skeleton -->
  <div v-if="loading && points.length === 0" class="flex items-center justify-center h-40">
    <div class="flex gap-3 items-end">
      <div v-for="h in [40, 70, 30, 90, 55, 80, 45]" :key="h"
        class="w-3 rounded-sm bg-slate-700 animate-pulse"
        :style="{ height: h + 'px' }"
      />
    </div>
    <span class="ml-4 text-slate-500 text-sm">Loading commits…</span>
  </div>

  <!-- Empty state -->
  <div v-else-if="!loading && points.length === 0"
    class="flex items-center justify-center h-32 text-slate-500 text-sm"
  >
    No commit data available for this period.
  </div>

  <!-- Graph -->
  <div v-else>
    <svg
      :viewBox="`0 0 ${W} ${H}`"
      width="100%"
      :height="H"
      class="overflow-visible"
    >
      <!-- Gridlines -->
      <g class="gridlines">
        <line
          v-for="gl in gridLines"
          :key="gl.value"
          :x1="PAD_LEFT"
          :y1="gl.y"
          :x2="W - PAD_RIGHT"
          :y2="gl.y"
          stroke="#1e293b"
          stroke-width="1"
        />
      </g>

      <!-- Y-axis labels -->
      <g class="y-labels">
        <text
          v-for="gl in gridLines"
          :key="gl.value"
          :x="PAD_LEFT - 6"
          :y="gl.y + 4"
          text-anchor="end"
          fill="#64748b"
          font-size="11"
        >{{ gl.value }}</text>
      </g>

      <!-- Y-axis title -->
      <text
        :x="10"
        :y="PAD_TOP + PLOT_H / 2"
        fill="#64748b"
        font-size="11"
        text-anchor="middle"
        :transform="`rotate(-90, 10, ${PAD_TOP + PLOT_H / 2})`"
      >Risk score</text>

      <!-- X-axis date labels -->
      <g class="x-labels">
        <text
          v-for="pt in xLabels"
          :key="pt.point.sha"
          :x="pt.x"
          :y="H - 6"
          text-anchor="middle"
          fill="#64748b"
          font-size="11"
        >{{ pt.dateLabel }}</text>
      </g>

      <!-- ── Single-phase rendering ── -->
      <template v-if="phase !== 'overall'">
        <!-- Connecting line -->
        <polyline
          v-if="plotPoints.length > 1"
          :points="polylinePoints"
          fill="none"
          stroke="#334155"
          stroke-width="2"
          stroke-linejoin="round"
        />

        <!-- Commit nodes -->
        <g
          v-for="pt in plotPoints"
          :key="pt.point.sha"
          class="cursor-pointer"
          @click="emit('commit-click', pt.point)"
        >
          <circle
            v-if="pt.point.sha === selectedSha"
            :cx="pt.x"
            :cy="pt.y"
            r="13"
            fill="none"
            stroke="white"
            stroke-width="2"
            opacity="0.6"
          />
          <circle
            :cx="pt.x"
            :cy="pt.y"
            :r="pt.point.sha === selectedSha ? 9 : 7"
            :fill="GRADE_COLORS[pt.grade] ?? GRADE_COLORS.LOW"
            :stroke="GRADE_STROKE[pt.grade] ?? GRADE_STROKE.LOW"
            stroke-width="1.5"
          >
            <title>{{ pt.point.shortSha }} — {{ pt.score }}/100 ({{ pt.grade }})&#10;{{ pt.point.message }}&#10;{{ pt.point.author }} · {{ new Date(pt.point.date).toLocaleDateString() }}</title>
          </circle>
        </g>
      </template>

      <!-- ── Overall: overlaid phase lines ── -->
      <template v-else>
        <!-- Selected-commit vertical indicator -->
        <line
          v-if="selectedOverallX !== null"
          :x1="selectedOverallX"
          :y1="PAD_TOP"
          :x2="selectedOverallX"
          :y2="PAD_TOP + PLOT_H"
          stroke="white"
          stroke-width="1"
          opacity="0.25"
          stroke-dasharray="4 4"
        />

        <!-- One polyline per phase -->
        <polyline
          v-for="pl in phaseLines"
          v-show="pl.pts.length > 1"
          :key="'line-' + pl.phase"
          :points="pl.pts.map(p => `${p.x},${p.y}`).join(' ')"
          fill="none"
          :stroke="pl.color"
          stroke-width="2"
          stroke-linejoin="round"
          opacity="0.85"
        />

        <!-- Dots per phase per commit -->
        <g v-for="pl in phaseLines" :key="'dots-' + pl.phase">
          <circle
            v-for="pt in pl.pts"
            :key="pt.point.sha + '-' + pl.phase"
            :cx="pt.x"
            :cy="pt.y"
            r="3.5"
            :fill="pl.color"
            stroke="#0f172a"
            stroke-width="1"
            class="cursor-pointer hover:opacity-90"
            @click="emit('commit-click', pt.point)"
          >
            <title>{{ pl.phase }}: {{ pt.score }}/100&#10;{{ pt.point.shortSha }} · {{ pt.point.author }} · {{ new Date(pt.point.date).toLocaleDateString() }}</title>
          </circle>
        </g>
      </template>

      <!-- Loading overlay -->
      <g v-if="loading">
        <circle
          v-for="pt in (phase === 'overall' ? (phaseLines[0]?.pts ?? []) : plotPoints)"
          :key="pt.point.sha + '-loading'"
          :cx="pt.x"
          :cy="pt.y"
          r="4"
          fill="#475569"
          opacity="0.6"
        />
      </g>
    </svg>

    <!-- Overall legend -->
    <div v-if="phase === 'overall'" class="flex flex-wrap gap-x-5 gap-y-1 mt-2 text-xs text-slate-400">
      <span v-for="ph in ALL_PHASES" :key="ph" class="flex items-center gap-1.5">
        <svg width="20" height="10">
          <line x1="0" y1="5" x2="20" y2="5" :stroke="PHASE_COLORS[ph]" stroke-width="2.5" stroke-linecap="round"/>
        </svg>
        {{ ph }}
      </span>
    </div>
  </div>
</template>
