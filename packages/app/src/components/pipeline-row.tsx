import { For, Show } from "solid-js"
import { Button } from "@opencode-ai/ui/button"

// ============ Types (mirror server/routes/pipeline.ts) ============

export interface StageState {
  teamId: string
  status: "pending" | "running" | "completed" | "waiting" | "skipped" | "failed"
  sessionId?: string
  startedAt?: string
  completedAt?: string
  output?: any
  question?: string
  partId?: string
  label?: string
}

export interface PipelineInstance {
  id: string
  storyTitle: string
  storyId?: string
  workflowId: string
  mode: "full" | "quick"
  stages: StageState[]
  currentStage: number
  directory: string
  createdAt: string
  completedAt?: string
  status: "running" | "paused" | "completed" | "stopped"
}

export interface Team {
  id: string
  name: string
  lead: string
  members: string[]
  icon: string
}

// ============ Helpers ============

export function elapsed(startedAt?: string): string {
  if (!startedAt) return ""
  const ms = Date.now() - new Date(startedAt).getTime()
  if (ms < 60000) return `${Math.floor(ms / 1000)}s`
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m`
  return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`
}

export function statusColor(status: StageState["status"]): string {
  switch (status) {
    case "completed": return "#2A9D8F"
    case "running": return "#2A9D8F"
    case "waiting": return "#E9C46A"
    case "failed": return "#E76F51"
    case "skipped": return "#6B7280"
    default: return "#4B5563"
  }
}

/** Map dynamic subagent teamIds (orchestrator delegations) to a sensible icon key. */
export function iconForTeamId(teamId: string, fallback?: string): string {
  if (fallback) return fallback
  if (teamId === "orchestrator") return "compass"
  if (teamId === "planner") return "brain"
  if (teamId.startsWith("developer") || teamId === "senior-developer") return "code"
  if (teamId.startsWith("test")) return "flask"
  if (teamId === "code-reviewer" || teamId === "pr") return "git-merge"
  if (teamId === "security-scanner") return "shield"
  if (teamId === "db-agent") return "database"
  if (teamId === "infra-agent") return "server"
  if (teamId === "doc-agent") return "book"
  if (teamId === "refactor") return "wrench"
  return "code"
}

