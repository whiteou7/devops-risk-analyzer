<script setup lang="ts">
import { computed, ref } from 'vue';
import type { RiskItem, RiskPhase } from '@devops-risk-analyzer/shared';

type PhaseFilter = RiskPhase | 'overall';

const props = defineProps<{
  items: RiskItem[];
  phase: PhaseFilter;
}>();

// Grid config
const CELL = 80;   // px per cell
const PAD  = 48;   // axis label padding
const SIZE = 5;
const W = PAD + SIZE * CELL;
const H = PAD + SIZE * CELL;

// Cell background colors by risk level (likelihood × impact)
function cellColor(likelihood: number, impact: number): string {
  const level = likelihood * impact;
  if (level >= 20) return '#7f1d1d'; // red-900
  if (level >= 10) return '#7c2d12'; // orange-900
  if (level >= 5)  return '#713f12'; // yellow-900
  return '#14532d';                  // green-900
}

const phaseItems = computed(() => {
  if (props.phase === 'overall') {
    return props.items.flatMap(item => {
      if (item.phases.length === 0) return [];
      const worst = item.phases.reduce((a, b) => b.riskLevel > a.riskLevel ? b : a);
      return [{ item, likelihood: worst.likelihood, impact: worst.impact, riskGrade: worst.riskGrade }];
    });
  }
  return props.items.flatMap(item => {
    const pm = item.phases.find(p => p.phase === props.phase);
    if (!pm) return [];
    return [{ item, likelihood: pm.likelihood, impact: pm.impact, riskGrade: pm.riskGrade }];
  });
});

