import { createEffect, createMemo, createSignal, For, on, onCleanup, onMount, Show } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { useNavigate, useParams } from "@solidjs/router"
import { useSync } from "@/context/sync"
import { useSDK } from "@/context/sdk"
import { useServer } from "@/context/server"
import { Identifier } from "@/utils/id"
import { useNotification } from "@/context/notification"
import { usePermission } from "@/context/permission"
import { sessionPermissionRequest, sessionQuestionRequest } from "@/pages/session/composer/session-request-tree"
import { persisted } from "@/utils/persist"
import { Button } from "@opencode-ai/ui/button"
import { TeamIcon, statusColor as pipelineStatusColor, type PipelineInstance, type Team } from "@/components/pipeline-row"
import { OrchestratorFlow } from "@/components/orchestrator-flow"

type SortMode = "attention" | "recent"

type DashboardPrefs = {
  sortBy: SortMode
  showArchived: boolean
}

type Attention = {
  permission: boolean
  question: boolean
  retry: boolean
  error: boolean
}

const ATTENTION_RANK: Record<SortMode, (s: { attention: number; updated: number }) => number> = {
  attention: (s) => s.attention * 1e15 + s.updated,
  recent: (s) => s.updated,
}

function statusLabel(type: string) {
  if (type === "busy") return "running"
  if (type === "retry") return "retrying"
  return type
}

function statusColor(type: string, hasAttention: boolean) {
  if (hasAttention) return "var(--color-status-warning, #E9C46A)"
  if (type === "busy") return "var(--color-status-success, #2A9D8F)"
  if (type === "retry") return "var(--color-status-warning, #E9C46A)"
  if (type === "error") return "var(--color-status-error, #E76F51)"
  return "var(--color-text-weak)"
}