export function labelForTeamId(teamId: string): string {
  return teamId.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

// ============ Icons ============

export function TeamIcon(props: { icon: string; size?: number }) {
  const s = props.size || 24
  const icons: Record<string, () => any> = {
    compass: () => (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
      </svg>
    ),
    brain: () => (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 2a5 5 0 0 1 5 5c0 .9-.2 1.7-.7 2.4A5 5 0 0 1 19 14a5 5 0 0 1-3.5 4.8A4 4 0 0 1 12 22a4 4 0 0 1-3.5-3.2A5 5 0 0 1 5 14a5 5 0 0 1 2.7-4.6A5 5 0 0 1 7 7a5 5 0 0 1 5-5z" />
        <path d="M12 2v20" />
      </svg>
    ),
    code: () => (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
      </svg>
    ),
    flask: () => (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M9 3h6v6l5 9H4l5-9V3z" /><path d="M9 3h6" />
      </svg>
    ),
    "git-merge": () => (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="18" cy="18" r="3" /><circle cx="6" cy="6" r="3" /><path d="M6 21V9a9 9 0 0 0 9 9" />
      </svg>
    ),
    shield: () => (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
    database: () => (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M3 5v14a9 3 0 0 0 18 0V5" />
        <path d="M3 12a9 3 0 0 0 18 0" />
      </svg>
    ),
    server: () => (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <rect x="2" y="3" width="20" height="8" rx="2" />
        <rect x="2" y="13" width="20" height="8" rx="2" />
        <line x1="6" y1="7" x2="6" y2="7" />
        <line x1="6" y1="17" x2="6" y2="17" />
      </svg>
    ),
    book: () => (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
    ),
    wrench: () => (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.8-2.8 2.5-2.5z" />
      </svg>
    ),
  }
  const Icon = icons[props.icon] || icons.code
  return <Icon />
}

// ============ Stage Node ============

export function StageNode(props: {
  stage: StageState
  team: Team | undefined
  isLast: boolean
  isCurrent: boolean
  pipelineStatus: PipelineInstance["status"]
  onClick: () => void
}) {
  const size = 56
  const isActive = () => props.stage.status === "running"
  const isWaiting = () => props.stage.status === "waiting"
  const isDone = () => props.stage.status === "completed"
  const isSkipped = () => props.stage.status === "skipped"
  const isFailed = () => props.stage.status === "failed"
  const isPending = () => props.stage.status === "pending"
  void isSkipped
  void isFailed

  const label = () => props.stage.label || props.team?.name || labelForTeamId(props.stage.teamId)
  const iconKey = () => iconForTeamId(props.stage.teamId, props.team?.icon)

  return (
    <div class="flex items-center gap-0">
      <button
        type="button"
        onClick={props.onClick}
        class="relative flex flex-col items-center gap-2 cursor-pointer group transition-transform hover:scale-105"
        style={{ "min-width": "100px", "max-width": "140px" }}
      >
        <div
          class="relative flex items-center justify-center rounded-full border-2 transition-all"
          style={{
            width: `${size}px`,
            height: `${size}px`,
            "border-color": statusColor(props.stage.status),
            background: isDone() ? statusColor(props.stage.status) : isFailed() ? "#E76F5120" : isWaiting() ? "#E9C46A18" : "var(--color-surface-raised-base)",
            "box-shadow": isActive() || isWaiting() ? `0 0 20px ${statusColor(props.stage.status)}40` : "none",
          }}
        >
          <Show when={isActive() || isWaiting()}>
            <div
              class="absolute inset-0 rounded-full animate-ping opacity-30"
              style={{ "border": `2px solid ${statusColor(props.stage.status)}` }}
            />
          </Show>

          <Show when={isWaiting()}>
            <span style={{ color: "#E9C46A", "font-size": "26px", "font-weight": "700", "line-height": "1" }}>?</span>
          </Show>
          <Show when={isDone() && !isWaiting()}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </Show>
          <Show when={!isDone() && !isWaiting()}>
            <div style={{ color: isPending() ? "#6B7280" : statusColor(props.stage.status) }}>
              <TeamIcon icon={iconKey()} />
            </div>
          </Show>

          <Show when={isWaiting()}>
            <div class="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-amber-400 flex items-center justify-center text-xs font-bold text-black">!</div>
          </Show>
        </div>

        <div class="flex flex-col items-center gap-0.5 max-w-[140px] text-center">
          <span class="text-12-medium text-text-strong group-hover:text-brand-base transition-colors truncate max-w-[140px]">
            {label()}
          </span>
          <span class="text-10-regular" style={{ color: statusColor(props.stage.status) }}>
            {isWaiting() ? "Needs Answer" :
              props.stage.status === "completed" ? "Done" :
              props.stage.status === "running" ? elapsed(props.stage.startedAt) || "Running" :
              props.stage.status === "skipped" ? "Skipped" :
              props.stage.status === "failed" ? "Failed" : "Pending"}
          </span>
        </div>
      </button>

      <Show when={!props.isLast}>
        <div class="flex items-center" style={{ width: "60px", "margin-top": "-24px" }}>
          <div
            class="h-0.5 flex-1"
            style={{
              background: isDone() ? statusColor("completed") : "var(--color-border-base)",
            }}
          />
          <Show when={isDone()}>
            <svg width="8" height="12" viewBox="0 0 8 12" fill={statusColor("completed")}>
              <path d="M0 0l8 6-8 6z" />
            </svg>
          </Show>
          <Show when={!isDone()}>
            <svg width="8" height="12" viewBox="0 0 8 12" fill="var(--color-border-base)">
              <path d="M0 0l8 6-8 6z" />
            </svg>
          </Show>
        </div>
      </Show>
    </div>
  )
}

// ============ Pipeline Row ============

export function PipelineRow(props: {
  pipeline: PipelineInstance
  teams: Team[]
  onStageClick: (pipeline: PipelineInstance, stageIdx: number) => void
  onStop?: (id: string) => void
}) {
  const totalElapsed = () => elapsed(props.pipeline.createdAt)
  const isActive = () => props.pipeline.status === "running" || props.pipeline.status === "paused"
  const orchestratorStage = () => props.pipeline.stages.find((s) => s.teamId === "orchestrator" && s.partId === undefined)
  const hasQuestion = () => props.pipeline.stages.some((s) => s.status === "waiting")
  const subagentCount = () => props.pipeline.stages.filter((s) => s.partId !== undefined).length

  return (
    <div
      class="relative rounded-xl border bg-surface-raised-base p-5 transition-all hover:shadow-lg"
      style={{
        "border-color": isActive() ? "var(--color-brand-base)" : "var(--color-border-base)",
        "border-left-width": "4px",
        "border-left-color": isActive() ? "var(--color-brand-base)" :
          props.pipeline.status === "completed" ? "#2A9D8F" :
          props.pipeline.status === "stopped" ? "#E76F51" : "var(--color-border-base)",
      }}
    >
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-3 min-w-0">
          <Show when={props.pipeline.storyId}>
            <span class="text-11-regular text-text-weak font-mono">#{props.pipeline.storyId}</span>
          </Show>
          <span class="text-14-medium text-text-strong truncate">{props.pipeline.storyTitle}</span>
          <span class="text-10-regular px-2 py-0.5 rounded-full font-mono shrink-0" style={{
            background: "#8B5CF620",
            color: "#8B5CF6",
          }}>
            orchestrator
          </span>
          <Show when={subagentCount() > 0}>
            <span class="text-10-regular text-text-weak">
              {subagentCount()} subagent{subagentCount() === 1 ? "" : "s"}
            </span>
          </Show>
        </div>
        <div class="flex items-center gap-3 shrink-0">
          <span class="text-11-regular text-text-weak font-mono">{totalElapsed()}</span>
          <Show when={isActive() && props.onStop}>
            <button
              type="button"
              onClick={() => props.onStop?.(props.pipeline.id)}
              class="w-7 h-7 rounded-md flex items-center justify-center bg-red-500/10 hover:bg-red-500/20 transition-colors"
              title="Stop pipeline"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="#E76F51"><rect width="12" height="12" rx="2" /></svg>
            </button>
          </Show>
          <Show when={props.pipeline.status === "completed"}>
            <span class="text-11-medium text-emerald-400">Complete</span>
          </Show>
          <Show when={props.pipeline.status === "stopped"}>
            <span class="text-11-medium text-red-400">Stopped</span>
          </Show>
        </div>
      </div>

      <div class="flex items-start justify-start pl-2 overflow-x-auto">
        <For each={props.pipeline.stages}>
          {(stage, i) => {
            const team = () => props.teams.find((t) => t.id === stage.teamId)
            return (
              <StageNode
                stage={stage}
                team={team()}
                isLast={i() === props.pipeline.stages.length - 1}
                isCurrent={i() === props.pipeline.currentStage}
                pipelineStatus={props.pipeline.status}
                onClick={() => props.onStageClick(props.pipeline, i())}
              />
            )
          }}
        </For>
        <Show when={isActive() && orchestratorStage()?.status === "running"}>
          {/* Trailing "more incoming" indicator while orchestrator is still delegating */}
          <div class="flex items-center pl-2" style={{ "margin-top": "-24px" }}>
            <span class="text-11-regular text-text-weak italic">delegating…</span>
          </div>
        </Show>
      </div>

      <Show when={hasQuestion()}>
        <div class="mt-3 px-4 py-2.5 rounded-lg bg-amber-400/10 border border-amber-400/30">
          <div class="flex items-start gap-2">
            <span class="text-amber-400 mt-0.5">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0a8 8 0 100 16A8 8 0 008 0zm1 12H7v-2h2v2zm0-3H7V4h2v5z"/></svg>
            </span>
            <span class="text-12-regular text-text-strong">
              A subagent is waiting for input — open the orchestrator session to respond.
            </span>
          </div>
        </div>
      </Show>

      <Show when={isActive()}>
        <div class="mt-3 flex justify-end">
          <Button size="small" variant="ghost" onClick={() => props.onStageClick(props.pipeline, 0)}>
            Open orchestrator session
          </Button>
        </div>
      </Show>
    </div>
  )
}
