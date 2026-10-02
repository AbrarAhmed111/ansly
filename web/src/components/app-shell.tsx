'use client'

import { clsx } from 'clsx'
import {
  BellRing,
  BookmarkCheck,
  Briefcase,
  FileText,
  KanbanSquare,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  Puzzle,
  Search,
  SearchCheck,
  Settings,
  Sparkles,
  Wand2,
  type LucideIcon,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import { CommandPalette, type Command } from '@/components/command-palette'
import { Sheet } from '@/components/dialog'
import { Logo } from '@/components/logo'
import { SECTION_ICONS } from '@/components/section-icons'
import { ThemeToggle } from '@/components/theme'
import { Avatar, IconButton, Kbd, Overline } from '@/components/ui'
import { SECTIONS } from '@/lib/sections'
import { createClient } from '@/lib/supabase/client'

interface NavItem {
  href: string
  label: string
  icon: LucideIcon
  /** Key into the live counts shown beside the item. */
  count?: 'alerts'
}

const GROUPS: { label?: string; items: NavItem[] }[] = [
  { items: [{ href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard }] },
  {
    label: 'Jobs',
    items: [
      { href: '/jobs', label: 'For you', icon: Sparkles },
      { href: '/jobs/alerts', label: 'Alerts', icon: BellRing, count: 'alerts' },
      { href: '/jobs/searches', label: 'Saved searches', icon: SearchCheck },
      { href: '/applications', label: 'Applications', icon: KanbanSquare },
    ],
  },
  {
    label: 'Profile',
    items: [
      { href: '/profile/personal', label: 'Personal', icon: SECTION_ICONS.personal },
      ...SECTIONS.map((s) => ({ href: `/profile/${s.slug}`, label: s.title, icon: SECTION_ICONS[s.slug] })),
      { href: '/resumes', label: 'Resumes', icon: FileText },
    ],
  },
  {
    label: 'Workspace',
    items: [
      { href: '/playground', label: 'Try it', icon: Wand2 },
      { href: '/saved-answers', label: 'Saved answers', icon: BookmarkCheck },
      { href: '/extension', label: 'Extension', icon: Puzzle },
      { href: '/settings', label: 'Settings', icon: Settings },
    ],
  },
]

const COMMANDS: Command[] = [
  ...GROUPS.flatMap((g) => g.items.map((i) => ({ ...i, group: 'Go to' }))),
  ...SECTIONS.map((s) => ({
    label: `Add ${s.singular}`,
    href: `/profile/${s.slug}?new=1`,
    icon: Plus,
    group: 'Actions',
    keywords: s.title,
  })),
  { label: 'Add saved answer', href: '/saved-answers?new=1', icon: Plus, group: 'Actions' },
  { label: 'New saved search', href: '/jobs/searches?new=1', icon: SearchCheck, group: 'Actions', keywords: 'jobs alerts' },
  { label: 'Track an application', href: '/applications?new=1', icon: Briefcase, group: 'Actions', keywords: 'job apply' },
  { label: 'Upload a resume', href: '/resumes?new=1', icon: FileText, group: 'Actions', keywords: 'cv' },
  { label: 'Try a question', href: '/playground', icon: Wand2, group: 'Actions', keywords: 'generate answer playground' },
]

function SearchButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-9 w-full items-center gap-2 rounded-lg border border-border bg-surface px-2.5 text-body-sm text-subtle shadow-xs transition hover:border-border-strong hover:text-muted"
    >
      <Search className="h-4 w-4" />
      <span className="flex-1 text-left">Search…</span>
      <Kbd>Ctrl K</Kbd>
    </button>
  )
}

const ALL_ITEMS = GROUPS.flatMap((g) => g.items)

/** The most specific nav item for a path ("/jobs/alerts" is Alerts, not For you). */
function activeHref(path: string): string | undefined {
  return ALL_ITEMS.map((i) => i.href)
    .filter((href) => path === href || path.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0]
}

