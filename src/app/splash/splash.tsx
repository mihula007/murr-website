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

/** Блокировка прокрутки страницы, пока заставка видна. */
const LOCK_CLASSES = ['overflow-hidden', 'overscroll-none']

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
  if (document.readyState === 'complete') {
    start()
  } else {
    window.addEventListener('load', start, { once: true })
  }
  return () => {
    window.removeEventListener('load', start)
    window.clearTimeout(timer)
  }
}

/** Обновляет метку активности при действиях пользователя не чаще раза в 15 с. */
function useActivityTracking(enabled: boolean) {
  useEffect(() => {
    if (!enabled) {
      return
    }
    let lastWrite = readLastActivity() ?? 0
    const mark = () => {
      const now = Date.now()
      if (now - lastWrite < ACTIVITY_WRITE_INTERVAL_MS) {
        return
      }
      lastWrite = now
      writeLastActivity(now)
    }
    const events = ['pointerdown', 'keydown', 'touchstart'] as const
    for (const name of events) {
      window.addEventListener(name, mark, { passive: true })
    }
    return () => {
      for (const name of events) {
        window.removeEventListener(name, mark)
      }
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
      if (current !== 'visible') {
        return current
      }
      writeLastActivity(Date.now())
      return prefersReducedMotion() ? 'gone' : 'leaving'
    })
  }, [])

  useEffect(() => {
    if (phase !== 'visible') {
      return
    }
    const locked = [document.documentElement, document.body]
    for (const element of locked) {
      element.classList.add(...LOCK_CLASSES)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    const cancelAutoClose = afterPageLoad(close, AUTO_CLOSE_MS)
    return () => {
      for (const element of locked) {
        element.classList.remove(...LOCK_CLASSES)
      }
      document.removeEventListener('keydown', onKeyDown)
      cancelAutoClose()
    }
  }, [phase, close])

  useEffect(() => {
    if (phase !== 'leaving') {
      return
    }
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
      className="fixed inset-0 z-1000 m-0 grid size-auto max-h-none max-w-none place-items-center overflow-hidden border-0 bg-splash-surface p-0 text-splash-text opacity-100 transition-opacity duration-1100 ease-[ease] before:pointer-events-none before:absolute before:inset-0 before:z-1 before:bg-(image:--image-splash-vignette) after:pointer-events-none after:absolute after:-inset-[20%] after:z-1 after:animate-splash-eye after:bg-(image:--image-splash-eye) after:mix-blend-screen data-leaving:pointer-events-none data-leaving:opacity-0 motion-reduce:transition-none motion-reduce:after:animate-none"
      aria-modal="true"
      aria-labelledby="splash-title"
      aria-describedby="splash-subtitle"
      data-leaving={leaving ? '' : undefined}
    >
      <img
        className="absolute inset-0 size-full animate-splash-drift object-cover object-center brightness-70 saturate-88 max-[600px]:object-[54%_center] motion-reduce:animate-none"
        src={introArt}
        alt=""
        decoding="async"
        fetchPriority="high"
      />
      <div
        className="absolute top-[26px] left-7 z-2 flex items-center gap-2.5 text-xs font-extrabold tracking-[0.2em] text-splash-text uppercase opacity-85 max-[600px]:top-4 max-[600px]:left-[15px]"
        aria-hidden="true"
      >
        <img
          src={eyeIcon}
          alt=""
          width={34}
          height={34}
          className="size-[34px] object-contain"
        />
        MurrClan
      </div>
      <div className="relative z-2 mt-[23vh] w-[min(900px,90vw)] p-7 text-center text-shadow-splash max-[600px]:mt-[32vh] max-[600px]:w-full max-[600px]:px-4 max-[600px]:py-3">
        <p className="m-0 animate-splash-kicker text-[length:clamp(10px,1.3vw,14px)] tracking-[0.42em] text-splash-kicker uppercase max-[600px]:tracking-[0.3em] motion-reduce:animate-none">
          Тени пробуждаются
        </p>
        <h1
          id="splash-title"
          className="mt-3.5 mb-2 animate-splash-title text-[length:clamp(42px,8vw,100px)] leading-[0.95] font-black tracking-[0.12em] wrap-anywhere text-splash-text uppercase max-[600px]:tracking-[0.07em] motion-reduce:animate-none"
        >
          Murr
          <span className="text-splash-accent text-shadow-splash-glow">
            Clan
          </span>
        </h1>
        <p
          id="splash-subtitle"
          className="m-0 animate-splash-sub text-[length:clamp(11px,1.6vw,16px)] tracking-[0.14em] text-splash-sub motion-reduce:animate-none"
        >
          Легенда продолжается. Мы — одно целое.
        </p>
        <div className="mt-[27px] flex animate-splash-actions flex-wrap justify-center gap-3 motion-reduce:animate-none">
          <button
            ref={skipRef}
            type="button"
            className="cursor-pointer rounded-[3px] border border-splash-line bg-transparent px-[18px] py-3.5 text-xs tracking-[0.12em] text-splash-text uppercase transition-[background,border-color] duration-250 hover:border-splash-accent hover:bg-splash-hover max-[600px]:w-full"
            onClick={onSkip}
            disabled={leaving}
          >
            Пропустить анимацию
          </button>
        </div>
      </div>
      <div
        className="absolute right-7 bottom-[23px] left-7 z-2 flex justify-between text-[10px] tracking-[0.15em] text-splash-muted uppercase max-[600px]:right-3.5 max-[600px]:bottom-3 max-[600px]:left-3.5 max-[600px]:text-[8px]"
        aria-hidden="true"
      >
        <span>Сила в единстве</span>
      </div>
    </dialog>
  )
}
