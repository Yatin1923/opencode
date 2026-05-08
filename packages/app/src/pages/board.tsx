import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  Match,
  on,
  Show,
  Switch,
} from "solid-js"
import { createStore } from "solid-js/store"
import { useNavigate, useParams } from "@solidjs/router"
import { useServer } from "@/context/server"

interface WorkItem {
  id: number
  type: string
  title: string
  state: string
  assignedTo: string | null
  priority: number
  storyPoints: number | null
  tags: string
  description: string
  acceptanceCriteria: string
  areaPath: string
  iterationPath: string
  url: string
  prCount: number
  children?: WorkItem[]
  comments?: { id: number; text: string; createdBy: string; createdDate: string }[]
  pullRequests?: {
    id: number
    title: string
    status: string
    webUrl: string
    repository: string
  }[]
}

interface BoardColumn {
  id: string
  name: string
  stateMappings: Record<string, string>
}

interface Sprint {
  id: string
  name: string
  path: string
  timeFrame: string
}

interface AdoConfig {
  found: boolean
  connected: boolean
  config: Record<string, unknown>
}

interface BoardState {
  view: "board" | "detail"
  selectedItemId: number | null
  selectedTab: "details" | "history" | "prs"
  additionalContext: string
  selectedSprintId: string | null
  childrenExpanded: boolean
}

