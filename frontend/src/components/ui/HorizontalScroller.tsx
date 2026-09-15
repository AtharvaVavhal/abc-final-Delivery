import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/utils/cn'
import styles from './HorizontalScroller.module.css'

interface HorizontalScrollerProps {
  children: ReactNode
  ariaLabel: string
  className?: string
  trackClassName?: string
}

export function HorizontalScroller({
  children,
  ariaLabel,
  className,
  trackClassName,
}: HorizontalScrollerProps) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [canScroll, setCanScroll] = useState(false)

  useEffect(() => {
    const track = trackRef.current
    if (!track) return

    const update = () => {
      setCanScroll(track.scrollWidth > track.clientWidth + 8)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(track)
    return () => observer.disconnect()
  }, [children])

  const scroll = (direction: 'left' | 'right') => {
    const track = trackRef.current
    if (!track) return
    const amount = Math.max(track.clientWidth * 0.7, 240)
    track.scrollBy({ left: direction === 'left' ? -amount : amount, behavior: 'smooth' })
  }

  return (
    <div className={cn(styles.wrap, className)}>
      {canScroll && (
        <button
          type="button"
          className={cn(styles.nav, styles.navLeft)}
          aria-label={`Scroll ${ariaLabel} left`}
          onClick={() => scroll('left')}
        >
          <ChevronLeft size={20} aria-hidden="true" />
        </button>
      )}
      <div
        ref={trackRef}
        className={cn(styles.track, trackClassName)}
        aria-label={ariaLabel}
        data-story-track="true"
      >
        {children}
      </div>
      {canScroll && (
        <button
          type="button"
          className={cn(styles.nav, styles.navRight)}
          aria-label={`Scroll ${ariaLabel} right`}
          onClick={() => scroll('right')}
        >
          <ChevronRight size={20} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
