<script setup lang="ts">
import { computed } from 'vue';
import type { CommitRiskPoint, RiskPhase } from '@devops-risk-analyzer/shared';

const props = defineProps<{
  points: CommitRiskPoint[];
  phase: RiskPhase;
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

interface PlotPoint {
  x: number;
  y: number;
  score: number;
  grade: string;
  point: CommitRiskPoint;
  dateLabel: string;
}

const plotPoints = computed<PlotPoint[]>(() => {
  if (props.points.length === 0) return [];

  const timestamps = props.points.map(p => new Date(p.date).getTime());
  const minT = Math.min(...timestamps);
  const maxT = Math.max(...timestamps);
  const rangeT = maxT - minT || 1;

  return props.points.map((p, i) => {
    const score = p.riskMatrix.phaseScores[props.phase]?.score ?? 0;
    const grade = p.riskMatrix.phaseScores[props.phase]?.grade ?? 'LOW';
    const t = new Date(p.date).getTime();
    const xFrac = props.points.length === 1 ? 0.5 : (t - minT) / rangeT;
    const x = PAD_LEFT + xFrac * PLOT_W;
    const y = PAD_TOP + PLOT_H - (score / 100) * PLOT_H;
    const d = new Date(p.date);
    const dateLabel = `${d.getMonth() + 1}/${d.getDate()}`;
    return { x, y, score, grade, point: p, dateLabel };
  });
});

const polylinePoints = computed(() =>
  plotPoints.value.map(p => `${p.x},${p.y}`).join(' '),
);

// Y-axis gridlines at 0, 25, 50, 75, 100
const gridLines = [0, 25, 50, 75, 100].map(v => ({
  value: v,
  y: PAD_TOP + PLOT_H - (v / 100) * PLOT_H,
}));

// X-axis date labels — show every commit but de-duplicate if too many
const xLabels = computed(() => {
  const pts = plotPoints.value;
  if (pts.length === 0) return [];
  // Show at most 8 evenly-spaced labels
  const step = Math.max(1, Math.ceil(pts.length / 8));
  return pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
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
  <svg
    v-else
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
      <!-- Selection ring -->
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

      <!-- Node fill -->
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

    <!-- Loading overlay dots when loading but already have points -->
    <g v-if="loading">
      <circle
        v-for="pt in plotPoints"
        :key="pt.point.sha + '-loading'"
        :cx="pt.x"
        :cy="pt.y"
        r="4"
        fill="#475569"
        opacity="0.6"
      />
    </g>
  </svg>
</template>
