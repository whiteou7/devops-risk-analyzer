<script setup lang="ts">
import { computed, ref } from 'vue';
import type { RiskItem, RiskPhase } from '@devops-risk-analyzer/shared';

const props = defineProps<{
  items: RiskItem[];
  phaseFilter: RiskPhase | 'ALL';
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

// Filtered items
const filtered = computed(() =>
  props.phaseFilter === 'ALL'
    ? props.items
    : props.items.filter(i => i.phase === props.phaseFilter),
);

// Group items by (likelihood, impact) cell
const cellItems = computed(() => {
  const map = new Map<string, RiskItem[]>();
  for (const item of filtered.value) {
    const key = `${item.likelihood}-${item.impact}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }
  return map;
});

// Tooltip state
const tooltip = ref<{ x: number; y: number; items: RiskItem[] } | null>(null);

function cellX(likelihood: number): number {
  return PAD + (likelihood - 1) * CELL;
}
function cellY(impact: number): number {
  // impact 5 at top, 1 at bottom
  return (SIZE - impact) * CELL;
}

function showTooltip(event: MouseEvent, items: RiskItem[]): void {
  tooltip.value = { x: (event.target as SVGElement).getBoundingClientRect().left + 40, y: (event.target as SVGElement).getBoundingClientRect().top - 8, items };
}
function hideTooltip(): void {
  tooltip.value = null;
}

// Dot positions — stack items in a cell as small circles
function dotsForCell(likelihood: number, impact: number): { cx: number; cy: number; item: RiskItem }[] {
  const items = cellItems.value.get(`${likelihood}-${impact}`) ?? [];
  const cx0 = cellX(likelihood) + CELL / 2;
  const cy0 = cellY(impact) + CELL / 2;
  const cols = Math.ceil(Math.sqrt(items.length));
  return items.map((item, i) => ({
    item,
    cx: cx0 + ((i % cols) - (cols - 1) / 2) * 14,
    cy: cy0 + (Math.floor(i / cols) - (Math.ceil(items.length / cols) - 1) / 2) * 14,
  }));
}

function dotColor(phase: RiskPhase): string {
  return phase === 'DEV' ? '#3b82f6' : '#f97316'; // blue-500 : orange-500
}

const allDots = computed(() => {
  const dots: { cx: number; cy: number; item: RiskItem }[] = [];
  for (let l = 1; l <= 5; l++) {
    for (let im = 1; im <= 5; im++) {
      dots.push(...dotsForCell(l, im));
    }
  }
  return dots;
});
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
        <template v-for="dot in allDots" :key="dot.item.id">
          <circle
            :cx="dot.cx - PAD"
            :cy="dot.cy"
            r="6"
            :fill="dotColor(dot.item.phase)"
            stroke="#0f172a"
            stroke-width="1.5"
            class="cursor-pointer hover:opacity-80 transition-opacity"
            @mouseenter="showTooltip($event, [dot.item])"
            @mouseleave="hideTooltip"
          />
        </template>
      </g>
    </svg>

    <!-- Legend -->
    <div class="flex gap-4 mt-2 text-xs text-slate-400">
      <span class="flex items-center gap-1.5">
        <span class="inline-block w-3 h-3 rounded-full bg-blue-500"></span> Dev phase
      </span>
      <span class="flex items-center gap-1.5">
        <span class="inline-block w-3 h-3 rounded-full bg-orange-500"></span> Ops phase
      </span>
    </div>

    <!-- Tooltip -->
    <Teleport to="body">
      <div
        v-if="tooltip"
        class="fixed z-50 bg-slate-800 border border-slate-700 rounded-lg p-3 shadow-xl text-sm max-w-xs pointer-events-none"
        :style="{ left: `${tooltip.x}px`, top: `${tooltip.y}px`, transform: 'translateY(-100%)' }"
      >
        <template v-for="item in tooltip.items" :key="item.id">
          <div class="space-y-0.5">
            <div class="font-semibold text-white">{{ item.title }}</div>
            <div class="text-slate-400 text-xs">{{ item.detail }}</div>
            <div class="flex gap-2 text-xs mt-1">
              <span class="text-slate-500">Phase: <span class="text-slate-300">{{ item.phase }}</span></span>
              <span class="text-slate-500">Risk: <span :class="gradeClass(item.riskGrade)">{{ item.riskGrade }}</span></span>
            </div>
          </div>
        </template>
      </div>
    </Teleport>
  </div>
</template>

<script lang="ts">
function gradeClass(grade: string): string {
  return {
    CRITICAL: 'text-red-400 font-semibold',
    HIGH:     'text-orange-400 font-semibold',
    MEDIUM:   'text-yellow-400',
    LOW:      'text-green-400',
  }[grade] ?? 'text-slate-300';
}
</script>
