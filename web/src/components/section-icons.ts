import { Award, Briefcase, FolderGit2, GraduationCap, MessageSquarePlus, UserRound, Wrench, type LucideIcon } from 'lucide-react'

/** Icon for each profile section, keyed by route slug. */
export const SECTION_ICONS: Record<string, LucideIcon> = {
  personal: UserRound,
  experience: Briefcase,
  projects: FolderGit2,
  skills: Wrench,
  education: GraduationCap,
  achievements: Award,
  additional: MessageSquarePlus,
}
