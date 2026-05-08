import { createSignal, onCleanup, onMount, type ParentProps } from "solid-js"

export function InfiniteCanvas(props: ParentProps<{ class?: string }>) {
  const [x, setX] = createSignal(0)
  const [y, setY] = createSignal(0)
  const [scale, setScale] = createSignal(1)
  const [dragging, setDragging] = createSignal(false)

  let containerRef: HTMLDivElement | undefined
  let startX = 0
  let startY = 0
  let startPanX = 0
  let startPanY = 0

  function onWheel(e: WheelEvent) {
    e.preventDefault()
    if (e.ctrlKey || e.metaKey) {
      const rect = containerRef!.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top
      const delta = e.deltaY > 0 ? 0.9 : 1.1
      const newScale = Math.min(Math.max(scale() * delta, 0.15), 4)
      const ratio = newScale / scale()
      setX(mouseX - ratio * (mouseX - x()))
      setY(mouseY - ratio * (mouseY - y()))
      setScale(newScale)
    } else {
      setX(x() - e.deltaX)
      setY(y() - e.deltaY)
    }
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest("[data-no-pan]")) return
    setDragging(true)
    startX = e.clientX
    startY = e.clientY
    startPanX = x()
    startPanY = y()
    containerRef!.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragging()) return
    setX(startPanX + (e.clientX - startX))
    setY(startPanY + (e.clientY - startY))
  }

  function onPointerUp(e: PointerEvent) {
    if (!dragging()) return
    setDragging(false)
    containerRef!.releasePointerCapture(e.pointerId)
  }

  onMount(() => {
    containerRef!.addEventListener("wheel", onWheel, { passive: false })
    onCleanup(() => containerRef!.removeEventListener("wheel", onWheel))
  })

  return (
    <div
      ref={containerRef}
      class={`relative overflow-hidden select-none ${props.class || ""}`}
      style={{ cursor: dragging() ? "grabbing" : "grab" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* Dot grid background */}
      <div
        class="absolute inset-0 pointer-events-none"
        style={{
          "background-image": `radial-gradient(circle, rgba(42, 157, 143, 0.12) 1px, transparent 1px)`,
          "background-size": `${24 * scale()}px ${24 * scale()}px`,
          "background-position": `${x()}px ${y()}px`,
        }}
      />

      {/* Transform container */}
      <div
        style={{
          transform: `translate(${x()}px, ${y()}px) scale(${scale()})`,
          "transform-origin": "0 0",
          position: "absolute",
          top: "0",
          left: "0",
        }}
      >
        {props.children}
      </div>

      {/* Zoom controls */}
      <div class="absolute bottom-4 right-4 flex items-center gap-1 bg-[#0a1514]/90 backdrop-blur border border-[#2A9D8F33] rounded-lg px-2 py-1.5 shadow-lg" data-no-pan>
        <button
          class="text-gray-400 hover:text-[#2A9D8F] px-1.5 py-0.5 text-sm font-mono transition-colors"
          onClick={() => setScale(Math.max(0.15, scale() - 0.15))}
        >
          −
        </button>
        <span class="text-[10px] text-gray-500 font-mono min-w-[3ch] text-center">
          {Math.round(scale() * 100)}%
        </span>
        <button
          class="text-gray-400 hover:text-[#2A9D8F] px-1.5 py-0.5 text-sm font-mono transition-colors"
          onClick={() => setScale(Math.min(4, scale() + 0.15))}
        >
          +
        </button>
        <div class="w-px h-3 bg-[#2A9D8F33] mx-1" />
        <button
          class="text-gray-400 hover:text-[#2A9D8F] px-1.5 py-0.5 text-[10px] transition-colors"
          onClick={() => { setX(0); setY(0); setScale(1) }}
        >
          Reset
        </button>
      </div>
    </div>
  )
}
