'use client'

import { useEffect, useRef, useState } from 'react'

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** True once the element has been at least `threshold` visible; stays true after that. */
export function useInView<T extends Element>(threshold = 0.35) {
  const ref = useRef<T>(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || inView) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setInView(true)
          observer.disconnect()
        }
      },
      { threshold },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [inView, threshold])
  return [ref, inView] as const
}

/**
 * A looping step counter for the product scenes: 0..steps-1, advancing every `ms` while `running`.
 * With reduced motion it jumps straight to the last step (the finished state) and stays there.
 */
export function useSteps(steps: number, ms: number, running: boolean) {
  const [step, setStep] = useState(0)
  useEffect(() => {
    if (!running) return
    if (prefersReducedMotion()) {
      setStep(steps - 1)
      return
    }
    const id = window.setInterval(() => setStep((s) => (s + 1) % steps), ms)
    return () => window.clearInterval(id)
  }, [steps, ms, running])
  return [step, setStep] as const
}