function useNavCounts(path: string) {
  const [counts, setCounts] = useState<Record<'alerts', number>>({ alerts: 0 })
  useEffect(() => {
    void createClient()
      .from('job_alerts')
      .select('id', { count: 'exact', head: true })
      .is('seen_at', null)
      .then(({ count }) => setCounts({ alerts: count ?? 0 }))
  }, [path])
  return counts
}

function NavLinks() {
  const path = usePathname()
  const current = activeHref(path)
  const counts = useNavCounts(path)
  return (
    <nav className="space-y-5" aria-label="Main">
      {GROUPS.map((group, i) => (
        <div key={group.label ?? i}>
          {group.label && (
            <Overline className="mb-1.5 px-2.5">{group.label}</Overline>
          )}
          <ul className="space-y-0.5">
            {group.items.map(({ href, label, icon: Icon, count }) => {
              const active = href === current
              const badge = count ? counts[count] : 0
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={active ? 'page' : undefined}
                    className={clsx(
                      'group relative flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-body-sm font-medium transition-colors',
                      active ? 'bg-surface text-fg shadow-xs ring-1 ring-border' : 'text-muted hover:bg-surface-muted hover:text-fg',
                    )}
                  >
                    <Icon
                      className={clsx('h-4 w-4 shrink-0', active ? 'text-accent' : 'text-subtle group-hover:text-muted')}
                      aria-hidden
                    />
                    <span className="flex-1">{label}</span>
                    {badge > 0 && (
                      <span className="rounded-full bg-accent px-1.5 text-caption font-semibold tabular-nums text-accent-fg">
                        {badge}
                      </span>
                    )}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}

function UserFooter({ name, email }: { name: string | null; email: string }) {
  return (
    <div className="space-y-3 border-t border-border pt-4">
      <ThemeToggle compact className="flex w-full" />
      <div className="flex items-center gap-2.5 px-1">
        <Avatar name={name || email} className="h-8 w-8 text-caption" />
        <div className="min-w-0 flex-1">
          {name && <p className="truncate text-body-sm font-medium leading-tight">{name}</p>}
          <p className="truncate text-caption leading-tight text-muted" title={email}>
            {email}
          </p>
        </div>
        <form action="/auth/signout" method="post">
          <IconButton type="submit" icon={LogOut} label="Sign out" />
        </form>
      </div>
    </div>
  )
}

export function AppShell({ name, email, children }: { name: string | null; email: string; children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const path = usePathname()
  useEffect(() => setMenuOpen(false), [path])

  return (
    <div className="min-h-screen lg:flex">
      {/* Desktop sidebar */}
      <aside className="hidden lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-64 lg:shrink-0 lg:flex-col lg:border-r lg:border-border lg:bg-bg">
        <div className="flex h-16 items-center px-5">
          <Link href="/dashboard" aria-label="Ansly dashboard">
            <Logo />
          </Link>
        </div>
        <div className="px-3 pb-3">
          <SearchButton onClick={() => setPaletteOpen(true)} />
        </div>
        <div className="no-scroll flex-1 overflow-y-auto px-3 py-2">
          <NavLinks />
        </div>
        <div className="px-3 pb-4">
          <UserFooter name={name} email={email} />
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-bg/80 px-4 backdrop-blur-lg lg:hidden">
        <Link href="/dashboard" aria-label="Ansly dashboard">
          <Logo />
        </Link>
        <div className="flex items-center gap-1">
          <IconButton size="icon" icon={Search} label="Search" onClick={() => setPaletteOpen(true)} />
          <IconButton size="icon" icon={Menu} label="Open menu" onClick={() => setMenuOpen(true)} />
        </div>
      </header>
      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} side="left">
        <div className="flex h-full flex-col">
          <div className="flex h-14 items-center px-5">
            <Logo />
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-2">
            <NavLinks />
          </div>
          <div className="px-3 pb-4">
            <UserFooter name={name} email={email} />
          </div>
        </div>
      </Sheet>

      <CommandPalette commands={COMMANDS} open={paletteOpen} onOpenChange={setPaletteOpen} />

      <main className="min-w-0 flex-1">
        <div className="mx-auto w-full max-w-5xl px-4 pb-24 pt-8 sm:px-6 lg:px-10 lg:pt-12">{children}</div>
      </main>
    </div>
  )
}
