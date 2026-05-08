import { createSignal, onCleanup, Show } from "solid-js"

export interface MorphConfig {
  fromRect: DOMRect
  toRect?: { top: number; left: number; width: number; height: number }
  direction: "in" | "out"
  duration?: number
  onComplete: () => void
}

export function MorphTransition(props: MorphConfig) {
  const duration = props.duration ?? 420
  const [phase, setPhase] = createSignal<"start" | "end">("start")

  // Trigger the animation after one frame
  requestAnimationFrame(() => {
    requestAnimationFrame(() => setPhase("end"))
  })

  // Call onComplete after duration
  const timer = setTimeout(() => props.onComplete(), duration + 30)
  onCleanup(() => clearTimeout(timer))

  const to = props.toRect ?? {
    top: 44, // below header
    left: 0,
    width: window.innerWidth,
    height: window.innerHeight - 44,
  }

  const fromStyle = () => {
    if (props.direction === "in") {
      return phase() === "start"
        ? {
            top: `${props.fromRect.top}px`,
            left: `${props.fromRect.left}px`,
            width: `${props.fromRect.width}px`,
            height: `${props.fromRect.height}px`,
            "border-radius": "12px",
            opacity: "1",
          }
        : {
            top: `${to.top}px`,
            left: `${to.left}px`,
            width: `${to.width}px`,
            height: `${to.height}px`,
            "border-radius": "0px",
            opacity: "1",
          }
    }
    // direction === "out"
    return phase() === "start"
      ? {
          top: `${to.top}px`,
          left: `${to.left}px`,
          width: `${to.width}px`,
          height: `${to.height}px`,
          "border-radius": "0px",
          opacity: "1",
        }
      : {
          top: `${props.fromRect.top}px`,
          left: `${props.fromRect.left}px`,
          width: `${props.fromRect.width}px`,
          height: `${props.fromRect.height}px`,
          "border-radius": "12px",
          opacity: "0",
        }
  }

  return (
    <div
      class="fixed z-40 bg-[#0a1514] border border-[#2A9D8F44] shadow-2xl shadow-black/60 overflow-hidden"
      style={{
        ...fromStyle(),
        transition: `all ${duration}ms cubic-bezier(0.4, 0, 0.2, 1)`,
        "pointer-events": "none",
      }}
    >
      {/* Inner glow effect during morph */}
      <div
        class="absolute inset-0 bg-gradient-to-br from-[#2A9D8F08] to-transparent"
        style={{
          opacity: phase() === "end" && props.direction === "in" ? "1" : "0",
          transition: `opacity ${duration}ms ease`,
        }}
      />
    </div>
  )
}

// Sibling fade-out overlay
export function SiblingsFade(props: { show: boolean; duration?: number }) {
  return (
    <div
      class="fixed inset-0 z-30 bg-[#080d0c] pointer-events-none"
      style={{
        opacity: props.show ? "1" : "0",
        transition: `opacity ${props.duration ?? 300}ms ease`,
      }}
    />
  )
}