function stripHtml(html: string): string {
  if (!html) return ""
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function typeBorderColor(type: string): string {
  switch (type.toLowerCase()) {
    case "bug": return "border-l-red-500"
    case "task": return "border-l-blue-500"
    case "user story": return "border-l-green-500"
    case "feature": return "border-l-purple-500"
    case "epic": return "border-l-orange-500"
    default: return "border-l-gray-500"
  }
}

function typeColor(type: string): string {
  switch (type.toLowerCase()) {
    case "bug":
      return "bg-red-500"
    case "task":
      return "bg-blue-500"
    case "user story":
      return "bg-green-500"
    case "feature":
      return "bg-purple-500"
    case "epic":
      return "bg-orange-500"
    default:
      return "bg-gray-500"
  }
}

function typeTextColor(type: string): string {
  switch (type.toLowerCase()) {
    case "bug":
      return "text-red-400"
    case "task":
      return "text-blue-400"
    case "user story":
      return "text-green-400"
    case "feature":
      return "text-purple-400"
    case "epic":
      return "text-orange-400"
    default:
      return "text-gray-400"
  }
}

function priorityColor(priority: number): string {
  switch (priority) {
    case 1:
      return "bg-red-500"
    case 2:
      return "bg-orange-500"
    case 3:
      return "bg-yellow-500"
    default:
      return "bg-gray-500"
  }
}

function stateColor(state: string): string {
  const s = state.toLowerCase()
  if (s === "done" || s === "closed" || s === "resolved") return "bg-green-600 text-green-100"
  if (s === "active" || s === "in progress" || s === "committed") return "bg-blue-600 text-blue-100"
  if (s === "new" || s === "proposed" || s === "to do") return "bg-gray-600 text-gray-100"
  return "bg-gray-600 text-gray-100"
}

function buildPrompt(item: WorkItem, additionalContext: string): string {
  const childLines =
    item.children && item.children.length > 0
      ? item.children.map((c) => `- [${c.state}] ${c.title}`).join("\n")
      : "None"

  return `Implement the following Azure DevOps work item:

## Work Item #${item.id}: ${item.title}
**Type:** ${item.type}
**Priority:** P${item.priority}
**Story Points:** ${item.storyPoints || "N/A"}

## Description
${stripHtml(item.description)}

## Acceptance Criteria
${stripHtml(item.acceptanceCriteria)}

## Child Tasks
${childLines}

## Additional Context
${additionalContext}`
}

export default function BoardPage() {
  const params = useParams<{ dir: string }>()
  const navigate = useNavigate()
  const server = useServer()

  const [state, setState] = createStore<BoardState>({
    view: "board",
    selectedItemId: null,
    selectedTab: "details",
    additionalContext: "",
    selectedSprintId: null,
    childrenExpanded: true,
  })

  const baseUrl = createMemo(() => server.current?.http?.url)

  function apiHeaders(): HeadersInit {
    const conn = server.current?.http
    if (conn?.username && conn?.password) {
      return {
        Authorization: `Basic ${btoa(`${conn.username}:${conn.password}`)}`,
        "Content-Type": "application/json",
      }
    }
    return { "Content-Type": "application/json" }
  }

  async function apiFetch<T>(path: string): Promise<T> {
    const url = baseUrl()
    if (!url) throw new Error("No server URL")
    const sep = path.includes("?") ? "&" : "?"
    const res = await fetch(`${url}${path}${sep}dir=${encodeURIComponent(atob(params.dir))}`, {
      headers: apiHeaders(),
    })
    if (!res.ok) throw new Error(`API error: ${res.status}`)
    return res.json()
  }

  const [config] = createResource(
    () => baseUrl(),
    () => apiFetch<AdoConfig>("/api/ado/config"),
  )

  const [sprints] = createResource(
    () => config()?.connected,
    (connected) => {
      if (!connected) return []
      return apiFetch<Sprint[]>("/api/ado/sprints")
    },
  )

  createEffect(
    on(
      () => sprints(),
      (list) => {
        if (!list || list.length === 0) return
        if (state.selectedSprintId) return
        const current = list.find((s) => s.timeFrame === "current") ?? list[list.length - 1]
        setState("selectedSprintId", current.id)
      },
    ),
  )

  const [columns] = createResource(
    () => config()?.connected,
    (connected) => {
      if (!connected) return []
      return apiFetch<BoardColumn[]>("/api/ado/board/columns")
    },
  )

  const [items] = createResource(
    () => {
      const sprint = sprints()?.find((s) => s.id === state.selectedSprintId)
      if (!sprint || !config()?.connected) return null
      return sprint
    },
    (sprint) => apiFetch<WorkItem[]>(`/api/ado/sprints/${sprint.id}/items?path=${encodeURIComponent(sprint.path)}`),
  )

  const [detailItem] = createResource(
    () => (state.view === "detail" ? state.selectedItemId : null),
    (id) => {
      if (!id) return null
      return apiFetch<WorkItem>(`/api/ado/items/${id}`)
    },
  )

  const columnItems = createMemo(() => {
    const cols = columns() ?? []
    const allItems = items() ?? []
    const map = new Map<string, WorkItem[]>()
    for (const col of cols) {
      map.set(col.name, [])
    }
    for (const item of allItems) {
      for (const col of cols) {
        const mappedStates = Object.values(col.stateMappings).map((s) => s.toLowerCase())
        if (mappedStates.includes(item.state.toLowerCase())) {
          map.get(col.name)!.push(item)
          break
        }
      }
    }
    return map
  })

  function openDetail(id: number) {
    setState({
      view: "detail",
      selectedItemId: id,
      selectedTab: "details",
      additionalContext: "",
    })
  }

  function closeDetail() {
    setState({
      view: "board",
      selectedItemId: null,
    })
  }

  function assignToAgent() {
    const item = detailItem()
    if (!item) return
    const base = server.current?.http.url || ""
    const headers: Record<string, string> = { "Content-Type": "application/json" }
    const http = server.current?.http
    if (http?.password) headers["Authorization"] = `Basic ${btoa(`${http.username ?? "opencode"}:${http.password}`)}`

    fetch(`${base}/api/pipeline/start`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        directory: atob(params.dir),
        storyTitle: `${item.type} #${item.id}: ${item.title}`,
        storyId: String(item.id),
        workflowId: "orchestrator",
        mode: "full",
        story: {
          id: item.id,
          type: item.type,
          title: item.title,
          description: item.description,
          acceptanceCriteria: item.acceptanceCriteria,
          comments: item.comments?.map((c) => ({
            text: c.text,
            createdBy: c.createdBy,
            createdDate: c.createdDate,
          })),
          additionalContext: state.additionalContext,
        },
      }),
    }).then(() => {
      navigate(`/${params.dir}/dashboard`)
    })
  }

  return (
    <div class="relative flex h-full w-full flex-col bg-surface-base">
      {/* Permanent opaque backdrop — prevents parent splash (C logo) from bleeding through during data refetches or route transitions */}
      <div class="pointer-events-none absolute inset-0 bg-surface-base" aria-hidden="true" />
      <div class="relative flex h-full w-full flex-col">
      <Show
        when={config.loading}
        fallback={
          <Show
            when={config()?.connected}
            fallback={
              <div class="flex h-full items-center justify-center bg-surface-base">
                <div class="text-center">
                  <div class="text-text-weak text-lg">Azure DevOps not connected</div>
                  <div class="text-text-weak mt-2 text-sm">
                    Configure Azure DevOps in team settings first.
                  </div>
                </div>
              </div>
            }
          >
            <Switch>
              <Match when={state.view === "board"}>
                <BoardView
                  sprints={sprints() ?? []}
                  selectedSprintId={state.selectedSprintId}
                  onSprintChange={(id) => setState("selectedSprintId", id)}
                  columns={columns() ?? []}
                  columnItems={columnItems()}
                  loading={items.loading}
                  onCardClick={openDetail}
                />
              </Match>
              <Match when={state.view === "detail"}>
                <Show when={detailItem()} fallback={<div class="flex h-full w-full items-center justify-center bg-surface-base text-text-weak">Loading...</div>}>
                  {(item) => (
                    <DetailView
                      item={item()}
                      selectedTab={state.selectedTab}
                      onTabChange={(tab) => setState("selectedTab", tab)}
                      additionalContext={state.additionalContext}
                      onContextChange={(v) => setState("additionalContext", v)}
                      childrenExpanded={state.childrenExpanded}
                      onToggleChildren={() => setState("childrenExpanded", !state.childrenExpanded)}
                      onClose={closeDetail}
                      onAssign={assignToAgent}
                    />
                  )}
                </Show>
              </Match>
            </Switch>
          </Show>
        }
      >
        <div class="flex h-full w-full items-center justify-center bg-surface-base text-text-weak">Loading...</div>
      </Show>
      </div>
    </div>
  )
}