function formatRelative(ts?: number) {
  if (!ts) return ""
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

// Mission Control dashboard — Phase 2:
// status pill, notification badge, attention-required composite,
// attention-first sort with persisted "recent only" toggle, archived filter.
export default function DashboardPage() {
  const sync = useSync()
  const sdk = useSDK()
  const server = useServer()
  const navigate = useNavigate()
  const params = useParams()
  const notification = useNotification()
  const permission = usePermission()

  const [prefs, setPrefs] = persisted(
    "dashboard.v1",
    createStore<DashboardPrefs>({ sortBy: "attention", showArchived: false }),
  )

  // ---------- Orchestrator pipelines ----------
  const [pipelineStore, setPipelineStore] = createStore<{ list: PipelineInstance[]; teams: Team[] }>({ list: [], teams: [] })
  const [prompt, setPrompt] = createSignal("")
  const [submitting, setSubmitting] = createSignal(false)
  const [startError, setStartError] = createSignal<string | null>(null)

  const authHeaders = (): Record<string, string> => {
    const headers: Record<string, string> = { "Content-Type": "application/json" }
    const http = server.current?.http
    if (http?.password) headers["Authorization"] = `Basic ${btoa(`${http.username ?? "opencode"}:${http.password}`)}`
    return headers
  }
  const base = () => server.current?.http?.url || ""

  async function fetchPipelines() {
    const b = base()
    const dir = sync.data.path.directory
    if (!b || !dir) return
    try {
      const res = await fetch(`${b}/api/pipeline/instances?dir=${encodeURIComponent(dir)}`, { headers: authHeaders() })
      if (!res.ok) return
      const data = await res.json() as PipelineInstance[]
      setPipelineStore("list", reconcile(data, { key: "id" }))
    } catch {}
  }
  async function fetchConfig() {
    const b = base()
    const dir = sync.data.path.directory
    if (!b || !dir) return
    try {
      const res = await fetch(`${b}/api/pipeline/config?dir=${encodeURIComponent(dir)}`, { headers: authHeaders() })
      if (!res.ok) return
      const data = await res.json()
      const cfg = data.found ? data.config : data.default
      setPipelineStore("teams", cfg?.teams || [])
    } catch {}
  }

  let pollTimer: ReturnType<typeof setInterval>
  onMount(() => {
    fetchConfig()
    fetchPipelines()
    pollTimer = setInterval(fetchPipelines, 3000)
  })
  onCleanup(() => clearInterval(pollTimer))

  async function startOrchestrator() {
    const v = prompt().trim()
    setStartError(null)
    if (!v) { setStartError("Type a prompt first."); return }
    if (submitting()) return
    const dir = sync.data.path.directory
    if (!dir) { setStartError("Working directory not loaded yet — wait a moment and retry."); return }
    setSubmitting(true)
    try {
      const created = await sdk.client.session
        .create({ agent: "orchestrator" })
        .then((x) => x.data ?? undefined)
      if (!created) {
        setStartError("Failed to create session.")
        return
      }
      await sdk.client.session.promptAsync({
        sessionID: created.id,
        agent: "orchestrator",
        messageID: Identifier.ascending("message"),
        parts: [{ type: "text", text: v }],
      })
      setPrompt("")
      fetchPipelines()
    } catch (err) {
      setStartError(`Failed to start: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSubmitting(false)
    }
  }

  async function stopPipeline(id: string) {
    const b = base()
    const dir = sync.data.path.directory
    if (!b || !dir) return
    await fetch(`${b}/api/pipeline/stop/${id}?dir=${encodeURIComponent(dir)}`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({}),
    })
    fetchPipelines()
  }

  const [stagePanel, setStagePanel] = createSignal<{ pipeline: PipelineInstance; stageIdx: number } | null>(null)
  const [sessionPanel, setSessionPanel] = createSignal<string | null>(null)

  // ---------- Viewed / attention tracking ----------
  // idledAt: when each session last transitioned from busy/retry → idle.
  // Only sessions that have actually been busy then went idle get an entry.
  const [idledAt, setIdledAt] = createSignal(new Map<string, number>())

  // flowViewedAt: when the user last opened ANY agent in a given flow,
  // keyed by the flow's root session ID. Opening any agent in a flow
  // dismisses the "completed" highlight for the entire flow.
  const [flowViewedAt, setFlowViewedAt] = createSignal(new Map<string, number>())

  // Walk up parentID chain to find the root session ID for a given session.
  function findRootID(sessionID: string): string {
    const sessions = sync.data.session ?? []
    const byID = new Map(sessions.map((s) => [s.id, s]))
    let cur = sessionID
    while (true) {
      const s = byID.get(cur)
      if (!s?.parentID) return cur
      cur = s.parentID
    }
  }

  function openSession(sessionID: string) {
    setSessionPanel(sessionID)
    const rootID = findRootID(sessionID)
    setFlowViewedAt((prev) => {
      const next = new Map(prev)
      next.set(rootID, Date.now())
      return next
    })
  }

  // Track busy→idle transitions: record the timestamp when each session goes idle.
  const prevStatuses = new Map<string, string>()
  createEffect(
    on(
      () => sync.data.session_status,
      (statuses) => {
        const newIdled: [string, number][] = []
        for (const [id, st] of Object.entries(statuses)) {
          const cur = st?.type ?? "idle"
          const prev = prevStatuses.get(id) ?? "idle"
          if ((prev === "busy" || prev === "retry") && cur === "idle") {
            newIdled.push([id, Date.now()])
          }
          prevStatuses.set(id, cur)
        }
        if (newIdled.length > 0) {
          setIdledAt((prev) => {
            const next = new Map(prev)
            for (const [id, ts] of newIdled) next.set(id, ts)
            return next
          })
        }
      },
    ),
  )
  // ---------- /Viewed / attention tracking ----------

  function openStage(pipeline: PipelineInstance, stageIdx: number) {
    setStagePanel({ pipeline, stageIdx })
  }

  // Collect rootID + every descendant session id (depth-first) for the given orchestrator root.
  function collectFlowIds(rootID: string): string[] {
    const sessions = sync.data.session ?? []
    const byParent = new Map<string, string[]>()
    for (const s of sessions) {
      if (!s.parentID) continue
      const arr = byParent.get(s.parentID)
      if (arr) arr.push(s.id)
      else byParent.set(s.parentID, [s.id])
    }
    const out: string[] = []
    const stack = [rootID]
    const seen = new Set<string>()
    while (stack.length) {
      const id = stack.pop()!
      if (seen.has(id)) continue
      seen.add(id)
      out.push(id)
      const kids = byParent.get(id)
      if (kids) stack.push(...kids)
    }
    return out
  }

  // Stop the entire orchestrator flow: aborts root + all descendant sessions in parallel.
  async function stopFlow(rootID: string) {
    const ids = collectFlowIds(rootID)
    await Promise.all(ids.map((id) => sdk.client.session.abort({ sessionID: id }).catch(() => {})))
  }

  // Delete the entire orchestrator flow: aborts everything first, then deletes the root
  // (server cascades the delete to all descendants — see Session.remove in session.ts).
  async function deleteFlow(rootID: string) {
    if (sessionPanel() && collectFlowIds(rootID).includes(sessionPanel()!)) {
      setSessionPanel(null)
    }
    await stopFlow(rootID)
    await sdk.client.session.delete({ sessionID: rootID }).catch(() => {})
  }

  // Re-resolve the panel's pipeline against the live store so streaming updates
  // (status changes, new sessionId once the orchestrator delegates) reflect in the panel.
  const livePanel = createMemo(() => {
    const sel = stagePanel()
    if (!sel) return null
    const live = pipelineStore.list.find((p) => p.id === sel.pipeline.id) || sel.pipeline
    return { pipeline: live, stageIdx: Math.min(sel.stageIdx, live.stages.length - 1) }
  })

  // ---------- /Orchestrator pipelines ----------

  const orchestratorRoots = createMemo(() =>
    (sync.data.session ?? [])
      .filter((s) => !s.parentID && s.agent === "orchestrator" && (prefs.showArchived || !s.time?.archived))
      .sort((a, b) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0)),
  )

  // Set of session IDs that belong to any orchestrator flow (root + all descendants),
  // so we can exclude them from the flat session grid below.
  const orchestratorFlowIds = createMemo(() => {
    const sessions = sync.data.session ?? []
    const byParent = new Map<string, string[]>()
    for (const s of sessions) {
      if (!s.parentID) continue
      const arr = byParent.get(s.parentID)
      if (arr) arr.push(s.id)
      else byParent.set(s.parentID, [s.id])
    }
    const out = new Set<string>()
    const stack = orchestratorRoots().map((s) => s.id)
    while (stack.length) {
      const id = stack.pop()!
      if (out.has(id)) continue
      out.add(id)
      const kids = byParent.get(id)
      if (kids) stack.push(...kids)
    }
    return out
  })

  const allSessions = createMemo(() =>
    (sync.data.session ?? []).filter(
      (s) => !s.parentID && !orchestratorFlowIds().has(s.id) && (prefs.showArchived || !s.time?.archived),
    ),
  )

  const directory = () => sync.data.path.directory

  const attentionFor = (sessionID: string): Attention => {
    const perm = sessionPermissionRequest(
      sync.data.session,
      sync.data.permission,
      sessionID,
      (item) => !permission.autoResponds(item, directory()),
    )
    const question = sessionQuestionRequest(sync.data.session, sync.data.question, sessionID)
    const status = sync.data.session_status[sessionID]?.type
    return {
      permission: !!perm,
      question: !!question,
      retry: status === "retry",
      error: notification.session.unseenHasError(sessionID),
    }
  }

  const ranked = createMemo(() => {
    const list = allSessions().map((session) => {
      const attention = attentionFor(session.id)
      const attentionScore =
        Number(attention.permission) +
        Number(attention.question) +
        Number(attention.retry) +
        Number(attention.error)
      return {
        session,
        attention,
        attentionScore,
        updated: session.time?.updated ?? 0,
        status: sync.data.session_status[session.id]?.type ?? "idle",
        unseen: notification.session.unseenCount(session.id),
      }
    })
    const rank = ATTENTION_RANK[prefs.sortBy]
    return list.sort((a, b) => rank({ attention: b.attentionScore, updated: b.updated }) - rank({ attention: a.attentionScore, updated: a.updated }))
  })

  // Counts across ALL root sessions (orchestrator flows + flat sessions) for the KPI bar.
  const allRootSessions = createMemo(() =>
    (sync.data.session ?? []).filter((s) => !s.parentID && (prefs.showArchived || !s.time?.archived)),
  )

  const counts = createMemo(() => {
    const sessions = allRootSessions()
    let active = 0
    let waiting = 0
    let errors = 0
    for (const s of sessions) {
      const st = sync.data.session_status[s.id]?.type ?? "idle"
      if (st === "busy" || st === "retry") active++
      const att = attentionFor(s.id)
      if (att.permission || att.question || att.retry || att.error) waiting++
      if (att.error) errors++
    }
    return { active, waiting, errors, total: sessions.length }
  })

  return (
    <div class="size-full overflow-auto bg-background-base">
      <div class="max-w-[1400px] mx-auto px-6 py-6 flex flex-col gap-6">
        <header class="flex items-center justify-between">
          <div class="flex flex-col gap-1">
            <h1 class="text-18-medium text-text-strong">Mission Control</h1>
            <span class="text-12-regular text-text-weak">
              {counts().total} session{counts().total === 1 ? "" : "s"}
            </span>
          </div>
        </header>

        {/* KPI bar — placeholder for cost; real values for counts derived locally. */}
        <div class="grid grid-cols-4 gap-3">
          <KpiTile label="Active" value={counts().active} />
          <KpiTile label="Waiting on you" value={counts().waiting} accent={counts().waiting > 0} />
          <KpiTile label="Cost today" value="—" />
          <KpiTile label="Errors" value={counts().errors} danger={counts().errors > 0} />
        </div>

        {/* Start with Orchestrator */}
        <div class="rounded-xl border border-border-base bg-background-strong p-5 flex flex-col gap-3">
          <div class="flex items-center gap-2">
            <div class="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "#8B5CF620", color: "#8B5CF6" }}>
              <TeamIcon icon="compass" size={16} />
            </div>
            <div class="flex flex-col">
              <span class="text-13-medium text-text-strong">Start with Orchestrator</span>
              <span class="text-11-regular text-text-weak">Describe what you want — the orchestrator will plan and delegate to subagents.</span>
            </div>
          </div>
          <textarea
            rows={3}
            value={prompt()}
            onInput={(e) => setPrompt(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); startOrchestrator() } }}
            placeholder="e.g. Add OAuth login to the marketing site and write tests"
            class="px-3 py-2 rounded-lg border border-border-base bg-background-base text-text-strong text-13-regular resize-none focus:outline-none focus:border-brand-base"
          />
          <div class="flex items-center justify-between">
            <span class="text-11-regular text-text-weak">⌘+Enter to start</span>
            <Button size="small" onClick={startOrchestrator} disabled={!prompt().trim() || submitting()}>
              {submitting() ? "Starting…" : "Start with Orchestrator"}
            </Button>
          </div>
          <Show when={startError()}>
            <div class="text-11-regular text-status-error border border-status-error/40 rounded px-3 py-2 bg-status-error/5">
              {startError()}
            </div>
          </Show>
        </div>

        {/* Orchestrator flow trees */}
        <Show when={orchestratorRoots().length > 0}>
          <div class="flex flex-col gap-3">
            <div class="flex items-center justify-between">
              <h2 class="text-14-medium text-text-strong">Orchestrator Flows</h2>
              <span class="text-11-regular text-text-weak">
                {orchestratorRoots().length} flow{orchestratorRoots().length === 1 ? "" : "s"}
              </span>
            </div>
            <div class="flex flex-col gap-3">
              <For each={orchestratorRoots()}>
                {(root) => (
                  <OrchestratorFlow
                    root={root}
                    onOpen={openSession}
                    onStop={stopFlow}
                    onDelete={deleteFlow}
                    idledAt={idledAt()}
                    flowViewedAt={flowViewedAt()}
                  />
                )}
              </For>
            </div>
          </div>
        </Show>

        {/* Session grid */}
        <Show
          when={ranked().length > 0}
          fallback={
            <Show when={orchestratorRoots().length === 0}>
              <div class="flex flex-col items-center justify-center py-20 gap-3">
                <h2 class="text-16-medium text-text-strong">No sessions yet</h2>
                <span class="text-12-regular text-text-weak">
                  Start a session from the sidebar to see it here.
                </span>
              </div>
            </Show>
          }
        >
          <div class="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-3">
            <For each={ranked()}>
              {(item) => (
                <button
                  type="button"
                  class="text-left rounded-lg border border-border-base bg-background-strong p-4 flex flex-col gap-3 hover:border-border-strong transition-colors"
                  onClick={() => openSession(item.session.id)}
                >
                  <div class="flex items-start justify-between gap-2">
                    <span class="text-14-medium text-text-strong line-clamp-2">
                      {item.session.title || "Untitled session"}
                    </span>
                    <Show when={item.unseen > 0}>
                      <span
                        class="shrink-0 rounded-full px-2 py-0.5 text-11-medium"
                        style={{
                          background: item.attention.error
                            ? "var(--color-status-error, #E76F51)20"
                            : "var(--color-surface-info-base, #2A9D8F)20",
                          color: item.attention.error
                            ? "var(--color-status-error, #E76F51)"
                            : "var(--color-text-strong)",
                        }}
                      >
                        {item.unseen}
                      </span>
                    </Show>
                  </div>
                  <div class="flex items-center gap-2">
                    <span
                      class="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-11-medium"
                      style={{
                        background: `${statusColor(item.status, item.attentionScore > 0)}20`,
                        color: statusColor(item.status, item.attentionScore > 0),
                      }}
                    >
                      <span
                        class="size-1.5 rounded-full"
                        style={{ background: statusColor(item.status, item.attentionScore > 0) }}
                      />
                      {item.attention.permission
                        ? "needs approval"
                        : item.attention.question
                          ? "needs answer"
                          : statusLabel(item.status)}
                    </span>
                    <Show when={item.attention.error}>
                      <span class="text-11-regular text-status-error">error</span>
                    </Show>
                  </div>
                  <span class="text-11-regular text-text-weak">{formatRelative(item.updated)}</span>
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>

      {/* Stage chat side panel */}
      <Show when={livePanel()}>
        {(sel) => (
          <StageSessionPanel
            pipeline={sel().pipeline}
            stageIdx={sel().stageIdx}
            team={pipelineStore.teams.find((t) => t.id === sel().pipeline.stages[sel().stageIdx]?.teamId)}
            encodedDir={params.dir || ""}
            onClose={() => setStagePanel(null)}
          />
        )}
      </Show>
      <Show when={livePanel()}>
        <div class="fixed inset-0 z-30 bg-black/20" onClick={() => setStagePanel(null)} />
      </Show>

      {/* Slide-in session panel (clicking any dashboard session card) */}
      <Show when={sessionPanel()}>
        {(id) => (
          <SessionSlidePanel
            sessionID={id()}
            encodedDir={params.dir || ""}
            onClose={() => setSessionPanel(null)}
          />
        )}
      </Show>
      <Show when={sessionPanel()}>
        <div class="fixed inset-0 z-30 bg-black/20" onClick={() => setSessionPanel(null)} />
      </Show>

      <style>{`
        @keyframes dashSlideIn {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        .dash-slide-in { animation: dashSlideIn 0.3s cubic-bezier(0.16,1,0.3,1) forwards; }
      `}</style>
    </div>
  )
}

function StageSessionPanel(props: {
  pipeline: PipelineInstance
  stageIdx: number
  team: Team | undefined
  encodedDir: string
  onClose: () => void
}) {
  const stage = () => props.pipeline.stages[props.stageIdx]
  const sessionUrl = () => {
    const sid = stage()?.sessionId
    if (!sid) return null
    return `/${props.encodedDir}/session/${sid}?embedded=1`
  }
  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") props.onClose()
  }
  onMount(() => window.addEventListener("keydown", handleKeyDown))
  onCleanup(() => window.removeEventListener("keydown", handleKeyDown))

  return (
    <div class="fixed top-0 right-0 h-full w-[640px] z-40 bg-background-strong border-l border-border-base shadow-2xl flex flex-col dash-slide-in">
      <div class="shrink-0 px-5 py-4 border-b border-border-base flex items-center justify-between">
        <div class="flex items-center gap-3 min-w-0">
          <div class="w-8 h-8 shrink-0 rounded-full flex items-center justify-center" style={{ background: `${pipelineStatusColor(stage()?.status || "pending")}20`, color: pipelineStatusColor(stage()?.status || "pending") }}>
            <TeamIcon icon={props.team?.icon || "code"} size={16} />
          </div>
          <div class="flex flex-col min-w-0">
            <span class="text-13-medium text-text-strong truncate">{stage()?.label || props.team?.name || stage()?.teamId}</span>
            <span class="text-11-regular text-text-weak truncate">{props.pipeline.storyTitle}</span>
          </div>
        </div>
        <button type="button" onClick={props.onClose} class="text-text-weak hover:text-text-strong transition-colors shrink-0" aria-label="Close">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 4L4 12M4 4l8 8" /></svg>
        </button>
      </div>
      <div class="flex-1 min-h-0 bg-background-base">
        <Show
          when={sessionUrl()}
          fallback={
            <div class="flex flex-col items-center justify-center h-full px-6 text-center gap-2">
              <div class="text-13-medium text-text-strong">
                {stage()?.status === "pending" ? "Stage hasn't started yet" : "No session attached"}
              </div>
              <div class="text-12-regular text-text-weak">
                {stage()?.status === "pending"
                  ? "It will appear here once the orchestrator delegates."
                  : `Stage status: ${stage()?.status}`}
              </div>
              <Show when={stage()?.output}>
                <pre class="mt-3 max-w-full max-h-64 overflow-auto rounded-md bg-background-strong p-3 text-12-regular text-text-strong whitespace-pre-wrap font-mono text-left">
                  {typeof stage()!.output === "string" ? stage()!.output : JSON.stringify(stage()!.output, null, 2)}
                </pre>
              </Show>
            </div>
          }
        >
          {(url) => (
            <iframe
              src={url()}
              class="w-full h-full border-0 block"
              title={`${stage()?.label || props.team?.name || stage()?.teamId} session`}
              sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-downloads"
            />
          )}
        </Show>
      </div>
    </div>
  )
}

function KpiTile(props: { label: string; value: number | string; accent?: boolean; danger?: boolean }) {
  return (
    <div
      class="rounded-lg border bg-background-strong p-4 flex flex-col gap-1 transition-colors"
      classList={{
        "border-border-base": !props.accent && !props.danger,
        "border-status-warning": props.accent,
        "border-status-error": props.danger,
      }}
    >
      <span class="text-11-regular text-text-weak uppercase tracking-wider">{props.label}</span>
      <span
        class="text-18-medium"
        classList={{
          "text-text-strong": !props.danger,
          "text-status-error": props.danger,
        }}
      >
        {props.value}
      </span>
    </div>
  )
}

function SessionSlidePanel(props: { sessionID: string; encodedDir: string; onClose: () => void }) {
  const sync = useSync()
  const session = () => (sync.data.session ?? []).find((s) => s.id === props.sessionID)
  const status = () => sync.data.session_status[props.sessionID]?.type ?? "idle"
  const url = () => `/${props.encodedDir}/session/${props.sessionID}?embedded=1`

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") props.onClose()
  }
  onMount(() => window.addEventListener("keydown", handleKeyDown))
  onCleanup(() => window.removeEventListener("keydown", handleKeyDown))

  return (
    <div class="fixed top-0 right-0 h-full w-[640px] z-40 bg-background-strong border-l border-border-base shadow-2xl flex flex-col dash-slide-in">
      <div class="shrink-0 px-5 py-4 border-b border-border-base flex items-center justify-between gap-3">
        <div class="flex items-center gap-3 min-w-0">
          <span
            class="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-11-medium shrink-0"
            style={{ background: `${statusColor(status(), false)}20`, color: statusColor(status(), false) }}
          >
            <span class="size-1.5 rounded-full" style={{ background: statusColor(status(), false) }} />
            {statusLabel(status())}
          </span>
          <div class="flex flex-col min-w-0">
            <span class="text-13-medium text-text-strong truncate">
              {session()?.title || "Session"}
            </span>
            <Show when={session()?.agent}>
              <span class="text-11-regular text-text-weak truncate">@{session()?.agent}</span>
            </Show>
          </div>
        </div>
        <button
          type="button"
          onClick={props.onClose}
          class="text-text-weak hover:text-text-strong transition-colors shrink-0"
          aria-label="Close"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M12 4L4 12M4 4l8 8" />
          </svg>
        </button>
      </div>
      <div class="flex-1 min-h-0 bg-background-base">
        <iframe
          src={url()}
          class="w-full h-full border-0 block"
          title={session()?.title || "Session"}
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-downloads"
        />
      </div>
    </div>
  )
}
