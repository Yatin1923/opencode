import { createStore } from "solid-js/store"
import { createMemo, createSignal, For, onMount, Show } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useServer } from "@/context/server"

// ============ Types ============

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
  url: string
  prCount: number
  iterationPath: string
  areaPath: string
  children?: WorkItem[]
  comments?: { id: number; text: string; createdBy: string; createdDate: string }[]
  pullRequests?: { id: number; title: string; status: string; webUrl: string; repository: string }[]
}

interface Sprint {
  id: string
  name: string
  path: string
  timeFrame: string
  startDate: string | null
  finishDate: string | null
}

interface BoardColumn {
  id: string
  name: string
  stateMappings: Record<string, string>
}

interface AdoState {
  pat: string
  connected: boolean
  connecting: boolean
  error: string
  sprints: Sprint[]
  selectedSprintId: string
  columns: BoardColumn[]
  items: WorkItem[]
  loading: boolean
  selectedItem: WorkItem | null
  detailLoading: boolean
}

// ============ Helpers ============

function priorityColor(p: number) {
  if (p === 1) return "#ef4444"
  if (p === 2) return "#f97316"
  if (p === 3) return "#eab308"
  return "#6b7280"
}

function typeColor(type: string) {
  if (type === "Bug") return "#ef4444"
  if (type === "Task") return "#3b82f6"
  if (type === "User Story") return "#22c55e"
  if (type === "Feature") return "#a855f7"
  if (type === "Epic") return "#f97316"
  return "#6b7280"
}

function stateColor(state: string) {
  if (state === "Closed" || state === "Done" || state === "Resolved") return "#22c55e"
  if (state === "Active" || state === "Committed") return "#3b82f6"
  if (state === "New" || state === "Proposed") return "#6b7280"
  if (state === "Removed") return "#ef4444"
  return "#6b7280"
}

// ============ Main Dialog ============

