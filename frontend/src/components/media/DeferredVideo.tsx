import { useEffect, useRef, useState } from 'react'
import { shouldAutoplayVideo } from '@/features/media/mediaAsset'
import { cn } from '@/utils/cn'
import styles from './DeferredVideo.module.css'

const MAX_CONCURRENT_AUTOPLAY = 3
let autoplayCount = 0

interface DeferredVideoProps {
  src: string
  poster?: string
  className?: string
  label: string
}

/**
 * Muted looping video that only loads (and autoplays) when near the
 * viewport. Honours reduced-motion and save-data. Caps concurrent autoplay
 * so a homepage of many cards does not download every clip at once.
 */
export function DeferredVideo({ src, poster, className, label }: DeferredVideoProps) {
  const ref = useRef<HTMLVideoElement>(null)
  const [active, setActive] = useState(false)
  const [canPlay, setCanPlay] = useState(false)

  useEffect(() => {
    const node = ref.current
    if (!node) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        setActive(entry.isIntersecting && entry.intersectionRatio >= 0.35)
      },
      { rootMargin: '80px 0px', threshold: [0, 0.35, 0.75] },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const video = ref.current
    if (!video) return

    if (!active || !shouldAutoplayVideo()) {
      video.pause()
      if (video.dataset.playing === '1') {
        autoplayCount = Math.max(0, autoplayCount - 1)
        video.dataset.playing = '0'
      }
      return
    }

    if (autoplayCount >= MAX_CONCURRENT_AUTOPLAY && video.dataset.playing !== '1') {
      return
    }

    setCanPlay(true)
    video.defaultMuted = true
    video.muted = true
    void video
      .play()
      .then(() => {
        if (video.dataset.playing !== '1') {
          autoplayCount += 1
          video.dataset.playing = '1'
        }
      })
      .catch(() => {
        /* autoplay blocked — poster remains */
      })

    return () => {
      video.pause()
      if (video.dataset.playing === '1') {
        autoplayCount = Math.max(0, autoplayCount - 1)
        video.dataset.playing = '0'
      }
    }
  }, [active, src])

  return (
    <video
      ref={ref}
      className={cn(styles.video, className)}
      poster={poster || undefined}
      muted
      loop
      playsInline
      preload={canPlay ? 'metadata' : 'none'}
      aria-label={label}
    >
      {canPlay || active ? <source src={src} /> : null}
    </video>
  )
}
