/** Styles for the in-page UI. Injected into Ansly's shadow root, so page CSS can't touch them. */

const LIGHT = `
  --a-bg: #ffffff; --a-surface: #f6f6f8; --a-border: #e6e6ea; --a-border-strong: #d4d4da; --a-fg: #111117; --a-muted: #686876;
  --a-accent: #635bff; --a-accent-fg: #ffffff; --a-accent-soft: #f0efff;
  --a-success: #169652; --a-warning: #b4650a; --a-warning-soft: #fff8eb; --a-danger: #dc2d37; --a-danger-soft: #fef2f2;
  --a-shadow: 0 16px 40px -8px rgba(17, 17, 23, 0.22), 0 2px 6px rgba(17, 17, 23, 0.06);
`
const DARK = `
  --a-bg: #131317; --a-surface: #1d1d23; --a-border: #282830; --a-border-strong: #3a3a44; --a-fg: #f2f2f5; --a-muted: #a0a0ad;
  --a-accent: #7c74ff; --a-accent-fg: #ffffff; --a-accent-soft: #211e42;
  --a-success: #4ad284; --a-warning: #f5b43c; --a-warning-soft: #33250a; --a-danger: #fa696e; --a-danger-soft: #3a1214;
  --a-shadow: 0 16px 40px -8px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.02);
`

export const CONTENT_CSS = `
:host { all: initial; }
.root { ${LIGHT} font: 14px/1.5 Geist, Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--a-fg); -webkit-font-smoothing: antialiased; }
.root[data-theme="dark"] { ${DARK} }
@media (prefers-color-scheme: dark) { .root[data-theme="system"] { ${DARK} } }
* { box-sizing: border-box; }

.sparkle {
  position: fixed; z-index: 2147483646; width: 26px; height: 26px; padding: 0;
  display: grid; place-items: center; border: 0; border-radius: 999px;
  background: linear-gradient(135deg, #635bff, #8b5cf6 55%, #d946ef); color: #fff;
  box-shadow: 0 2px 8px -1px rgba(99, 91, 255, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.25); cursor: pointer;
  font-size: 13px; line-height: 1; opacity: 0.8; transition: opacity .15s, transform .15s, box-shadow .15s;
}
.sparkle:hover, .sparkle:focus-visible, .sparkle[data-active="true"] {
  opacity: 1; transform: scale(1.1); box-shadow: 0 0 0 4px rgba(99, 91, 255, 0.18), 0 4px 14px -2px rgba(99, 91, 255, 0.55);
}
.sparkle:focus-visible { outline: 2px solid var(--a-accent); outline-offset: 2px; }

.popover {
  position: fixed; z-index: 2147483647; display: flex; flex-direction: column; max-height: min(560px, calc(100vh - 16px));
  background: var(--a-bg); color: var(--a-fg); border: 1px solid var(--a-border); border-radius: 14px;
  box-shadow: var(--a-shadow); overflow: hidden; animation: pop-in .18s cubic-bezier(.32,.72,0,1);
}
@keyframes pop-in { from { opacity: 0; transform: translateY(4px) scale(.98); } }
.header { display: flex; align-items: center; gap: 8px; padding: 11px 14px; border-bottom: 1px solid var(--a-border); }
.brand {
  font-weight: 600; letter-spacing: -0.01em;
  background: linear-gradient(120deg, var(--a-accent), #b06cff); -webkit-background-clip: text; background-clip: text; color: transparent;
}
.question { flex: 1; min-width: 0; color: var(--a-muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.icon-btn { border: 0; background: transparent; color: var(--a-muted); cursor: pointer; font-size: 16px; line-height: 1; padding: 4px 6px; border-radius: 8px; transition: background .15s, color .15s; }
.icon-btn:hover { background: var(--a-surface); color: var(--a-fg); }

.body { padding: 14px; overflow: auto; display: flex; flex-direction: column; gap: 12px; }
.muted { color: var(--a-muted); font-size: 12px; }
.loading { display: flex; align-items: center; gap: 10px; color: var(--a-muted); padding: 10px 0; }
.spinner { width: 16px; height: 16px; border-radius: 999px; border: 2px solid var(--a-border); border-top-color: var(--a-accent); animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spinner { animation-duration: 2s; } .popover { animation: none; } }

textarea.answer {
  width: 100%; min-height: 160px; resize: vertical; padding: 10px 12px; border-radius: 10px; line-height: 1.6;
  border: 1px solid var(--a-border); background: var(--a-surface); color: var(--a-fg); font: inherit;
  transition: border-color .15s, box-shadow .15s;
}
textarea.answer:hover { border-color: var(--a-border-strong); }
textarea.answer:focus { outline: none; border-color: var(--a-accent); box-shadow: 0 0 0 4px rgba(99, 91, 255, 0.15); background: var(--a-bg); }
.meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 12px; color: var(--a-muted); }
.chip { display: inline-flex; align-items: center; padding: 1px 8px; border-radius: 999px; background: var(--a-surface); border: 1px solid var(--a-border); font-size: 11px; font-weight: 500; }
.chip.high { color: var(--a-success); } .chip.medium { color: var(--a-accent); } .chip.low { color: var(--a-warning); }
.count { font-variant-numeric: tabular-nums; }
.count.over { color: var(--a-danger); font-weight: 600; }

.notice { border-radius: 10px; padding: 10px 12px; font-size: 13px; line-height: 1.5; }
.notice.warning { background: var(--a-warning-soft); color: var(--a-warning); border: 1px solid color-mix(in srgb, var(--a-warning) 25%, transparent); }
.notice.error { background: var(--a-danger-soft); color: var(--a-danger); border: 1px solid color-mix(in srgb, var(--a-danger) 25%, transparent); }
.notice strong { display: block; margin-bottom: 2px; }
.saved-preview { border: 1px dashed var(--a-border-strong); border-radius: 10px; padding: 10px 12px; background: var(--a-surface); white-space: pre-wrap; max-height: 180px; overflow: auto; line-height: 1.6; }

.footer { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-top: 1px solid var(--a-border); background: var(--a-surface); }
.spacer { flex: 1; }
.btn {
  border: 1px solid var(--a-border); background: var(--a-bg); color: var(--a-fg); border-radius: 8px;
  height: 32px; padding: 0 12px; font: inherit; font-size: 13px; font-weight: 500; cursor: pointer;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04); transition: background .15s, border-color .15s, filter .15s;
}
.btn:hover:not(:disabled) { border-color: var(--a-border-strong); background: var(--a-surface); }
.btn:disabled { opacity: .5; cursor: not-allowed; }
.btn.primary { background: var(--a-accent); background-image: linear-gradient(to bottom, rgba(255,255,255,.12), transparent); border-color: var(--a-accent); color: var(--a-accent-fg); }
.btn.primary:hover:not(:disabled) { background-color: var(--a-accent); filter: brightness(1.08); }
.btn:focus-visible { outline: 2px solid var(--a-accent); outline-offset: 2px; }
.link { background: none; border: 0; padding: 0; color: var(--a-accent); font: inherit; font-weight: 500; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
.toast {
  position: fixed; z-index: 2147483647; bottom: 20px; right: 20px; padding: 10px 16px; border-radius: 12px;
  background: var(--a-fg); color: var(--a-bg); font-size: 13px; font-weight: 500; box-shadow: var(--a-shadow);
  animation: pop-in .2s cubic-bezier(.32,.72,0,1);
}
`
