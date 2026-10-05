import { fontStack, gradients, linearGradient } from '@ansly/design'
import { themeCss } from '@/lib/theme-css'

/** Styles for the in-page UI. Injected into Ansly's shadow root, so page CSS can't touch them. Colours come from @ansly/design. */

const THEME = themeCss({
  selector: '.root',
  forcedDark: '.root[data-theme="dark"]',
  systemDark: '.root[data-theme="system"]',
})

const SHADOW_LIGHT = '0 16px 40px -8px rgba(17, 17, 23, 0.22), 0 2px 6px rgba(17, 17, 23, 0.06)'
const SHADOW_DARK = '0 16px 40px -8px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.02)'

export const CONTENT_CSS = `
:host { all: initial; }
${THEME}
.root { --a-shadow: ${SHADOW_LIGHT}; font: 14px/1.5 ${fontStack('sans')}; color: rgb(var(--a-fg)); -webkit-font-smoothing: antialiased; }
.root[data-theme="dark"] { --a-shadow: ${SHADOW_DARK}; }
@media (prefers-color-scheme: dark) { .root[data-theme="system"] { --a-shadow: ${SHADOW_DARK}; } }
* { box-sizing: border-box; }

/* The quiet per-field icon: small and calm until hovered; its glyph and colour say the field's state. */
.sparkle {
  position: fixed; z-index: 2147483646; width: 22px; height: 22px; padding: 0;
  display: grid; place-items: center; border: 1px solid rgb(var(--a-border)); border-radius: 999px;
  background: rgb(var(--a-surface)); color: rgb(var(--a-accent));
  box-shadow: 0 1px 3px rgba(17, 17, 23, 0.12); cursor: pointer;
  font-size: 11px; font-weight: 700; line-height: 1; opacity: 0.7; transition: opacity .15s, transform .15s, box-shadow .15s, border-color .15s;
}
.sparkle:hover, .sparkle:focus-visible, .sparkle[data-active="true"] {
  opacity: 1; transform: scale(1.08); border-color: rgb(var(--a-accent)); box-shadow: 0 0 0 3px rgb(var(--a-accent) / 0.15);
}
.sparkle:focus-visible { outline: 2px solid rgb(var(--a-accent)); outline-offset: 2px; }
.sparkle.s-ready, .sparkle.s-filled { color: rgb(var(--a-success)); border-color: rgb(var(--a-success) / 0.4); opacity: .85; }
.sparkle.s-review { color: rgb(var(--a-warning)); border-color: rgb(var(--a-warning) / 0.5); opacity: 1; }
.sparkle.s-needs_info { color: rgb(var(--a-warning)); background: rgb(var(--a-warning-soft)); border-color: rgb(var(--a-warning) / 0.5); opacity: 1; }
.sparkle.s-failed { color: rgb(var(--a-danger)); border-color: rgb(var(--a-danger) / 0.5); opacity: 1; }
.sparkle.s-generating { animation: spin 1.2s linear infinite; }

.popover {
  position: fixed; z-index: 2147483647; display: flex; flex-direction: column; max-height: min(560px, calc(100vh - 16px));
  background: rgb(var(--a-surface)); color: rgb(var(--a-fg)); border: 1px solid rgb(var(--a-border)); border-radius: 14px;
  box-shadow: var(--a-shadow); overflow: hidden; animation: pop-in .18s cubic-bezier(.32,.72,0,1);
}
@keyframes pop-in { from { opacity: 0; transform: translateY(4px) scale(.98); } }
.header { display: flex; align-items: center; gap: 8px; padding: 11px 14px; border-bottom: 1px solid rgb(var(--a-border)); }
.brand {
  font-weight: 600; letter-spacing: -0.01em;
  background: ${linearGradient(gradients.brand)}; -webkit-background-clip: text; background-clip: text; color: transparent;
}
.question { flex: 1; min-width: 0; color: rgb(var(--a-muted)); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.icon-btn { border: 0; background: transparent; color: rgb(var(--a-muted)); cursor: pointer; font-size: 16px; line-height: 1; padding: 4px 6px; border-radius: 8px; transition: background .15s, color .15s; }
.icon-btn:hover { background: rgb(var(--a-surface-muted)); color: rgb(var(--a-fg)); }

.body { padding: 14px; overflow: auto; display: flex; flex-direction: column; gap: 12px; }
.muted { color: rgb(var(--a-muted)); font-size: 12px; }
.loading { display: flex; align-items: center; gap: 10px; color: rgb(var(--a-muted)); padding: 10px 0; }
.spinner { width: 16px; height: 16px; border-radius: 999px; border: 2px solid rgb(var(--a-border)); border-top-color: rgb(var(--a-accent)); animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 2s; } .popover { animation: none; } }

textarea.answer {
  width: 100%; min-height: 160px; resize: vertical; padding: 10px 12px; border-radius: 10px; line-height: 1.6;
  border: 1px solid rgb(var(--a-border)); background: rgb(var(--a-surface-muted)); color: rgb(var(--a-fg)); font: inherit;
  transition: border-color .15s, box-shadow .15s;
}
textarea.answer:hover { border-color: rgb(var(--a-border-strong)); }
textarea.answer:focus { outline: none; border-color: rgb(var(--a-accent)); box-shadow: 0 0 0 4px rgb(var(--a-accent) / 0.15); background: rgb(var(--a-surface)); }
.meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 12px; color: rgb(var(--a-muted)); }
.chip { display: inline-flex; align-items: center; padding: 1px 8px; border-radius: 999px; background: rgb(var(--a-surface-muted)); border: 1px solid rgb(var(--a-border)); font-size: 11px; font-weight: 500; }
.chip.high { color: rgb(var(--a-success)); } .chip.medium { color: rgb(var(--a-accent)); } .chip.low { color: rgb(var(--a-warning)); }
.count { font-variant-numeric: tabular-nums; }
.count.near, .count.under { color: rgb(var(--a-warning)); }
.count.over { color: rgb(var(--a-danger)); font-weight: 600; }
.source strong { color: rgb(var(--a-fg)); font-weight: 600; }
.based-on { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; font-size: 12px; }
.based-on ul { display: contents; }
.based-on li { list-style: none; padding: 1px 8px; border-radius: 999px; background: rgb(var(--a-surface-muted)); border: 1px solid rgb(var(--a-border)); }
.memory-used { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; font-size: 12px; padding: 8px 10px; border-radius: 10px; background: rgb(var(--a-accent) / .06); border: 1px solid rgb(var(--a-accent) / .2); }
.memory-used.editing { flex-direction: column; align-items: stretch; }
.memory-used input:not([type=checkbox]) { padding: 6px 8px; border-radius: 8px; border: 1px solid rgb(var(--a-border)); background: rgb(var(--a-surface)); color: rgb(var(--a-fg)); font: inherit; font-size: 13px; }
.rewrite-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.chip-btn {
  height: 26px; padding: 0 10px; border-radius: 999px; border: 1px solid rgb(var(--a-border)); background: rgb(var(--a-surface));
  color: rgb(var(--a-fg)); font: inherit; font-size: 12px; font-weight: 500; cursor: pointer; transition: border-color .15s, background .15s;
}
.chip-btn:hover:not(:disabled) { border-color: rgb(var(--a-accent)); background: rgb(var(--a-accent) / .06); }
.chip-btn:disabled { opacity: .5; cursor: not-allowed; }
.chip-btn:focus-visible, .link:focus-visible, .row-q:focus-visible { outline: 2px solid rgb(var(--a-accent)); outline-offset: 2px; }
.menu-wrap { position: relative; }
.menu {
  position: absolute; z-index: 1; top: calc(100% + 4px); left: 0; min-width: 170px; display: flex; flex-direction: column; padding: 4px;
  background: rgb(var(--a-surface)); border: 1px solid rgb(var(--a-border)); border-radius: 10px; box-shadow: var(--a-shadow);
}
.menu button { text-align: left; border: 0; background: none; padding: 6px 10px; border-radius: 6px; font: inherit; font-size: 12.5px; color: rgb(var(--a-fg)); cursor: pointer; }
.menu button:hover, .menu button:focus-visible { background: rgb(var(--a-surface-muted)); outline: none; }
.details { display: flex; flex-direction: column; gap: 8px; padding-top: 8px; border-top: 1px dashed rgb(var(--a-border)); }
.secondary { display: flex; align-items: center; gap: 12px; }
.secondary .link, .footer > .link { font-size: 12.5px; color: rgb(var(--a-muted)); text-decoration: none; }
.secondary .link:hover:not(:disabled), .footer > .link:hover { color: rgb(var(--a-accent)); }
.link:disabled { opacity: .5; cursor: not-allowed; }
.trust { margin: 0; padding: 0 14px 8px; font-size: 11px; background: rgb(var(--a-surface-muted)); }
.small { font-size: 11.5px; }
.skeleton { display: none; }
.loading { flex-wrap: wrap; }
.loading .skeleton { display: flex; flex-direction: column; gap: 6px; flex-basis: 100%; }
.skeleton span { height: 10px; border-radius: 6px; background: linear-gradient(90deg, rgb(var(--a-surface-muted)), rgb(var(--a-border)), rgb(var(--a-surface-muted))); background-size: 200% 100%; animation: shimmer 1.4s ease infinite; }
.skeleton span:nth-child(2) { width: 85%; } .skeleton span:nth-child(3) { width: 60%; }
@keyframes shimmer { from { background-position: 100% 0; } to { background-position: -100% 0; } }
@media (prefers-reduced-motion: reduce) { .skeleton span, .sparkle.s-generating { animation: none; } }

.notice { border-radius: 10px; padding: 10px 12px; font-size: 13px; line-height: 1.5; }
.notice.warning { background: rgb(var(--a-warning-soft)); color: rgb(var(--a-warning)); border: 1px solid rgb(var(--a-warning) / 0.25); }
.notice.error { background: rgb(var(--a-danger-soft)); color: rgb(var(--a-danger)); border: 1px solid rgb(var(--a-danger) / 0.25); }
.notice.success { background: rgb(var(--a-success-soft)); color: rgb(var(--a-success)); border: 1px solid rgb(var(--a-success) / 0.25); }
.notice.info { background: rgb(var(--a-surface-muted)); color: rgb(var(--a-fg)); border: 1px solid rgb(var(--a-border)); }
.notice.limit { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.notice.hint { background: rgb(var(--a-surface-muted)); color: rgb(var(--a-muted)); border: 1px solid rgb(var(--a-border)); font-size: 12px; padding: 8px 12px; }
.notice strong { display: block; margin-bottom: 2px; }

.style-bar { display: flex; flex-direction: column; gap: 6px; }
.style-row { display: flex; align-items: center; gap: 6px; }
.segmented { display: inline-flex; flex: 1; padding: 2px; border-radius: 8px; border: 1px solid rgb(var(--a-border)); background: rgb(var(--a-surface-muted)); }
.segmented button {
  flex: 1; height: 26px; border: 0; border-radius: 6px; background: none; color: rgb(var(--a-muted));
  font: inherit; font-size: 12px; font-weight: 500; cursor: pointer;
}
.segmented.wrap { flex-wrap: wrap; flex: none; align-self: flex-start; }
.segmented.wrap button { flex: none; padding: 0 12px; }
.segmented button.on { background: rgb(var(--a-surface)); color: rgb(var(--a-fg)); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08); }
.segmented button:disabled { cursor: not-allowed; }
.segmented button:focus-visible { outline: 2px solid rgb(var(--a-accent)); outline-offset: -2px; }
.style-bar select, .style-bar input.instruction {
  height: 30px; padding: 0 8px; border-radius: 8px; border: 1px solid rgb(var(--a-border));
  background: rgb(var(--a-surface-muted)); color: rgb(var(--a-fg)); font: inherit; font-size: 12px;
}
.style-bar select { cursor: pointer; }
.style-bar input.instruction { flex: 1; min-width: 0; }
.style-bar select:focus-visible, .style-bar input.instruction:focus { outline: none; border-color: rgb(var(--a-accent)); }
.style-hint { font-size: 11px; color: rgb(var(--a-muted)); }
.btn.small { height: 30px; padding: 0 10px; font-size: 12px; }

/* Ask-and-learn */
.missing { display: flex; flex-direction: column; gap: 8px; padding: 12px; border-radius: 10px; background: rgb(var(--a-surface-muted)); border: 1px solid rgb(var(--a-border)); }
.missing-head { display: flex; flex-direction: column; gap: 2px; }
.missing-head strong { font-size: 13.5px; }
.missing-group { border: 0; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.missing-group legend { padding: 0; margin-bottom: 4px; font-size: 11px; font-weight: 650; text-transform: uppercase; letter-spacing: .04em; color: rgb(var(--a-muted)); }
.missing .scope { display: flex; align-items: center; gap: 6px; }
.missing .scope select { width: auto; padding: 2px 6px; font-size: 12px; }
.missing input.short { width: 120px; }
.missing-item { display: flex; flex-direction: column; gap: 4px; }
.missing-item label { font-size: 12.5px; color: rgb(var(--a-fg)); }
.missing input:not([type=checkbox]), .missing textarea, .missing select {
  width: 100%; padding: 6px 8px; border-radius: 8px; border: 1px solid rgb(var(--a-border)); background: rgb(var(--a-surface));
  color: rgb(var(--a-fg)); font: inherit; font-size: 13px;
}
.missing textarea { resize: vertical; }
.missing input:focus, .missing textarea:focus, .missing select:focus { outline: none; border-color: rgb(var(--a-accent)); }
.check { display: flex; align-items: center; gap: 6px; font-size: 12px; color: rgb(var(--a-muted)); cursor: pointer; }
.check input { margin: 0; accent-color: rgb(var(--a-accent)); }

/* Fill all: pill + page panel */
.pill {
  position: fixed; z-index: 2147483646; right: 20px; bottom: 20px; display: inline-flex; align-items: center; gap: 4px;
  height: 34px; padding: 0 14px; border-radius: 999px; border: 1px solid rgb(var(--a-border)); cursor: pointer;
  background: rgb(var(--a-surface)); color: rgb(var(--a-fg)); font: inherit; font-size: 13px; font-weight: 500; box-shadow: var(--a-shadow);
}
.pill:hover { border-color: rgb(var(--a-accent)); }
.pill:focus-visible { outline: 2px solid rgb(var(--a-accent)); outline-offset: 2px; }
.pill-brand { font-weight: 650; margin-right: 4px; }
.pill-stat { font-variant-numeric: tabular-nums; font-size: 12px; padding: 0 4px; }
.pill-stat.s-ready { color: rgb(var(--a-success)); } .pill-stat.s-review, .pill-stat.s-needs_info { color: rgb(var(--a-warning)); }
.pill-job { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: rgb(var(--a-muted)); font-size: 12px; margin-right: 4px; }
.job-line { margin: 0; font-size: 13px; }
.popover:focus, .panel:focus { outline: none; }
.popover:focus-visible, .panel:focus-visible { outline: 2px solid rgb(var(--a-accent)); outline-offset: 2px; }
.pill-action { margin-left: 6px; color: rgb(var(--a-accent)); font-size: 12px; font-weight: 600; }
.panel {
  position: fixed; z-index: 2147483647; right: 16px; bottom: 16px; width: min(420px, calc(100vw - 32px)); max-height: min(640px, calc(100vh - 32px));
  display: flex; flex-direction: column; background: rgb(var(--a-surface)); color: rgb(var(--a-fg)); border: 1px solid rgb(var(--a-border));
  border-radius: 14px; box-shadow: var(--a-shadow); overflow: hidden; animation: pop-in .18s cubic-bezier(.32,.72,0,1);
}
.panel .group h3 { margin: 0 0 4px; font-size: 11.5px; font-weight: 650; text-transform: uppercase; letter-spacing: .04em; color: rgb(var(--a-muted)); }
.panel .group ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.panel .row { padding: 6px 0; border-bottom: 1px solid rgb(var(--a-border)); }
.panel .row:last-child { border-bottom: 0; }
.row-main { display: flex; align-items: center; gap: 8px; min-width: 0; }
.row-q { flex: 1; min-width: 0; text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 13px; }
.link-plain { background: none; border: 0; padding: 0; font: inherit; color: inherit; cursor: pointer; }
.link-plain:hover { color: rgb(var(--a-accent)); }
.status { flex-shrink: 0; font-size: 11px; font-weight: 600; padding: 1px 8px; border-radius: 999px; background: rgb(var(--a-surface-muted)); color: rgb(var(--a-muted)); }
.status.s-filled, .status.s-ready { color: rgb(var(--a-success)); background: rgb(var(--a-success-soft)); }
.status.s-review, .status.s-needs_info { color: rgb(var(--a-warning)); background: rgb(var(--a-warning-soft)); }
.status.s-failed { color: rgb(var(--a-danger)); background: rgb(var(--a-danger-soft)); }
.status.s-generating { color: rgb(var(--a-accent)); }
.row-note { font-size: 11.5px; color: rgb(var(--a-muted)); margin-top: 2px; }
.card.s-review .row-note { color: rgb(var(--a-warning)); }
.row-answer { margin-top: 4px; font-size: 12px; line-height: 1.5; color: rgb(var(--a-fg)); white-space: pre-wrap; max-height: 2.9em; overflow: hidden; padding: 6px 8px; border-radius: 8px; background: rgb(var(--a-surface-muted)); }
.row-answer.open { max-height: 120px; overflow: auto; }
.intro { margin: 0; font-size: 13px; color: rgb(var(--a-muted)); }
.summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(70px, 1fr)); gap: 6px; }
.sum { display: flex; flex-direction: column; padding: 6px 10px; border-radius: 10px; background: rgb(var(--a-surface-muted)); border: 1px solid rgb(var(--a-border)); font-size: 11.5px; color: rgb(var(--a-muted)); }
.sum b { font-size: 16px; color: rgb(var(--a-fg)); font-variant-numeric: tabular-nums; }
.sum.s-ready b, .sum.s-filled b { color: rgb(var(--a-success)); } .sum.s-review b, .sum.s-needs_info b { color: rgb(var(--a-warning)); }
.cards { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.card { padding: 8px 10px; border-radius: 10px; border: 1px solid rgb(var(--a-border)); }
.card.s-review { border-color: rgb(var(--a-warning) / 0.45); }
.card.s-needs_info { border-style: dashed; }
.card input[type=checkbox] { margin: 0; accent-color: rgb(var(--a-accent)); flex-shrink: 0; }
.state-icon { flex-shrink: 0; width: 16px; text-align: center; font-size: 12px; font-weight: 700; color: rgb(var(--a-muted)); }
.state-icon.s-filled, .state-icon.s-ready { color: rgb(var(--a-success)); }
.state-icon.s-review, .state-icon.s-needs_info { color: rgb(var(--a-warning)); }
.state-icon.s-failed { color: rgb(var(--a-danger)); }
label.inline { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: rgb(var(--a-muted)); }
.panel-foot { margin: 0; padding: 0 14px 10px; font-size: 11px; background: rgb(var(--a-surface-muted)); }

/* Resume tailoring (v1.2): a small pill on job pages that expands into a card. */
.tailor-pill-wrap { position: fixed; z-index: 2147483646; right: 20px; bottom: 20px; display: inline-flex; align-items: center; gap: 4px; }
.tailor-pill-wrap.stacked, .tailor-card.stacked { bottom: 64px; }
.tailor-pill-wrap .pill { position: static; }
.pill-dismiss {
  width: 22px; height: 22px; padding: 0; border-radius: 999px; border: 1px solid rgb(var(--a-border)); cursor: pointer;
  background: rgb(var(--a-surface)); color: rgb(var(--a-muted)); font-size: 10px; line-height: 1; box-shadow: var(--a-shadow);
}
.pill-dismiss:hover { color: rgb(var(--a-fg)); }
.tailor-card {
  position: fixed; z-index: 2147483647; right: 16px; bottom: 16px; width: min(360px, calc(100vw - 32px)); max-height: min(560px, calc(100vh - 32px));
  display: flex; flex-direction: column; background: rgb(var(--a-surface)); color: rgb(var(--a-fg)); border: 1px solid rgb(var(--a-border));
  border-radius: 14px; box-shadow: var(--a-shadow); overflow: hidden; animation: pop-in .18s cubic-bezier(.32,.72,0,1);
}
.tailor-title { font-weight: 650; font-size: 14px; }
.tailor-card .footer { flex-wrap: wrap; justify-content: flex-end; }
.tailor-offer { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border-radius: 10px; background: rgb(var(--a-accent) / .08); border: 1px solid rgb(var(--a-accent) / .25); line-height: 1.5; }
.tailor-new { align-self: flex-start; font-size: 11px; font-weight: 650; letter-spacing: .02em; padding: 1px 7px; border-radius: 999px; color: rgb(var(--a-accent-fg)); background: rgb(var(--a-accent)); }
.tailor-ready { font-weight: 600; color: rgb(var(--a-success)); }
.tailor-progress { display: flex; flex-direction: column; gap: 8px; padding: 6px 0 2px; }
.tailor-progress-head { display: flex; align-items: center; gap: 10px; }
.tailor-activity { flex: 1; min-width: 0; }
.tailor-percent { font-variant-numeric: tabular-nums; }
.tailor-bar { height: 6px; border-radius: 999px; background: rgb(var(--a-surface-muted)); border: 1px solid rgb(var(--a-border)); overflow: hidden; }
.tailor-bar > span { display: block; height: 100%; border-radius: inherit; background: rgb(var(--a-accent)); transition: width .5s ease; }
@media (prefers-reduced-motion: reduce) { .tailor-bar > span { transition: none; } }
.tailor-stats { display: grid; grid-template-columns: 1fr auto; gap: 3px 12px; margin: 0; font-size: 13px; }
.tailor-stats dt { color: rgb(var(--a-muted)); }
.tailor-stats dd { margin: 0; text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; }
.tailor-changes ul { margin: 4px 0 0; padding-left: 18px; font-size: 13px; line-height: 1.6; }

/* Filled fields get a subtle outline: red when the fill didn't stick. */
.filled-outline { position: fixed; z-index: 2147483645; pointer-events: none; border-radius: 8px; border: 2px solid rgb(var(--a-accent) / 0.55); }
.filled-outline.s-review { border-color: rgb(var(--a-warning) / 0.8); }
.filled-outline.s-failed { border-color: rgb(var(--a-danger) / 0.7); border-style: dashed; }

/* Detection debug */
.debug-box { position: fixed; z-index: 2147483644; border-radius: 4px; pointer-events: none; background: transparent; }
.debug-box.detected { outline: 2px solid #16a34a; }
.debug-box.ignored { outline: 2px dashed #9ca3af; }
.debug-box span { pointer-events: auto; cursor: help; position: absolute; top: -18px; left: 0; padding: 0 5px; border-radius: 4px; font-size: 10.5px; line-height: 16px; white-space: nowrap; color: #fff; }
.debug-box.detected span { background: #16a34a; }
.debug-box.ignored span { background: #6b7280; }
.saved-preview { border: 1px dashed rgb(var(--a-border-strong)); border-radius: 10px; padding: 10px 12px; background: rgb(var(--a-surface-muted)); white-space: pre-wrap; max-height: 180px; overflow: auto; line-height: 1.6; }

.footer { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-top: 1px solid rgb(var(--a-border)); background: rgb(var(--a-surface-muted)); }
.spacer { flex: 1; }
.btn {
  border: 1px solid rgb(var(--a-border)); background: rgb(var(--a-surface)); color: rgb(var(--a-fg)); border-radius: 8px;
  height: 32px; padding: 0 12px; font: inherit; font-size: 13px; font-weight: 500; cursor: pointer;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04); transition: background .15s, border-color .15s, filter .15s;
}
.btn:hover:not(:disabled) { border-color: rgb(var(--a-border-strong)); background: rgb(var(--a-surface-muted)); }
.btn:disabled { opacity: .5; cursor: not-allowed; }
.btn.primary { background: rgb(var(--a-accent)); background-image: linear-gradient(to bottom, rgba(255,255,255,.12), transparent); border-color: rgb(var(--a-accent)); color: rgb(var(--a-accent-fg)); }
.btn.primary:hover:not(:disabled) { background-color: rgb(var(--a-accent)); filter: brightness(1.08); }
.btn:focus-visible { outline: 2px solid rgb(var(--a-accent)); outline-offset: 2px; }
.link { background: none; border: 0; padding: 0; color: rgb(var(--a-accent)); font: inherit; font-weight: 500; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
.toast {
  position: fixed; z-index: 2147483647; bottom: 20px; right: 20px; padding: 10px 16px; border-radius: 12px;
  background: rgb(var(--a-fg)); color: rgb(var(--a-surface)); font-size: 13px; font-weight: 500; box-shadow: var(--a-shadow);
  animation: pop-in .2s cubic-bezier(.32,.72,0,1);
}
`
