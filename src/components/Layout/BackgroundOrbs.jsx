import { motion, useReducedMotion } from 'framer-motion'
import useAppStore, { getReducedEffectsMode } from '../../store/useAppStore'
import useMainScrollActivity from '../../hooks/useMainScrollActivity'

const orbs = [
  {
    color: 'var(--orb-1)',
    size: 900,
    x: [-50, 70, -50],
    y: [0, -60, 0],
    dur: 75,
    left: '5%',
    top: '5%',
    opacity: 0.5,
  },
  {
    color: 'var(--orb-2)',
    size: 800,
    x: [40, -60, 40],
    y: [-40, 50, -40],
    dur: 90,
    left: '55%',
    top: '0%',
    opacity: 0.45,
  },
  {
    color: 'var(--orb-3)',
    size: 750,
    x: [-30, 50, -30],
    y: [30, -70, 30],
    dur: 65,
    left: '25%',
    top: '45%',
    opacity: 0.4,
  },
  {
    color: 'var(--orb-4)',
    size: 1000,
    x: [60, -40, 60],
    y: [-25, 40, -25],
    dur: 80,
    left: '65%',
    top: '55%',
    opacity: 0.35,
  },
]

export default function BackgroundOrbs() {
  const sysReducedMotion = useReducedMotion()
  const appReducedMotion = useAppStore(s => s.preferences.reduceAnimations)
  const reducedEffectsMode = useAppStore(getReducedEffectsMode)
  const isMainScrolling = useMainScrollActivity()
  const throttleAmbientEffects = isMainScrolling && !reducedEffectsMode
  const reducedMotion = sysReducedMotion || appReducedMotion || reducedEffectsMode || throttleAmbientEffects

  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none" style={{ zIndex: 0 }}>
      {orbs.map((orb, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full"
          style={{
            width: reducedEffectsMode ? orb.size * 0.62 : throttleAmbientEffects ? orb.size * 0.7 : orb.size * 0.82,
            height: reducedEffectsMode ? orb.size * 0.62 : throttleAmbientEffects ? orb.size * 0.7 : orb.size * 0.82,
            background: `radial-gradient(circle at 40% 40%, ${orb.color}, transparent 65%)`,
            filter: reducedEffectsMode ? 'blur(36px)' : throttleAmbientEffects ? 'blur(44px)' : 'blur(72px)',
            opacity: reducedEffectsMode ? orb.opacity * 0.42 : throttleAmbientEffects ? orb.opacity * 0.32 : orb.opacity * 0.8,
            left: orb.left,
            top: orb.top,
            willChange: reducedMotion ? 'auto' : 'transform',
            transform: 'translateZ(0)',
          }}
          animate={reducedMotion ? {} : {
            x: orb.x,
            y: orb.y,
            scale: [1, 1.1, 0.95, 1],
          }}
          transition={{
            duration: orb.dur,
            repeat: Infinity,
            ease: 'easeInOut',
            times: [0, 0.33, 0.66, 1],
          }}
        />
      ))}
    </div>
  )
}