function BoardView(props: {
  sprints: Sprint[]
  selectedSprintId: string | null
  onSprintChange: (id: string) => void
  columns: BoardColumn[]
  columnItems: Map<string, WorkItem[]>
  loading: boolean
  onCardClick: (id: number) => void
}) {
  return (
    <div class="flex h-full flex-col">
      {/* Top bar */}
      <div class="border-border-base bg-surface-raised-base/30 flex items-center gap-3 border-b px-4 py-3">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" class="text-brand-base">
          <rect x="1" y="1" width="14" height="14" rx="2" stroke="currentColor" stroke-width="1.2" fill="none" />
          <rect x="3" y="4" width="3" height="8" rx="0.5" fill="currentColor" opacity="0.6" />
          <rect x="7" y="6" width="3" height="6" rx="0.5" fill="currentColor" opacity="0.4" />
          <rect x="11" y="3" width="2" height="9" rx="0.5" fill="currentColor" opacity="0.8" />
        </svg>
        <h2 class="text-text-strong text-sm font-semibold">Azure Board</h2>
        <select
          class="bg-surface-raised-base border-border-base text-text-base rounded border px-2 py-1 text-xs"
          value={props.selectedSprintId ?? ""}
          onChange={(e) => props.onSprintChange(e.currentTarget.value)}
        >
          <For each={props.sprints}>
            {(sprint) => (
              <option value={sprint.id}>
                {sprint.name}
                {sprint.timeFrame === "current" ? " (Current)" : ""}
              </option>
            )}
          </For>
        </select>
        <Show when={props.loading}>
          <span class="text-text-weak text-xs">Loading items...</span>
        </Show>
      </div>

      {/* Columns */}
      <div class="flex flex-1 gap-3 overflow-x-auto p-4">
        <For each={props.columns}>
          {(col) => {
            const colItems = createMemo(() => props.columnItems.get(col.name) ?? [])
            return (
              <div class="border-border-base bg-surface-raised-base/50 flex w-64 min-w-[16rem] flex-col rounded-lg border shadow-sm">
                <div class="border-border-base bg-surface-raised-base flex items-center justify-between rounded-t-lg border-b px-3 py-2.5">
                  <span class="text-text-strong text-xs font-semibold">{col.name}</span>
                  <span class="bg-surface-base text-text-weak rounded-full px-2 py-0.5 text-[10px] font-medium">
                    {colItems().length}
                  </span>
                </div>
                <div class="flex-1 space-y-2 overflow-y-auto p-2">
                  <For each={colItems()}>
                    {(item) => (
                      <button
                        class={`${typeBorderColor(item.type)} bg-surface-raised-base border-border-base hover:border-brand-base hover:shadow-md w-full cursor-pointer rounded-md border border-l-[3px] p-3 text-left transition-all duration-150`}
                        onClick={() => props.onCardClick(item.id)}
                      >
                        <div class="mb-1.5 flex items-center gap-1.5">
                          <span class={`${typeColor(item.type)} inline-block h-2.5 w-2.5 rounded-sm`} />
                          <span class={`${typeTextColor(item.type)} text-[10px] font-medium`}>
                            {item.type}
                          </span>
                          <span class="text-text-weak text-[10px]">#{item.id}</span>
                        </div>
                        <div class="text-text-strong mb-2 line-clamp-2 text-xs leading-snug">
                          {item.title}
                        </div>
                        <div class="flex items-center justify-between">
                          <div class="flex items-center gap-2">
                            <Show when={item.assignedTo}>
                              <span class="text-text-weak max-w-[8rem] truncate text-[10px]">
                                {item.assignedTo}
                              </span>
                            </Show>
                          </div>
                          <div class="flex items-center gap-1.5">
                            <Show when={item.storyPoints != null}>
                              <span class="bg-surface-base text-text-weak rounded px-1 py-0.5 text-[10px]">
                                {item.storyPoints}
                              </span>
                            </Show>
                            <span class={`${priorityColor(item.priority)} h-2 w-2 rounded-full`} />
                          </div>
                        </div>
                      </button>
                    )}
                  </For>
                </div>
              </div>
            )
          }}
        </For>
      </div>
    </div>
  )
}