// Group items by (likelihood, impact) cell
const cellItems = computed(() => {
  const map = new Map<string, typeof phaseItems.value>();
  for (const entry of phaseItems.value) {
    const key = `${entry.likelihood}-${entry.impact}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(entry);
  }
  return map;
});

// Tooltip state
const tooltip = ref<{ x: number; y: number; item: RiskItem; riskGrade: string } | null>(null);

function cellX(likelihood: number): number {
  return PAD + (likelihood - 1) * CELL;
}
function cellY(impact: number): number {
  // impact 5 at top, 1 at bottom
  return (SIZE - impact) * CELL;
}

function showTooltip(event: MouseEvent, item: RiskItem, riskGrade: string): void {
  const rect = (event.target as SVGElement).getBoundingClientRect();
  tooltip.value = { x: rect.left + 40, y: rect.top - 8, item, riskGrade };
}
function hideTooltip(): void {
  tooltip.value = null;
}

// Dot positions — stack items in a cell as small circles
function dotsForCell(likelihood: number, impact: number) {
  const entries = cellItems.value.get(`${likelihood}-${impact}`) ?? [];
  const cx0 = cellX(likelihood) + CELL / 2;
  const cy0 = cellY(impact) + CELL / 2;
  const cols = Math.ceil(Math.sqrt(entries.length));
  return entries.map((entry, i) => ({
    ...entry,
    cx: cx0 + ((i % cols) - (cols - 1) / 2) * 14,
    cy: cy0 + (Math.floor(i / cols) - (Math.ceil(entries.length / cols) - 1) / 2) * 14,
  }));
}

const SOURCE_COLORS: Record<string, string> = {
  'sonarqube':        '#3b82f6', // blue-500
  'trivy':            '#f97316', // orange-500
  'gitleaks':         '#ef4444', // red-500
  'hadolint':         '#eab308', // yellow-500
  'checkov':          '#a855f7', // purple-500
  'git-hygiene':      '#14b8a6', // teal-500
  'github-actions':   '#22c55e', // green-500
  'ai-documentation': '#ec4899', // pink-500
};

function dotColor(source: string): string {
  return SOURCE_COLORS[source] ?? '#94a3b8';
}

const allDots = computed(() => {
  const dots: ReturnType<typeof dotsForCell>[number][] = [];
  for (let l = 1; l <= 5; l++) {
    for (let im = 1; im <= 5; im++) {
      dots.push(...dotsForCell(l, im));
    }
  }
  return dots;
});

function gradeClass(grade: string): string {
  return ({
    CRITICAL: 'text-red-400 font-semibold',
    HIGH:     'text-orange-400 font-semibold',
    MEDIUM:   'text-yellow-400',
    LOW:      'text-green-400',
  } as Record<string, string>)[grade] ?? 'text-slate-300';
}
</script>

<template>
  <div class="relative select-none">
    <svg :width="W" :height="H + PAD" class="overflow-visible">
      <!-- Y-axis label -->
      <text
        :x="12"
        :y="H / 2"
        text-anchor="middle"
        fill="#94a3b8"
        font-size="12"
        :transform="`rotate(-90, 12, ${H / 2})`"
      >Impact</text>

      <!-- X-axis label -->
      <text
        :x="PAD + (SIZE * CELL) / 2"
        :y="H + PAD - 4"
        text-anchor="middle"
        fill="#94a3b8"
        font-size="12"
      >Likelihood</text>

      <g :transform="`translate(${PAD}, 0)`">
        <!-- Grid cells -->
        <template v-for="impact in [5, 4, 3, 2, 1]" :key="`row-${impact}`">
          <template v-for="likelihood in [1, 2, 3, 4, 5]" :key="`cell-${likelihood}-${impact}`">
            <rect
              :x="cellX(likelihood) - PAD"
              :y="cellY(impact)"
              :width="CELL - 1"
              :height="CELL - 1"
              rx="4"
              :fill="cellColor(likelihood, impact)"
              stroke="#1e293b"
              stroke-width="2"
            />
          </template>
        </template>

        <!-- Y-axis tick labels (impact) -->
        <template v-for="impact in [1, 2, 3, 4, 5]" :key="`ylabel-${impact}`">
          <text
            :x="-8"
            :y="cellY(impact) + CELL / 2 + 4"
            text-anchor="end"
            fill="#94a3b8"
            font-size="11"
          >{{ impact }}</text>
        </template>

        <!-- X-axis tick labels (likelihood) -->
        <template v-for="l in [1, 2, 3, 4, 5]" :key="`xlabel-${l}`">
          <text
            :x="cellX(l) - PAD + CELL / 2"
            :y="H + 16"
            text-anchor="middle"
            fill="#94a3b8"
            font-size="11"
          >{{ l }}</text>
        </template>

        <!-- Quadrant labels -->
        <text :x="cellX(1) - PAD + 4" :y="cellY(5) + 14" fill="#64748b" font-size="10">Low L / High I</text>
        <text :x="cellX(4) - PAD + 4" :y="cellY(5) + 14" fill="#dc2626" font-size="10" font-weight="600">Critical</text>
        <text :x="cellX(1) - PAD + 4" :y="cellY(1) + 14" fill="#16a34a" font-size="10">Low Risk</text>
        <text :x="cellX(4) - PAD + 4" :y="cellY(1) + 14" fill="#64748b" font-size="10">High L / Low I</text>

        <!-- Risk item dots -->
        <template v-for="dot in allDots" :key="`${dot.item.id}-${phase}`">
          <circle
            :cx="dot.cx - PAD"
            :cy="dot.cy"
            r="6"
            :fill="dotColor(dot.item.source)"
            stroke="#0f172a"
            stroke-width="1.5"
            class="cursor-pointer hover:opacity-80 transition-opacity"
            @mouseenter="showTooltip($event, dot.item, dot.riskGrade)"
            @mouseleave="hideTooltip"
          />
        </template>
      </g>
    </svg>

    <!-- Legend -->
    <div class="flex flex-wrap gap-3 mt-2 text-xs text-slate-400">
      <span v-for="[src, color] in Object.entries(SOURCE_COLORS)" :key="src" class="flex items-center gap-1.5">
        <span class="inline-block w-3 h-3 rounded-full" :style="{ background: color }"></span>
        {{ src }}
      </span>
    </div>

    <!-- Tooltip -->
    <Teleport to="body">
      <div
        v-if="tooltip"
        class="fixed z-50 bg-slate-800 border border-slate-700 rounded-lg p-3 shadow-xl text-sm max-w-xs pointer-events-none"
        :style="{ left: `${tooltip.x}px`, top: `${tooltip.y}px`, transform: 'translateY(-100%)' }"
      >
        <div class="space-y-1">
          <div class="font-semibold text-white">{{ tooltip.item.title }}</div>
          <div class="text-slate-400 text-xs">{{ tooltip.item.detail }}</div>
          <div class="flex flex-wrap gap-x-3 gap-y-0.5 text-xs mt-1">
            <span class="text-slate-500">
              {{ phase === 'overall' ? 'Worst phase risk' : `Risk in ${phase}` }}:
              <span :class="gradeClass(tooltip.riskGrade)"> {{ tooltip.riskGrade }}</span>
            </span>
          </div>
          <div class="text-xs text-slate-500 mt-1">
            <template v-if="phase === 'overall'">
              Phases:
              <span class="text-slate-400">{{ tooltip.item.phases.map(p => p.phase).join(', ') || 'none' }}</span>
            </template>
            <template v-else>
              Also affects:
              <span class="text-slate-400">
                {{ tooltip.item.phases.filter(p => p.phase !== phase).map(p => p.phase).join(', ') || 'none' }}
              </span>
            </template>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
