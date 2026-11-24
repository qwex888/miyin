/**
 * 浮层焦点管理（Esc 关闭 + 焦点内聚）。
 *
 * 为什么单独抽出来：`aria-modal="true"` 只是给屏幕阅读器的声明，它不会真的把焦点关在浮层里。
 * 不配焦点陷阱时，Tab 会跑到背后的表格/按钮上，键盘用户会「掉出」弹窗；关闭后焦点留在
 * 被卸载的节点上，直接回到 body 开头，下一次 Tab 又从导航栏开始。
 *
 * 约定：
 * - 容器拿 `tabindex="-1"`，这样容器内没有任何可聚焦元素时也能接管焦点。
 * - 只处理可见元素：`v-show` 隐藏的面板里没有布局盒，`offsetParent`/`getClientRects` 为空，
 *   一律排除，否则 Tab 会跳到隐藏的 textarea 里（音源抽屉的 URL/上传/脚本三个面板就是这样）。
 * - 关闭动作交给调用方（可能因为 loading 被拒），本 composable 只负责判定与还原焦点。
 */
import type { Ref } from 'vue'

const TABBABLE = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'audio[controls]',
  'video[controls]',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function isVisible(el: HTMLElement): boolean {
  if (el.tabIndex < 0) return false
  if (el.hasAttribute('hidden')) return false
  return el.getClientRects().length > 0
}

function tabbablesIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(TABBABLE)).filter(isVisible)
}

type FocusTrapOptions = {
  /** 浮层根节点 */
  container: Ref<HTMLElement | null>
  /** 当前是否打开（用函数而非 ref，方便传 `() => open.value`） */
  isOpen: () => boolean
  /** Esc 触发；是否真的关闭由调用方决定 */
  onEscape?: () => void
  /** 打开后优先聚焦的元素，缺省取容器内第一个可聚焦元素 */
  initialFocus?: () => HTMLElement | null | undefined
}

export function useFocusTrap(options: FocusTrapOptions) {
  /** 打开前的焦点位置，关闭时还原 */
  let restoreTo: HTMLElement | null = null

  function focusWith(el: HTMLElement | null | undefined) {
    el?.focus({ preventScroll: true })
  }

  function onKeydown(e: KeyboardEvent) {
    if (!options.isOpen()) return

    if (e.key === 'Escape') {
      if (e.defaultPrevented) return
      e.preventDefault()
      options.onEscape?.()
      return
    }

    if (e.key !== 'Tab') return
    const root = options.container.value
    if (!root) return

    const list = tabbablesIn(root)
    const active = document.activeElement as HTMLElement | null

    // 容器内什么都没有可聚焦的：把焦点钉在容器上，别让它跑出去
    if (!list.length) {
      e.preventDefault()
      focusWith(root)
      return
    }

    const first = list[0]!
    const last = list[list.length - 1]!

    // 焦点已经掉到浮层外（例如点了背景被 blur）：按方向拉回边界
    if (!active || !root.contains(active)) {
      e.preventDefault()
      focusWith(e.shiftKey ? last : first)
      return
    }

    if (e.shiftKey && active === first) {
      e.preventDefault()
      focusWith(last)
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      focusWith(first)
    }
  }

  watch(
    () => options.isOpen(),
    async (open) => {
      if (open) {
        restoreTo = (document.activeElement as HTMLElement | null) ?? null
        await nextTick()
        const root = options.container.value
        if (!root) return
        focusWith(options.initialFocus?.() || tabbablesIn(root)[0] || root)
      } else {
        const target = restoreTo
        restoreTo = null
        await nextTick()
        // 触发按钮可能随列表刷新被重建，节点已脱离文档时交给浏览器默认行为
        if (target?.isConnected) focusWith(target)
      }
    },
  )

  onMounted(() => window.addEventListener('keydown', onKeydown))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
}
