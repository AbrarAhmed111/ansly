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

.sparkle {
  position: fixed; z-index: 2147483646; width: 26px; height: 26px; padding: 0;
  display: grid; place-items: center; border: 0; border-radius: 999px;
  background: ${linearGradient(gradients.brand, '135deg')}; color: #fff;
  box-shadow: 0 2px 8px -1px rgb(var(--a-accent) / 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.25); cursor: pointer;
  font-size: 13px; line-height: 1; opacity: 0.8; transition: opacity .15s, transform .15s, box-shadow .15s;
}
.sparkle:hover, .sparkle:focus-visible, .sparkle[data-active="true"] {
  opacity: 1; transform: scale(1.1); box-shadow: 0 0 0 4px rgb(var(--a-accent) / 0.18), 0 4px 14px -2px rgb(var(--a-accent) / 0.55);
}
.sparkle:focus-visible { outline: 2px solid rgb(var(--a-accent)); outline-offset: 2px; }

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
.count.over { color: rgb(var(--a-danger)); font-weight: 600; }

.notice { border-radius: 10px; padding: 10px 12px; font-size: 13px; line-height: 1.5; }
.notice.warning { background: rgb(var(--a-warning-soft)); color: rgb(var(--a-warning)); border: 1px solid rgb(var(--a-warning) / 0.25); }
.notice.error { background: rgb(var(--a-danger-soft)); color: rgb(var(--a-danger)); border: 1px solid rgb(var(--a-danger) / 0.25); }
.notice strong { display: block; margin-bottom: 2px; }
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
