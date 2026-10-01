import { Toaster as HotToaster } from 'react-hot-toast'

/** App-wide toast host, styled with the theme tokens. */
export function Toaster() {
  return (
    <HotToaster
      position="bottom-right"
      toastOptions={{
        style: {
          background: 'rgb(var(--surface))',
          color: 'rgb(var(--fg))',
          border: '1px solid rgb(var(--border))',
          boxShadow: '0 8px 24px -6px rgb(0 0 0 / 0.15)',
          borderRadius: '12px',
          fontSize: '0.875rem',
          padding: '10px 14px',
        },
        success: { iconTheme: { primary: 'rgb(var(--success))', secondary: 'rgb(var(--surface))' } },
        error: { iconTheme: { primary: 'rgb(var(--danger))', secondary: 'rgb(var(--surface))' } },
      }}
    />
  )
}
