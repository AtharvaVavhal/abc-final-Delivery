import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { apiClient } from '@/services/api/client'
import styles from './AnnouncementBar.module.css'

/** Split admin-configured copy on `|` so each message gets a divider.
 * A single line with no pipes stays one segment. */
export function parseAnnouncementSegments(text: string): string[] {
  return text
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean)
}

function MarqueeGroup({
  segments,
  copies,
  duplicate,
}: {
  segments: string[]
  copies: number
  duplicate?: boolean
}) {
  const items: ReactNode[] = []
  for (let copy = 0; copy < copies; copy += 1) {
    segments.forEach((segment, i) => {
      items.push(
        <span
          className={styles.segment}
          key={`${copy}-${i}`}
          data-fill={copy > 0 ? 'true' : undefined}
        >
          {segment}
          <span className={styles.divider} aria-hidden="true" />
        </span>,
      )
    })
  }

  return (
    <div
      className={styles.group}
      aria-hidden={duplicate || undefined}
      data-duplicate={duplicate ? 'true' : undefined}
    >
      {items}
    </div>
  )
}

export function AnnouncementBar() {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [copies, setCopies] = useState(2)

  const viewportRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false

    apiClient
      .get<{ success: boolean; data: { value: string | null } }>('/settings/announcement_text')
      .then((res) => {
        if (cancelled) return
        const value = res.data.data?.value
        if (typeof value === 'string' && value.trim()) {
          setText(value.trim())
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const segments = text ? parseAnnouncementSegments(text) : []

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const measure = measureRef.current
    if (!viewport || !measure || segments.length === 0) return

    const update = () => {
      const unitWidth = measure.scrollWidth
      const viewWidth = viewport.clientWidth
      if (unitWidth <= 0 || viewWidth <= 0) return
      setCopies(Math.max(1, Math.ceil(viewWidth / unitWidth)))
    }

    update()
    if (typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(update)
    observer.observe(viewport)
    observer.observe(measure)
    return () => observer.disconnect()
  }, [segments])

  if (loading || segments.length === 0) return null

  return (
    <div className={styles.bar} role="region" aria-label="Store announcements">
      <p className="srOnly">{segments.join('. ')}</p>
      <div className={styles.viewport} ref={viewportRef} aria-hidden="true">
        <div ref={measureRef} className={styles.measure}>
          {segments.map((segment, i) => (
            <span className={styles.segment} key={i}>
              {segment}
              <span className={styles.divider} />
            </span>
          ))}
        </div>
        <div className={styles.track}>
          <MarqueeGroup segments={segments} copies={copies} />
          <MarqueeGroup segments={segments} copies={copies} duplicate />
        </div>
      </div>
    </div>
  )
}
