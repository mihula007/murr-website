import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react'
import eyeIcon from '@/assets/murrclan-eye.png'
import introArt from '@/assets/murrclan-intro.jpg'
import {
  ACTIVITY_WRITE_INTERVAL_MS,
  AUTO_CLOSE_MS,
  LEAVE_MS,
  readLastActivity,
  shouldShowSplash,
  writeLastActivity,
} from './splash-timing'

type Phase = 'visible' | 'leaving' | 'gone'

const LOCK_CLASS = 'splash-lock'

function prefersReducedMotion() {
  return (
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  )
}

/** Запускает `callback` через `delay` после события `load` страницы. */
function afterPageLoad(callback: () => void, delay: number) {
  let timer: number | undefined
  const start = () => {
    timer = window.setTimeout(callback, delay)
  }
  if (document.readyState === 'complete') start()
  else window.addEventListener('load', start, { once: true })
  return () => {
    window.removeEventListener('load', start)
    window.clearTimeout(timer)
  }
}

/** Обновляет метку активности при действиях пользователя не чаще раза в 15 с. */
function useActivityTracking(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    let lastWrite = readLastActivity() ?? 0
    const mark = () => {
      const now = Date.now()
      if (now - lastWrite < ACTIVITY_WRITE_INTERVAL_MS) return
      lastWrite = now
      writeLastActivity(now)
    }
    const events = ['pointerdown', 'keydown', 'touchstart'] as const
    for (const name of events)
      window.addEventListener(name, mark, { passive: true })
    return () => {
      for (const name of events) window.removeEventListener(name, mark)
    }
  }, [enabled])
}

/**
 * Заставка при первом открытии (HOM-12, HOM-13). Пока она видна, оболочка
 * получает `inert`, а прокрутка заблокирована классом на `html`; блокировка
 * снимается в момент закрытия и при размонтировании.
 */
export function SplashGate({ children }: PropsWithChildren) {
  const [phase, setPhase] = useState<Phase>(() =>
    shouldShowSplash(Date.now(), readLastActivity()) ? 'visible' : 'gone',
  )

  const close = useCallback(() => {
    setPhase((current) => {
      if (current !== 'visible') return current
      writeLastActivity(Date.now())
      return prefersReducedMotion() ? 'gone' : 'leaving'
    })
  }, [])

  useEffect(() => {
    if (phase !== 'visible') return
    const root = document.documentElement
    root.classList.add(LOCK_CLASS)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKeyDown)
    const cancelAutoClose = afterPageLoad(close, AUTO_CLOSE_MS)
    return () => {
      root.classList.remove(LOCK_CLASS)
      document.removeEventListener('keydown', onKeyDown)
      cancelAutoClose()
    }
  }, [phase, close])

  useEffect(() => {
    if (phase !== 'leaving') return
    const timer = window.setTimeout(() => setPhase('gone'), LEAVE_MS)
    return () => window.clearTimeout(timer)
  }, [phase])

  useActivityTracking(phase === 'gone')

  return (
    <>
      <div className="contents" inert={phase === 'visible'}>
        {children}
      </div>
      {phase === 'gone' ? null : (
        <Splash leaving={phase === 'leaving'} onSkip={close} />
      )}
    </>
  )
}

type SplashProps = { leaving: boolean; onSkip: () => void }

export function Splash({ leaving, onSkip }: SplashProps) {
  const skipRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    skipRef.current?.focus()
  }, [])

  return (
    <dialog
      open
      className="splash"
      aria-modal="true"
      aria-labelledby="splash-title"
      aria-describedby="splash-subtitle"
      data-leaving={leaving ? '' : undefined}
    >
      <img
        className="splash-art"
        src={introArt}
        alt=""
        decoding="async"
        fetchPriority="high"
      />
      <div className="splash-mark" aria-hidden="true">
        <img src={eyeIcon} alt="" width={34} height={34} />
        MurrClan
      </div>
      <div className="splash-content">
        <p className="splash-kicker">Тени пробуждаются</p>
        <h1 id="splash-title" className="splash-title">
          Murr<span>Clan</span>
        </h1>
        <p id="splash-subtitle" className="splash-sub">
          Легенда продолжается. Мы — одно целое.
        </p>
        <div className="splash-actions">
          <button
            ref={skipRef}
            type="button"
            className="splash-skip"
            onClick={onSkip}
            disabled={leaving}
          >
            Пропустить анимацию
          </button>
        </div>
      </div>
      <div className="splash-bottom" aria-hidden="true">
        <span>Сила в единстве</span>
      </div>
    </dialog>
  )
}
