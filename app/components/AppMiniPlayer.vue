<script setup lang="ts">
const { current, playing, currentTime, duration, collapsed, toggle, seek, stop } = usePlayer()

const scrubbing = ref(false)
const scrubTime = ref(0)

const progressMax = computed(() => (duration.value > 0 ? duration.value : 0))
const progressValue = computed(() => (scrubbing.value ? scrubTime.value : currentTime.value))

function fmtDur(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function onScrubStart() {
  scrubbing.value = true
  scrubTime.value = currentTime.value
}

function onScrubInput(e: Event) {
  scrubTime.value = Number((e.target as HTMLInputElement).value)
}

function onScrubEnd() {
  if (scrubbing.value) seek(scrubTime.value)
  scrubbing.value = false
}
</script>

<template>
  <div v-if="current" class="mini-player-dock">
    <button
      v-if="collapsed"
      class="mini-toggle mini-toggle--expand"
      :class="{ 'mini-toggle--playing': playing }"
      type="button"
      aria-label="展开试听栏"
      @click="collapsed = false"
    >
      <svg class="mini-toggle-ico" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 14l5-5 5 5H7z" fill="currentColor" />
      </svg>
    </button>

    <div v-else class="mini">
      <button
        class="mini-toggle mini-toggle--collapse"
        :class="{ 'mini-toggle--playing': playing }"
        type="button"
        aria-label="收起试听栏"
        @click="collapsed = true"
      >
        <svg class="mini-toggle-ico" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7 10l5 5 5-5H7z" fill="currentColor" />
        </svg>
      </button>
      <div class="mini-head">
        <span class="mini-title">{{ current.title }} - {{ current.artist }}</span>
        <div class="mini-actions">
          <button
            class="mini-icon-btn"
            type="button"
            :aria-label="playing ? '暂停' : '播放'"
            @click="toggle"
          >
            <svg v-if="playing" class="mini-ico" viewBox="0 0 24 24" aria-hidden="true">
              <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" />
              <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" />
            </svg>
            <svg v-else class="mini-ico" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8 5.5v13l11-6.5-11-6.5z" fill="currentColor" />
            </svg>
          </button>
          <button class="mini-icon-btn" type="button" aria-label="关闭试听" @click="stop">
            <svg class="mini-ico" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M6.4 6.4a1 1 0 0 1 1.4 0L12 10.6l4.2-4.2a1 1 0 1 1 1.4 1.4L13.4 12l4.2 4.2a1 1 0 0 1-1.4 1.4L12 13.4l-4.2 4.2a1 1 0 0 1-1.4-1.4L10.6 12 6.4 7.8a1 1 0 0 1 0-1.4z"
                fill="currentColor"
              />
            </svg>
          </button>
        </div>
      </div>
      <div class="mini-progress">
        <span class="mini-time">{{ fmtDur(Math.floor(progressValue)) }}</span>
        <input
          class="mini-range"
          type="range"
          min="0"
          :max="progressMax"
          step="0.1"
          :value="progressValue"
          :disabled="progressMax <= 0"
          aria-label="播放进度"
          @pointerdown="onScrubStart"
          @input="onScrubInput"
          @change="onScrubEnd"
          @pointerup="onScrubEnd"
          @pointercancel="onScrubEnd"
        />
        <span class="mini-time">{{ fmtDur(Math.floor(duration)) }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mini-player-dock {
  --dock-bottom: 16px;
  position: fixed;
  left: 0;
  right: 0;
  bottom: var(--dock-bottom);
  z-index: 35;
  pointer-events: none;
}

@media (max-width: 768px) {
  .mini-player-dock {
    --dock-bottom: calc(64px + env(safe-area-inset-bottom, 0px));
  }
}

.mini-toggle {
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 76px;
  height: 26px;
  padding: 0;
  border: 2px solid var(--accent);
  background: color-mix(in oklab, var(--accent) 16%, var(--surface));
  color: var(--accent);
  cursor: pointer;
  box-shadow:
    0 2px 10px color-mix(in oklab, var(--accent) 28%, transparent),
    var(--shadow);
  -webkit-tap-highlight-color: transparent;
}
.mini-toggle:hover {
  background: color-mix(in oklab, var(--accent) 24%, var(--surface));
}
.mini-toggle:active {
  transform: scale(0.98);
}
.mini-toggle--expand {
  position: relative;
  left: 50%;
  transform: translateX(-50%);
  border-radius: 12px 12px 0 0;
  border-bottom: none;
  isolation: isolate;
}
.mini-toggle--expand:active {
  transform: translateX(-50%) scale(0.98);
}
.mini-toggle--collapse {
  position: absolute;
  top: 0;
  left: 50%;
  height: 36px;
  transform: translate(-50%, -50%);
  border-radius: 999px;
  z-index: 1;
  isolation: isolate;
}
.mini-toggle--collapse:active {
  transform: translate(-50%, -50%) scale(0.98);
}
.mini-toggle::before,
.mini-toggle::after {
  content: '';
  position: absolute;
  inset: -2px;
  border: 2px solid var(--accent);
  border-radius: inherit;
  opacity: 0;
  pointer-events: none;
}
.mini-toggle--expand::before,
.mini-toggle--expand::after {
  border-bottom: none;
}
.mini-toggle--playing {
  animation: mini-toggle-border-pulse 1.1s ease-in-out infinite;
}
.mini-toggle--playing::before,
.mini-toggle--playing::after {
  animation: mini-toggle-ripple 2.2s cubic-bezier(0.22, 0.61, 0.36, 1) infinite;
}
.mini-toggle--playing::after {
  animation-delay: 1.1s;
}
@keyframes mini-toggle-ripple {
  0% {
    transform: scale(1);
    opacity: 0.5;
  }
  100% {
    transform: scale(1.1);
    opacity: 0;
  }
}
@keyframes mini-toggle-border-pulse {
  0%,
  100% {
    border-color: var(--accent);
    box-shadow:
      0 2px 10px color-mix(in oklab, var(--accent) 28%, transparent),
      var(--shadow);
  }
  50% {
    border-color: color-mix(in oklab, var(--accent) 72%, white);
    box-shadow:
      0 2px 12px color-mix(in oklab, var(--accent) 38%, transparent),
      var(--shadow);
  }
}
@media (prefers-reduced-motion: reduce) {
  .mini-toggle--playing,
  .mini-toggle--playing::before,
  .mini-toggle--playing::after {
    animation: none;
  }
}
.mini-toggle-ico {
  width: 24px;
  height: 24px;
  display: block;
  flex-shrink: 0;
}

.mini {
  pointer-events: auto;
  margin: 0 16px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px 14px 10px;
  box-shadow: var(--shadow);
}
@media (max-width: 768px) {
  .mini {
    margin: 0 10px;
  }
}
.mini-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.mini-title {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
}
.mini-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.mini-progress {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}
.mini-time {
  flex-shrink: 0;
  width: 36px;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--muted);
  text-align: center;
}
.mini-range {
  flex: 1;
  min-width: 0;
  height: 4px;
  margin: 0;
  accent-color: var(--accent);
  cursor: pointer;
}
.mini-range:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.mini-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  cursor: pointer;
}
.mini-icon-btn:hover {
  background: var(--accent-soft);
  border-color: var(--accent);
  color: var(--accent);
}
.mini-ico {
  width: 18px;
  height: 18px;
  display: block;
}
</style>