export function DialogAdo(props: { dir: string }) {
  const server = useServer()
  const dialog = useDialog()

  const authHeaders = (): Record<string, string> => {
    const headers: Record<string, string> = { "Content-Type": "application/json" }
    const http = server.current?.http
    if (http?.password) headers["Authorization"] = `Basic ${btoa(`${http.username ?? "opencode"}:${http.password}`)}`
    return headers
  }

  async function adoFetch(path: string, options?: { method?: string; body?: unknown }) {
    const base = server.current?.http?.url || ""
    const url = new URL(`/api/ado${path}`, base)
    url.searchParams.set("dir", props.dir)
    const res = await fetch(url.toString(), {
      method: options?.method || "GET",
      headers: authHeaders(),
      body: options?.body ? JSON.stringify(options.body) : undefined,
    })
    return res.json()
  }

  const [state, setState] = createStore<AdoState>({
    pat: "",
    connected: false,
    connecting: false,
    error: "",
    sprints: [],
    selectedSprintId: "",
    columns: [],
    items: [],
    loading: false,
    selectedItem: null,
    detailLoading: false,
  })

  // Load config + check connection on mount
  onMount(async () => {
    try {
      const data = await adoFetch("/config")
      if (data.config?.pat) setState("pat", data.config.pat)
      if (data.connected) {
        setState("connected", true)
        loadBoard()
      }
    } catch (_) {}
  })

  async function handleConnect() {
    if (!state.pat.trim()) return
    setState("connecting", true)
    setState("error", "")
    try {
      const result = await adoFetch("/settings", {
        method: "PUT",
        body: { pat: state.pat },
      })
      if (result.success) {
        // Test connection
        const status = await adoFetch("/status")
        if (status.connected) {
          setState("connected", true)
          setState("error", "")
          loadBoard()
        } else {
          setState("error", status.reason || "Connection failed")
        }
      } else {
        setState("error", result.error || "Failed to save")
      }
    } catch (e: any) {
      setState("error", e.message || "Network error")
    } finally {
      setState("connecting", false)
    }
  }

  async function loadBoard() {
    setState("loading", true)
    try {
      // Load sprints + columns in parallel
      const [sprintsData, columnsData] = await Promise.all([
        adoFetch("/sprints"),
        adoFetch("/board/columns"),
      ])

      if (Array.isArray(sprintsData)) setState("sprints", sprintsData)
      if (Array.isArray(columnsData)) setState("columns", columnsData)

      // Select current sprint
      const current = (state.sprints as Sprint[]).find((s) => s.timeFrame === "current")
      const sprintId = current?.id || state.sprints[0]?.id || ""
      if (sprintId) {
        setState("selectedSprintId", sprintId)
        await loadSprintItems(sprintId)
      }
    } catch (_) {
    } finally {
      setState("loading", false)
    }
  }

  async function loadSprintItems(sprintId: string) {
    setState("loading", true)
    try {
      const sprint = (state.sprints as Sprint[]).find((s) => s.id === sprintId)
      const pathParam = sprint?.path ? `&path=${encodeURIComponent(sprint.path)}` : ""
      const data = await adoFetch(`/sprints/${sprintId}/items?_=1${pathParam}`)
      if (Array.isArray(data)) setState("items", data)
    } catch (_) {
    } finally {
      setState("loading", false)
    }
  }

  async function selectItem(id: number) {
    setState("detailLoading", true)
    try {
      const data = await adoFetch(`/items/${id}`)
      if (data.id) setState("selectedItem", data)
    } catch (_) {
    } finally {
      setState("detailLoading", false)
    }
  }

  function handleSprintChange(id: string) {
    setState("selectedSprintId", id)
    loadSprintItems(id)
  }

  // Group items into columns by state
  const columnItems = createMemo(() => {
    const cols = state.columns as BoardColumn[]
    const items = state.items as WorkItem[]
    if (cols.length === 0) return []

    return cols.map((col) => {
      // stateMappings maps work item type → state name for this column
      const stateNames = new Set(Object.values(col.stateMappings || {}))
      const colItems = stateNames.size > 0
        ? items.filter((i) => stateNames.has(i.state))
        : items.filter((i) => i.state === col.name)
      return { ...col, items: colItems }
    })
  })

  // ============ Render ============

  return (
    <Dialog size="full" transition>
      <div class="flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div class="shrink-0 border-b border-border-base px-5 py-3 flex items-center justify-between bg-surface-base">
          <div class="flex items-center gap-3">
            <div class="flex items-center gap-2">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <rect width="20" height="20" rx="4" fill="#0078d4" />
                <path d="M4 8l3-3h6l3 3v6l-3 3H7l-3-3V8z" fill="white" fill-opacity="0.9" />
              </svg>
              <h2 class="text-15-medium text-text-strong">Azure DevOps Board</h2>
            </div>
            <Show when={state.connected}>
              <div class="w-2 h-2 rounded-full bg-icon-success-base" />
            </Show>
          </div>
          <div class="flex items-center gap-3">
            <Show when={state.connected && state.sprints.length > 0}>
              <select
                value={state.selectedSprintId}
                onChange={(e) => handleSprintChange(e.currentTarget.value)}
                class="px-3 py-1.5 rounded-md border border-border-base bg-surface-raised-base text-text-strong text-13-regular focus:outline-none focus:border-brand-base transition-colors"
              >
                <For each={state.sprints}>
                  {(sprint) => (
                    <option value={sprint.id}>
                      {sprint.name}{sprint.timeFrame === "current" ? " (current)" : ""}
                    </option>
                  )}
                </For>
              </select>
            </Show>
            <Button variant="ghost" size="small" onClick={() => dialog.close()}>
              Close
            </Button>
          </div>
        </div>

        {/* Content */}
        <Show when={!state.connected}>
          <div class="flex-1 flex items-center justify-center">
            <div class="w-full max-w-md p-8 flex flex-col gap-5">
              <div class="text-center">
                <h3 class="text-16-medium text-text-strong mb-2">Connect to Azure DevOps</h3>
                <p class="text-13-regular text-text-weak">
                  Your organization and project are detected from team config. Enter your Personal Access Token to connect.
                </p>
              </div>

              <label class="flex flex-col gap-1.5">
                <span class="text-12-medium text-text-base">Personal Access Token</span>
                <input
                  type="password"
                  value={state.pat}
                  onInput={(e) => setState("pat", e.currentTarget.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleConnect()}
                  placeholder="Enter your PAT..."
                  class="px-3 py-2.5 rounded-lg border border-border-base bg-surface-base text-text-strong text-13-regular focus:outline-none focus:border-brand-base focus:ring-1 focus:ring-brand-base transition-colors font-mono"
                />
                <span class="text-11-regular text-text-weak">
                  Requires scopes: Work Items (Read/Write), Code (Read/Write), Board (Read)
                </span>
              </label>

              <Show when={state.error}>
                <div class="flex items-center gap-2 px-3 py-2 rounded-lg border border-icon-critical-base/30 bg-icon-critical-base/5">
                  <div class="w-2 h-2 rounded-full bg-icon-critical-base" />
                  <span class="text-12-regular text-icon-critical-base">{state.error}</span>
                </div>
              </Show>

              <Button
                onClick={handleConnect}
                disabled={!state.pat.trim() || state.connecting}
              >
                {state.connecting ? "Connecting..." : "Connect"}
              </Button>
            </div>
          </div>
        </Show>

        <Show when={state.connected}>
          <div class="flex-1 flex min-h-0 overflow-hidden">
            {/* Board */}
            <div class="flex-1 flex overflow-x-auto p-4 gap-3" classList={{ "pr-[380px]": !!state.selectedItem }}>
              <Show when={state.loading}>
                <div class="flex-1 flex items-center justify-center">
                  <div class="w-8 h-8 rounded-full border-2 border-brand-base border-t-transparent animate-spin" />
                </div>
              </Show>

              <Show when={!state.loading}>
                <For each={columnItems()}>
                  {(column) => (
                    <div class="flex flex-col min-w-[260px] max-w-[300px] flex-shrink-0">
                      {/* Column header */}
                      <div class="flex items-center justify-between px-3 py-2 mb-2 rounded-md bg-surface-raised-base border border-border-base">
                        <span class="text-12-medium text-text-strong">{column.name}</span>
                        <span class="text-11-regular text-text-weak bg-surface-base px-1.5 py-0.5 rounded font-mono">
                          {column.items.length}
                        </span>
                      </div>

                      {/* Cards */}
                      <div class="flex flex-col gap-2 overflow-y-auto flex-1 pr-1">
                        <For each={column.items}>
                          {(item) => (
                            <div
                              class="relative p-3 rounded-lg border bg-surface-base hover:bg-surface-raised-base transition-colors cursor-pointer group"
                              style={{ "border-left": `3px solid ${typeColor(item.type)}` }}
                              classList={{
                                "border-border-base": state.selectedItem?.id !== item.id,
                                "border-brand-base bg-brand-base/5": state.selectedItem?.id === item.id,
                              }}
                              onClick={() => selectItem(item.id)}
                            >
                              {/* Type + ID row */}
                              <div class="flex items-center gap-1.5 mb-1">
                                <span
                                  class="text-10-regular font-mono px-1 py-0.5 rounded"
                                  style={{ background: `${typeColor(item.type)}20`, color: typeColor(item.type) }}
                                >
                                  {item.type === "User Story" ? "Story" : item.type}
                                </span>
                                <span class="text-11-regular text-text-weak font-mono">#{item.id}</span>
                                <Show when={item.prCount > 0}>
                                  <span class="text-10-regular text-text-weak ml-auto">PR:{item.prCount}</span>
                                </Show>
                              </div>

                              {/* Title */}
                              <p class="text-12-medium text-text-strong line-clamp-2 mb-1.5">{item.title}</p>

                              {/* Bottom row */}
                              <div class="flex items-center gap-2">
                                <Show when={item.assignedTo}>
                                  <span class="text-10-regular text-text-weak truncate max-w-[120px]">{item.assignedTo}</span>
                                </Show>
                                <div class="ml-auto flex items-center gap-1.5">
                                  <Show when={item.storyPoints}>
                                    <span class="text-10-regular text-text-weak bg-surface-raised-base px-1 rounded font-mono">
                                      {item.storyPoints}pt
                                    </span>
                                  </Show>
                                  <div
                                    class="w-2.5 h-2.5 rounded-sm"
                                    style={{ background: priorityColor(item.priority) }}
                                    title={`Priority ${item.priority}`}
                                  />
                                </div>
                              </div>
                            </div>
                          )}
                        </For>

                        <Show when={column.items.length === 0}>
                          <div class="py-8 text-center text-11-regular text-text-weak border border-dashed border-border-base rounded-lg">
                            No items
                          </div>
                        </Show>
                      </div>
                    </div>
                  )}
                </For>

                <Show when={columnItems().length === 0 && !state.loading}>
                  <div class="flex-1 flex items-center justify-center">
                    <div class="text-center text-text-weak">
                      <p class="text-14-medium mb-1">No board data</p>
                      <p class="text-12-regular">Check your ADO configuration or select a different sprint.</p>
                    </div>
                  </div>
                </Show>
              </Show>
            </div>

            {/* Detail panel (slide in from right) */}
            <Show when={state.selectedItem}>
              <div class="absolute right-0 top-[53px] bottom-0 w-[400px] border-l border-border-base bg-surface-base overflow-y-auto shadow-xl z-10">
                <Show when={state.detailLoading}>
                  <div class="flex items-center justify-center h-full">
                    <div class="w-6 h-6 rounded-full border-2 border-brand-base border-t-transparent animate-spin" />
                  </div>
                </Show>
                <Show when={!state.detailLoading && state.selectedItem}>
                  {(() => {
                    const item = state.selectedItem!
                    return (
                      <div class="flex flex-col">
                        {/* Detail header */}
                        <div class="sticky top-0 bg-surface-base border-b border-border-base px-4 py-3 flex items-center justify-between z-10">
                          <div class="flex items-center gap-2">
                            <span
                              class="text-11-regular font-mono px-1.5 py-0.5 rounded"
                              style={{ background: `${typeColor(item.type)}20`, color: typeColor(item.type) }}
                            >
                              {item.type}
                            </span>
                            <span class="text-12-regular text-text-weak font-mono">#{item.id}</span>
                          </div>
                          <div class="flex items-center gap-2">
                            <Show when={item.url}>
                              <a
                                href={item.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                class="text-11-regular text-brand-base hover:underline"
                              >
                                Open in ADO
                              </a>
                            </Show>
                            <button
                              type="button"
                              onClick={() => setState("selectedItem", null)}
                              class="p-1 rounded hover:bg-surface-raised-base text-text-weak"
                            >
                              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                                <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
                              </svg>
                            </button>
                          </div>
                        </div>

                        {/* Title */}
                        <div class="px-4 py-3 border-b border-border-base">
                          <h3 class="text-14-medium text-text-strong leading-snug">{item.title}</h3>
                        </div>

                        {/* Metadata grid */}
                        <div class="px-4 py-3 border-b border-border-base grid grid-cols-2 gap-3">
                          <div>
                            <span class="text-10-regular text-text-weak block mb-0.5">State</span>
                            <span
                              class="text-12-medium px-1.5 py-0.5 rounded inline-block"
                              style={{ background: `${stateColor(item.state)}20`, color: stateColor(item.state) }}
                            >
                              {item.state}
                            </span>
                          </div>
                          <div>
                            <span class="text-10-regular text-text-weak block mb-0.5">Priority</span>
                            <div class="flex items-center gap-1.5">
                              <div class="w-3 h-3 rounded-sm" style={{ background: priorityColor(item.priority) }} />
                              <span class="text-12-regular text-text-base">P{item.priority}</span>
                            </div>
                          </div>
                          <div>
                            <span class="text-10-regular text-text-weak block mb-0.5">Assigned To</span>
                            <span class="text-12-regular text-text-base">{item.assignedTo || "Unassigned"}</span>
                          </div>
                          <div>
                            <span class="text-10-regular text-text-weak block mb-0.5">Story Points</span>
                            <span class="text-12-regular text-text-base">{item.storyPoints ?? "—"}</span>
                          </div>
                          <Show when={item.iterationPath}>
                            <div class="col-span-2">
                              <span class="text-10-regular text-text-weak block mb-0.5">Iteration</span>
                              <span class="text-12-regular text-text-base">{item.iterationPath}</span>
                            </div>
                          </Show>
                          <Show when={item.tags}>
                            <div class="col-span-2">
                              <span class="text-10-regular text-text-weak block mb-0.5">Tags</span>
                              <div class="flex flex-wrap gap-1">
                                <For each={item.tags.split(";").map((t) => t.trim()).filter(Boolean)}>
                                  {(tag) => (
                                    <span class="text-10-regular bg-surface-raised-base text-text-base px-1.5 py-0.5 rounded">{tag}</span>
                                  )}
                                </For>
                              </div>
                            </div>
                          </Show>
                        </div>

                        {/* Description */}
                        <Show when={item.description}>
                          <div class="px-4 py-3 border-b border-border-base">
                            <span class="text-11-medium text-text-weak block mb-1.5">Description</span>
                            <div class="text-12-regular text-text-base prose-sm max-h-[200px] overflow-y-auto" innerHTML={item.description} />
                          </div>
                        </Show>

                        {/* Acceptance Criteria */}
                        <Show when={item.acceptanceCriteria}>
                          <div class="px-4 py-3 border-b border-border-base">
                            <span class="text-11-medium text-text-weak block mb-1.5">Acceptance Criteria</span>
                            <div class="text-12-regular text-text-base prose-sm max-h-[200px] overflow-y-auto" innerHTML={item.acceptanceCriteria} />
                          </div>
                        </Show>

                        {/* Children */}
                        <Show when={item.children && item.children.length > 0}>
                          <div class="px-4 py-3 border-b border-border-base">
                            <span class="text-11-medium text-text-weak block mb-1.5">Child Items ({item.children!.length})</span>
                            <div class="flex flex-col gap-1">
                              <For each={item.children}>
                                {(child) => (
                                  <div class="flex items-center gap-2 py-1 px-2 rounded hover:bg-surface-raised-base text-12-regular">
                                    <div class="w-2 h-2 rounded-full" style={{ background: stateColor(child.state) }} />
                                    <span class="text-text-weak font-mono text-10-regular">#{child.id}</span>
                                    <span class="text-text-base truncate flex-1">{child.title}</span>
                                    <span class="text-text-weak text-10-regular">{child.state}</span>
                                  </div>
                                )}
                              </For>
                            </div>
                          </div>
                        </Show>

                        {/* Linked PRs */}
                        <Show when={item.pullRequests && item.pullRequests.length > 0}>
                          <div class="px-4 py-3 border-b border-border-base">
                            <span class="text-11-medium text-text-weak block mb-1.5">Pull Requests ({item.pullRequests!.length})</span>
                            <div class="flex flex-col gap-1.5">
                              <For each={item.pullRequests}>
                                {(pr) => (
                                  <a
                                    href={pr.webUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    class="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-surface-raised-base"
                                  >
                                    <div
                                      class="w-2 h-2 rounded-full"
                                      style={{ background: pr.status === "completed" ? "#22c55e" : pr.status === "active" ? "#3b82f6" : "#ef4444" }}
                                    />
                                    <span class="text-12-regular text-brand-base truncate">{pr.title}</span>
                                    <span class="text-10-regular text-text-weak ml-auto">{pr.status}</span>
                                  </a>
                                )}
                              </For>
                            </div>
                          </div>
                        </Show>

                        {/* Comments */}
                        <Show when={item.comments && item.comments.length > 0}>
                          <div class="px-4 py-3">
                            <span class="text-11-medium text-text-weak block mb-1.5">Comments ({item.comments!.length})</span>
                            <div class="flex flex-col gap-2">
                              <For each={item.comments}>
                                {(comment) => (
                                  <div class="py-1.5">
                                    <div class="flex items-center gap-2 mb-0.5">
                                      <span class="text-11-medium text-text-base">{comment.createdBy}</span>
                                      <span class="text-10-regular text-text-weak">
                                        {new Date(comment.createdDate).toLocaleDateString()}
                                      </span>
                                    </div>
                                    <div class="text-12-regular text-text-base" innerHTML={comment.text} />
                                  </div>
                                )}
                              </For>
                            </div>
                          </div>
                        </Show>

                        {/* Assign to Agent button */}
                        <div class="sticky bottom-0 bg-surface-base border-t border-border-base px-4 py-3">
                          <Button class="w-full" onClick={() => {/* TODO: assign to orchestrator */}}>
                            Assign to Agent
                          </Button>
                        </div>
                      </div>
                    )
                  })()}
                </Show>
              </div>
            </Show>
          </div>
        </Show>
      </div>
    </Dialog>
  )
}
