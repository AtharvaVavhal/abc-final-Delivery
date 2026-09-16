import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Defers mounting below-the-fold homepage sections until they approach
 * the viewport, so their queries and media do not compete with LCP.
 * Vitest has no real IntersectionObserver callbacks, so tests render
 * children immediately.
 */
export function LazySection({
  children,
  rootMargin = '400px 0px',
}: {
  children: ReactNode
  rootMargin?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [show, setShow] = useState(() => import.meta.env.MODE === 'test')

  useEffect(() => {
    if (show) return
    const node = ref.current
    if (!node || typeof IntersectionObserver === 'undefined') {
      setShow(true)
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        setShow(true)
        observer.disconnect()
      },
      { rootMargin },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [show, rootMargin])

  return <div ref={ref}>{show ? children : null}</div>
}