function DetailView(props: {
  item: WorkItem
  selectedTab: "details" | "history" | "prs"
  onTabChange: (tab: "details" | "history" | "prs") => void
  additionalContext: string
  onContextChange: (v: string) => void
  childrenExpanded: boolean
  onToggleChildren: () => void
  onClose: () => void
  onAssign: () => void
}) {
  const tabs: { key: "details" | "history" | "prs"; label: string }[] = [
    { key: "details", label: "Details" },
    { key: "history", label: "History" },
    { key: "prs", label: "PRs" },
  ]

  return (
    <div class="flex h-full flex-col">
      {/* Header */}
      <div class="border-border-base bg-surface-raised-base/30 flex items-center gap-3 border-b px-4 py-3">
        <button
          class="text-text-weak hover:text-text-strong hover:bg-surface-raised-base flex h-7 w-7 items-center justify-center rounded-md text-sm transition-colors"
          onClick={props.onClose}
          title="Back to board"
        >
          ←
        </button>
        <div class={`${typeBorderColor(props.item.type)} border-l-[3px] pl-2 flex items-center gap-2`}>
          <span class={`${typeTextColor(props.item.type)} text-xs font-medium`}>
            {props.item.type}
          </span>
          <span class="text-text-weak text-xs">#{props.item.id}</span>
        </div>
        <span class={`${stateColor(props.item.state)} rounded px-2 py-0.5 text-[10px] font-medium`}>
          {props.item.state}
        </span>
        <Show when={props.item.url}>
          <a
            href={props.item.url}
            target="_blank"
            rel="noopener noreferrer"
            class="text-brand-base ml-auto text-xs hover:underline"
          >
            Open in ADO
          </a>
        </Show>
      </div>

      {/* Body */}
      <div class="flex flex-1 overflow-hidden">
        {/* Left side 60% */}
        <div class="flex w-3/5 flex-col overflow-y-auto p-4">
          <h1 class="text-text-strong mb-4 text-lg font-semibold">{props.item.title}</h1>

          {/* Tabs */}
          <div class="border-border-base mb-4 flex gap-1 border-b">
            <For each={tabs}>
              {(tab) => (
                <button
                  class={`px-3 py-1.5 text-xs font-medium transition-colors ${
                    props.selectedTab === tab.key
                      ? "text-brand-base border-brand-base border-b-2"
                      : "text-text-weak hover:text-text-base"
                  }`}
                  onClick={() => props.onTabChange(tab.key)}
                >
                  {tab.label}
                </button>
              )}
            </For>
          </div>

          <Switch>
            <Match when={props.selectedTab === "details"}>
              <div class="space-y-4">
                <Show when={props.item.description}>
                  <div>
                    <h3 class="text-text-base mb-1 text-xs font-semibold uppercase tracking-wider">
                      Description
                    </h3>
                    <div
                      class="text-text-base prose prose-invert prose-sm max-w-none text-sm"
                      innerHTML={props.item.description}
                    />
                  </div>
                </Show>

                <Show when={props.item.acceptanceCriteria}>
                  <div>
                    <h3 class="text-text-base mb-1 text-xs font-semibold uppercase tracking-wider">
                      Acceptance Criteria
                    </h3>
                    <div
                      class="text-text-base prose prose-invert prose-sm max-w-none text-sm"
                      innerHTML={props.item.acceptanceCriteria}
                    />
                  </div>
                </Show>

                <Show when={props.item.children && props.item.children.length > 0}>
                  <div>
                    <button
                      class="text-text-base mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wider"
                      onClick={props.onToggleChildren}
                    >
                      <span class="text-[10px]">{props.childrenExpanded ? "▼" : "▶"}</span>
                      Child Tasks ({props.item.children!.length})
                    </button>
                    <Show when={props.childrenExpanded}>
                      <div class="space-y-1">
                        <For each={props.item.children}>
                          {(child) => (
                            <div class="border-border-base flex items-center gap-2 rounded border px-3 py-1.5">
                              <span class={`${typeColor(child.type)} h-2 w-2 rounded-sm`} />
                              <span class={`${stateColor(child.state)} rounded px-1.5 py-0.5 text-[10px]`}>
                                {child.state}
                              </span>
                              <span class="text-text-base text-xs">{child.title}</span>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>
                </Show>
              </div>
            </Match>

            <Match when={props.selectedTab === "history"}>
              <div class="space-y-3">
                <Show
                  when={props.item.comments && props.item.comments.length > 0}
                  fallback={<div class="text-text-weak text-sm">No comments.</div>}
                >
                  <For each={props.item.comments}>
                    {(comment) => (
                      <div class="border-border-base rounded border p-3">
                        <div class="mb-1 flex items-center justify-between">
                          <span class="text-text-strong text-xs font-medium">{comment.createdBy}</span>
                          <span class="text-text-weak text-[10px]">
                            {new Date(comment.createdDate).toLocaleDateString()}
                          </span>
                        </div>
                        <div class="text-text-base prose prose-invert prose-sm max-w-none text-xs" innerHTML={comment.text} />
                      </div>
                    )}
                  </For>
                </Show>
              </div>
            </Match>

            <Match when={props.selectedTab === "prs"}>
              <div class="space-y-2">
                <Show
                  when={props.item.pullRequests && props.item.pullRequests.length > 0}
                  fallback={<div class="text-text-weak text-sm">No linked pull requests.</div>}
                >
                  <For each={props.item.pullRequests}>
                    {(pr) => (
                      <a
                        href={pr.webUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="border-border-base hover:border-brand-base flex items-center gap-3 rounded border p-3 transition-colors"
                      >
                        <span
                          class={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                            pr.status === "completed"
                              ? "bg-green-600 text-green-100"
                              : pr.status === "active"
                                ? "bg-blue-600 text-blue-100"
                                : "bg-gray-600 text-gray-100"
                          }`}
                        >
                          {pr.status}
                        </span>
                        <div class="min-w-0 flex-1">
                          <div class="text-text-strong truncate text-xs">{pr.title}</div>
                          <div class="text-text-weak text-[10px]">{pr.repository}</div>
                        </div>
                      </a>
                    )}
                  </For>
                </Show>
              </div>
            </Match>
          </Switch>
        </div>

        {/* Right side 40% */}
        <div class="border-border-base flex w-2/5 flex-col overflow-y-auto border-l p-4">
          {/* Metadata */}
          <div class="bg-surface-raised-base/30 mb-4 divide-y divide-border-base rounded-lg border border-border-base">
            <div class="px-3 py-2"><MetadataRow label="Assigned To" value={props.item.assignedTo ?? "Unassigned"} /></div>
            <div class="px-3 py-2"><MetadataRow label="State" value={props.item.state} /></div>
            <div class="px-3 py-2"><MetadataRow label="Priority" value={`P${props.item.priority}`} /></div>
            <div class="px-3 py-2">
              <MetadataRow
                label="Story Points"
                value={props.item.storyPoints != null ? String(props.item.storyPoints) : "—"}
              />
            </div>
            <div class="px-3 py-2"><MetadataRow label="Iteration" value={props.item.iterationPath} /></div>
            <div class="px-3 py-2"><MetadataRow label="Area Path" value={props.item.areaPath} /></div>
          </div>

          <Show when={props.item.tags}>
            <div class="mb-4">
              <div class="text-text-weak mb-1.5 text-[10px] font-medium uppercase tracking-wider">
                Tags
              </div>
              <div class="flex flex-wrap gap-1">
                <For each={props.item.tags.split(";").map((t) => t.trim()).filter(Boolean)}>
                  {(tag) => (
                    <span class="bg-surface-raised-base border-border-base text-text-base rounded-full border px-2 py-0.5 text-[10px]">
                      {tag}
                    </span>
                  )}
                </For>
              </div>
            </div>
          </Show>

          {/* Additional Context */}
          <div class="mb-4">
            <label class="text-text-base mb-1.5 block text-xs font-semibold">Additional Context</label>
            <textarea
              class="bg-surface-base border-border-base text-text-base focus:border-brand-base focus:ring-1 focus:ring-brand-base/20 w-full rounded-lg border p-2.5 text-xs outline-none transition-colors"
              rows={6}
              placeholder="Add instructions, context, or notes for the orchestrator..."
              value={props.additionalContext}
              onInput={(e) => props.onContextChange(e.currentTarget.value)}
            />
          </div>

          {/* Start with Orchestrator */}
          <button
            class="bg-brand-base hover:bg-brand-base/80 flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-all duration-150 hover:shadow-md"
            onClick={props.onAssign}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 3" />
            </svg>
            Start with Orchestrator
          </button>
        </div>
      </div>
    </div>
  )
}

function MetadataRow(props: { label: string; value: string }) {
  return (
    <div>
      <div class="text-text-weak text-[10px] font-medium uppercase tracking-wider">{props.label}</div>
      <div class="text-text-base text-xs">{props.value}</div>
    </div>
  )
}
