/**
 * 选择器单一真相源。
 *
 * 为什么单独抽出来：UI 用例最脆的地方是选择器，而它们散落在各个 spec 里时，
 * 一次改版要翻十几个文件。这里集中维护，并标注「依据」（真实 DOM 结构），
 * 让后续维护者/AI 能判断该改选择器还是该报 bug。
 *
 * 约定：
 * - 能靠语义（role / aria-label）就不要靠 class；下面的 class 都是实测确认存在且稳定的。
 * - 分组 tab（队列 / 设置分类 / 搜索平台）共用 `.tabs > .tab`，没有 role=tab，
 *   所以要靠容器区分：队列与设置用 `.tabs`，搜索页平台 tab 取「最后一个 .tabs」。
 * - 弹窗外层是 `.overlay[role=presentation]`，内层才是 `[role=alertdialog]` / `[role=dialog]`。
 *   断言「弹窗出现」时用内层语义角色，验证「可点区域」时用外层 `.overlay`。
 */

export const sel = {
  // ---- 骨架 / 导航 ----
  mainNav: 'nav[aria-label="主导航"] a',
  bottomNav: 'nav.bottom-nav',

  // ---- 搜索页 ----
  searchInput: '.search-bar input.input',
  searchButton: '.search-bar button',
  songRow: '.song-list .row',
  songRowCheck: '.song-list .row-check',
  /**
   * ⚠️ 行内复选框必须用相对选择器。
   * 拿 `.song-list .row-check` 去 `row.locator(...)` 会变成「在行内找后代 .song-list」，
   * 永远匹配不到 —— 这是本项目 E2E 踩过的坑，单独保留这个常量避免复发。
   */
  songRowCheckIn: '.row-check',
  platformTabs: '.tabs', // 取 last()，再 .tab
  groupTab: '.tabs .tab',
  toolbarCount: '.toolbar .check',
  toolbarSelectAll: '.toolbar .check input[type="checkbox"]',
  toolbarActions: '.toolbar-actions button',
  detailPanel: '.detail-sheet, .card.detail',
  /** 详情面板在移动端是底部抽屉，关闭按钮只有 aria-label */
  closeButton: '[aria-label="关闭"]',

  // ---- 弹窗 ----
  overlay: '.overlay',
  alertDialog: '[role="alertdialog"]',
  dialog: '[role="dialog"]',
  menuItem: '[role="menuitem"]',

  // ---- 下载队列 ----
  task: '.task',
  taskCheck: '.task .task-check input',
  queueQualityFilter: 'select[aria-label="音质筛选"]',
  queueSearch: '检索下载记录', // 用 getByLabel

  // ---- 音源页 ----
  sourceTable: 'table tbody tr',
  sourceMore: '.ops-more-btn',

  // ---- 设置页 ----
  settingsTabs: '[aria-label="设置分类"] .tab',

  // ---- 登录页 ----
  loginPassword: 'input[type="password"]',
  loginSubmit: 'button[type="submit"]',
}

/** 后端接口路径常量，避免 spec 里散落字符串。 */
export const api = {
  health: '/api/health',
  search: '/api/search',
  downloads: '/api/downloads',
  sources: '/api/sources',
  settings: '/api/settings',
  authMe: '/api/auth/me',
  authLogin: '/api/auth/login',
  appUpdate: '/api/app/update-check',
}

/** 文案断言用的关键词，集中维护，避免上游/文案微调导致大面积假失败。 */
export const text = {
  inLibrary: '已在库',
  saved: '已保存',
  duplicate: '疑似重复',
  completed: '已完成',
  quality: /音质|flac|无损|320k/i,
}
