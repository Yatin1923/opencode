import { Hono } from "hono"
import * as fs from "node:fs"
import * as path from "node:path"
import { randomUUID } from "node:crypto"
import { url as serverUrl } from "../server"

/**
 * Pipeline API Routes
 * Multi-team workflow pipelines: Planner → Developer → Test → PR
 * Each stage invokes a team lead agent session, with optional members.
 */

// ============ Types ============

interface Team {
  id: string
  name: string
  lead: string
  members: string[]
  icon: string
}

interface Workflow {
  id: string
  name: string
  stages: string[]
  gates: Record<string, "manual" | "auto">
}

interface WorkflowConfig {
  teams: Team[]
  workflows: Workflow[]
  defaults: {
    workflow: string
    gates: Record<string, "manual" | "auto">
  }
}

interface HandoffFileRef {
  path: string
  purpose?: string
  lineStart?: number
  lineEnd?: number
  excerpt?: string
  truncated?: boolean
}

interface HandoffFileCreate {
  path: string
  purpose?: string
  skeleton?: string
  truncated?: boolean
}

interface HandoffFileChanged {
  path: string
  change: "added" | "modified" | "deleted"
  summary?: string
}

interface HandoffSymbolRef {
  path: string
  symbol: string
  lineStart: number
  lineEnd: number
  excerpt: string
  truncated?: boolean
}

interface StageHandoff {
  stage: "planner" | "developer" | "test" | "pr" | string
  summary: string
  approach?: string
  filesToModify?: HandoffFileRef[]
  filesToCreate?: HandoffFileCreate[]
  filesChanged?: HandoffFileChanged[]
  references?: HandoffSymbolRef[]
  steps?: string[]
  testing?: string
  testResults?: { passed: number; failed: number; failures?: string[] }
  risks?: string[]
  openQuestions?: string[]
}

interface StageState {
  teamId: string
  status: "pending" | "running" | "completed" | "waiting" | "skipped" | "failed"
  sessionId?: string
  startedAt?: string
  completedAt?: string
  output?: any
  question?: string
  handoff?: StageHandoff
  // For dynamic orchestrator-driven stages: id of the `task` tool part that spawned this stage.
  // Used to dedupe across polls and to look up the live status from the orchestrator session.
  partId?: string
  // Human-friendly label for dynamic stages (subagent task description).
  label?: string
}

interface StoryComment {
  text: string
  createdBy?: string
  createdDate?: string
}

interface StoryContext {
  id?: string | number
  type?: string
  title?: string
  description?: string
  acceptanceCriteria?: string
  comments?: StoryComment[]
  additionalContext?: string
}

interface PipelineInstance {
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
  story?: StoryContext
  // Schema version. Bumped when stage shape or workflow semantics change.
  // Pipelines without this field (or with a lower version) are treated as stale and removed on read.
  version?: number
}

/** Bump this when changing pipeline state shape or semantics. Stale pipelines are wiped on next read. */
const PIPELINE_STATE_VERSION = 2

// ============ Helpers ============

/** Strip HTML tags + decode common entities; collapse whitespace. ADO returns HTML for description/AC. */
function stripHtml(s: string | null | undefined): string {
  if (!s) return ""
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/** Normalize an incoming story payload — strip HTML on rich-text fields, clamp comments. */
function normalizeStory(raw: any): StoryContext | undefined {
  if (!raw || typeof raw !== "object") return undefined
  const out: StoryContext = {}
  if (raw.id !== undefined && raw.id !== null) out.id = raw.id
  if (typeof raw.type === "string" && raw.type) out.type = raw.type
  if (typeof raw.title === "string" && raw.title) out.title = raw.title
  const desc = stripHtml(raw.description)
  if (desc) out.description = desc
  const ac = stripHtml(raw.acceptanceCriteria)
  if (ac) out.acceptanceCriteria = ac
  const addl = typeof raw.additionalContext === "string" ? raw.additionalContext.trim() : ""
  if (addl) out.additionalContext = addl
  if (Array.isArray(raw.comments)) {
    const cs: StoryComment[] = raw.comments
      .filter((c: any) => c && typeof c.text === "string")
      .map((c: any) => ({
        text: stripHtml(c.text),
        createdBy: typeof c.createdBy === "string" ? c.createdBy : undefined,
        createdDate: typeof c.createdDate === "string" ? c.createdDate : undefined,
      }))
      .filter((c: StoryComment) => c.text.length > 0)
    if (cs.length > 0) out.comments = cs
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** Render a story context block for the planner prompt. Truncates to keep prompt size sane. */
function renderStoryContext(story: StoryContext): string {
  const COMMENT_LIMIT = 10
  const COMMENT_TEXT_CAP = 500
  const lines: string[] = ["## Story Context", ""]

  const headerBits: string[] = []
  if (story.type) headerBits.push(`**Type:** ${story.type}`)
  if (story.id !== undefined) headerBits.push(`**ID:** ${story.id}`)
  if (story.title) headerBits.push(`**Title:** ${story.title}`)
  if (headerBits.length > 0) {
    lines.push(headerBits.join("    "))
    lines.push("")
  }

  if (story.description) {
    lines.push("### Description", story.description, "")
  }
  if (story.acceptanceCriteria) {
    lines.push("### Acceptance Criteria", story.acceptanceCriteria, "")
  }
  if (story.comments && story.comments.length > 0) {
    const recent = story.comments.slice(-COMMENT_LIMIT)
    const omitted = story.comments.length - recent.length
    lines.push(`### Comments (${story.comments.length}${omitted > 0 ? `, showing last ${recent.length}` : ""})`)
    for (const c of recent) {
      const meta = [c.createdDate, c.createdBy].filter(Boolean).join(" · ")
      const text = c.text.length > COMMENT_TEXT_CAP ? c.text.slice(0, COMMENT_TEXT_CAP) + "…" : c.text
      lines.push(`- ${meta ? `[${meta}] ` : ""}${text}`)
    }
    lines.push("")
  }
  if (story.additionalContext) {
    lines.push("### Additional Context (from user)", story.additionalContext, "")
  }

  return lines.join("\n").trimEnd()
}



function workflowConfigPath(dir: string): string {
  return path.join(dir, ".opencode", "workflow.json")
}

function pipelinesDir(dir: string): string {
  return path.join(dir, ".opencode", "pipelines")
}

function loadWorkflowConfig(dir: string): WorkflowConfig | null {
  const p = workflowConfigPath(dir)
  if (!fs.existsSync(p)) return null
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"))
  } catch (_) {
    return null
  }
}

function saveWorkflowConfig(dir: string, config: WorkflowConfig) {
  const opencodeDir = path.join(dir, ".opencode")
  if (!fs.existsSync(opencodeDir)) fs.mkdirSync(opencodeDir, { recursive: true })
  fs.writeFileSync(workflowConfigPath(dir), JSON.stringify(config, null, 2))
}

function loadPipeline(dir: string, id: string): PipelineInstance | null {
  const p = path.join(pipelinesDir(dir), `${id}.json`)
  if (!fs.existsSync(p)) return null
  try {
    const parsed = JSON.parse(fs.readFileSync(p, "utf-8")) as PipelineInstance
    if ((parsed.version ?? 0) < PIPELINE_STATE_VERSION) {
      console.log(`[pipeline] loadPipeline: discarding stale pipeline ${id} (version=${parsed.version ?? 0} < ${PIPELINE_STATE_VERSION})`)
      try { fs.unlinkSync(p) } catch (_) {}
      return null
    }
    return parsed
  } catch (_) {
    return null
  }
}

function savePipeline(pipeline: PipelineInstance) {
  const dir = pipelinesDir(pipeline.directory)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${pipeline.id}.json`), JSON.stringify(pipeline, null, 2))
}

function listPipelines(dir: string): PipelineInstance[] {
  const d = pipelinesDir(dir)
  if (!fs.existsSync(d)) return []
  return fs.readdirSync(d)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const full = path.join(d, f)
      try {
        const parsed = JSON.parse(fs.readFileSync(full, "utf-8")) as PipelineInstance
        if ((parsed.version ?? 0) < PIPELINE_STATE_VERSION) {
          console.log(`[pipeline] listPipelines: discarding stale ${f} (version=${parsed.version ?? 0})`)
          try { fs.unlinkSync(full) } catch (_) {}
          return null
        }
        return parsed
      } catch (_) {
        return null
      }
    })
    .filter(Boolean) as PipelineInstance[]
}

function defaultWorkflowConfig(): WorkflowConfig {
  return {
    teams: [
      {
        id: "orchestrator",
        name: "Orchestrator",
        lead: "orchestrator.md",
        members: [
          "planner.md",
          "senior-developer.md",
          "developer-1.md",
          "developer-2.md",
          "test-engineer.md",
          "code-reviewer.md",
          "security-scanner.md",
          "db-agent.md",
          "infra-agent.md",
          "doc-agent.md",
          "refactor.md",
        ],
        icon: "compass",
      },
    ],
    workflows: [
      { id: "orchestrator", name: "Orchestrator", stages: ["orchestrator"], gates: {} },
    ],
    defaults: {
      workflow: "orchestrator",
      gates: {},
    },
  }
}

// ============ Session Integration ============

/** Resolve agent name from .md filename (strip .md extension) */
function agentNameFromFile(filename: string): string {
  return filename.replace(/\.md$/, "")
}

// ============ Handoff helpers ============

const MAX_LINES_PER_EXCERPT = 150
const MAX_HANDOFF_BYTES = 50 * 1024

/** Try to extract a structured handoff from an agent's final assistant message.
 * Looks for a fenced ```json handoff ... ``` block (also tolerates ```handoff). */
function extractHandoff(text: string | null | undefined): StageHandoff | null {
  if (!text) return null
  const patterns = [
    /```json\s+handoff\s*\n([\s\S]*?)```/i,
    /```handoff\s*\n([\s\S]*?)```/i,
    /```json:handoff\s*\n([\s\S]*?)```/i,
  ]
  for (const re of patterns) {
    const m = text.match(re)
    if (!m) continue
    try {
      const parsed = JSON.parse(m[1].trim())
      if (parsed && typeof parsed === "object" && typeof parsed.summary === "string") {
        return parsed as StageHandoff
      }
    } catch (err) {
      console.warn(`[pipeline] extractHandoff: JSON parse failed: ${err instanceof Error ? err.message : err}`)
    }
  }
  return null
}

function clampExcerpt(excerpt: string | undefined): { text: string; truncated: boolean } | undefined {
  if (!excerpt) return undefined
  const lines = excerpt.split("\n")
  if (lines.length <= MAX_LINES_PER_EXCERPT) return { text: excerpt, truncated: false }
  return {
    text: lines.slice(0, MAX_LINES_PER_EXCERPT).join("\n") + `\n... [truncated, ${lines.length - MAX_LINES_PER_EXCERPT} more lines]`,
    truncated: true,
  }
}

/** Apply per-excerpt and total-payload size caps. Drops `references` first if needed. */
function enforceHandoffCaps(handoff: StageHandoff): StageHandoff {
  const clamped: StageHandoff = { ...handoff }

  if (clamped.filesToModify) {
    clamped.filesToModify = clamped.filesToModify.map((f) => {
      const c = clampExcerpt(f.excerpt)
      return c ? { ...f, excerpt: c.text, truncated: c.truncated || f.truncated } : f
    })
  }
  if (clamped.filesToCreate) {
    clamped.filesToCreate = clamped.filesToCreate.map((f) => {
      const c = clampExcerpt(f.skeleton)
      return c ? { ...f, skeleton: c.text, truncated: c.truncated || f.truncated } : f
    })
  }
  if (clamped.references) {
    clamped.references = clamped.references.map((r) => {
      const c = clampExcerpt(r.excerpt)
      return c ? { ...r, excerpt: c.text ?? r.excerpt, truncated: c.truncated || r.truncated } : r
    })
  }

  // If still over total cap, drop references first, then filesToCreate skeletons
  let size = Buffer.byteLength(JSON.stringify(clamped), "utf-8")
  if (size > MAX_HANDOFF_BYTES && clamped.references && clamped.references.length > 0) {
    console.warn(`[pipeline] enforceHandoffCaps: dropping references (${size}B > ${MAX_HANDOFF_BYTES}B)`)
    clamped.references = []
    size = Buffer.byteLength(JSON.stringify(clamped), "utf-8")
  }
  if (size > MAX_HANDOFF_BYTES && clamped.filesToCreate) {
    clamped.filesToCreate = clamped.filesToCreate.map((f) => ({ ...f, skeleton: undefined, truncated: true }))
    size = Buffer.byteLength(JSON.stringify(clamped), "utf-8")
  }
  if (size > MAX_HANDOFF_BYTES && clamped.filesToModify) {
    clamped.filesToModify = clamped.filesToModify.map((f) => ({ ...f, excerpt: undefined, truncated: true }))
  }
  return clamped
}

/** Render a structured handoff as Markdown for downstream stages. */
function renderHandoffMarkdown(teamName: string, h: StageHandoff): string {
  const parts: string[] = []
  parts.push(`### ${teamName} Handoff`)
  parts.push(`\n**Summary**\n${h.summary}`)
  if (h.approach) parts.push(`\n**Approach**\n${h.approach}`)

  if (h.filesToModify && h.filesToModify.length > 0) {
    parts.push(`\n**Files to Modify**`)
    for (const f of h.filesToModify) {
      const range = f.lineStart && f.lineEnd ? ` (lines ${f.lineStart}-${f.lineEnd})` : ""
      parts.push(`- \`${f.path}\`${range}${f.purpose ? ` — ${f.purpose}` : ""}`)
      if (f.excerpt) parts.push("  ```\n" + f.excerpt.split("\n").map((l) => "  " + l).join("\n") + "\n  ```")
    }
  }

  if (h.filesToCreate && h.filesToCreate.length > 0) {
    parts.push(`\n**Files to Create**`)
    for (const f of h.filesToCreate) {
      parts.push(`- \`${f.path}\`${f.purpose ? ` — ${f.purpose}` : ""}`)
      if (f.skeleton) parts.push("  ```\n" + f.skeleton.split("\n").map((l) => "  " + l).join("\n") + "\n  ```")
    }
  }

  if (h.filesChanged && h.filesChanged.length > 0) {
    parts.push(`\n**Files Changed**`)
    for (const f of h.filesChanged) {
      parts.push(`- [${f.change}] \`${f.path}\`${f.summary ? ` — ${f.summary}` : ""}`)
    }
  }

  if (h.references && h.references.length > 0) {
    parts.push(`\n**Reference Context (read-only)**`)
    for (const r of h.references) {
      parts.push(`- \`${r.path}\` :: \`${r.symbol}\` (lines ${r.lineStart}-${r.lineEnd})`)
      parts.push("  ```\n" + r.excerpt.split("\n").map((l) => "  " + l).join("\n") + "\n  ```")
    }
  }

  if (h.steps && h.steps.length > 0) {
    parts.push(`\n**Implementation Steps**`)
    h.steps.forEach((s, i) => parts.push(`${i + 1}. ${s}`))
  }

  if (h.testing) parts.push(`\n**Testing**\n${h.testing}`)
  if (h.testResults) {
    parts.push(`\n**Test Results**: ${h.testResults.passed} passed, ${h.testResults.failed} failed`)
    if (h.testResults.failures && h.testResults.failures.length > 0) {
      parts.push("Failures:")
      for (const f of h.testResults.failures) parts.push(`- ${f}`)
    }
  }
  if (h.risks && h.risks.length > 0) {
    parts.push(`\n**Risks**`)
    for (const r of h.risks) parts.push(`- ${r}`)
  }
  if (h.openQuestions && h.openQuestions.length > 0) {
    parts.push(`\n**Open Questions**`)
    for (const q of h.openQuestions) parts.push(`- ${q}`)
  }

  return parts.join("\n")
}

/** Extract a pending question from an agent's final assistant message.
 * Only triggers on an explicit ```handoff_question fenced block. */
function extractQuestion(text: string | null | undefined): string | null {
  if (!text) return null
  const m = text.match(/```handoff_question\s*\n([\s\S]*?)```/i)
  return m ? m[1].trim() : null
}

/** Prompt for the orchestrator entry stage. Encourages delegation via the `task` tool. */
function buildOrchestratorPrompt(pipeline: PipelineInstance): string {
  const modeNote = pipeline.mode === "quick"
    ? "\n\n[QUICK MODE: Do not ask clarifying questions; make reasonable assumptions and proceed.]"
    : ""
  const storyBlock = pipeline.story ? `\n\n${renderStoryContext(pipeline.story)}` : ""
  return `## Orchestrated Task: ${pipeline.storyTitle}${pipeline.storyId ? ` (Story: ${pipeline.storyId})` : ""}

You are the **Orchestrator** for this work. Decompose the task and delegate to subagents using the \`task\` tool — pick from: planner, senior-developer, developer-1, developer-2, test-engineer, code-reviewer, security-scanner, db-agent, infra-agent, doc-agent, refactor.

Each delegation appears live as a stage on the user's dashboard, so prefer one focused \`task\` call per subagent rather than batching unrelated work.${modeNote}${storyBlock}

Begin by outlining your delegation plan, then issue \`task\` calls. Summarize results when all delegations complete.`
}

/** Build the prompt for a stage's team lead based on pipeline context */
function buildStagePrompt(pipeline: PipelineInstance, stageIdx: number, config: WorkflowConfig): string {
  const stage = pipeline.stages[stageIdx]

  // Orchestrator entry stage: dynamic delegation, no handoff schema required.
  if (stage.teamId === "orchestrator") return buildOrchestratorPrompt(pipeline)

  const team = config.teams.find((t) => t.id === stage.teamId)
  const modeNote = pipeline.mode === "quick" ? "\n\n[QUICK MODE: Do not ask questions. Make reasonable assumptions and proceed immediately.]" : ""

  // Gather previous stage context: prefer structured handoff, fall back to raw output
  const prevSections: string[] = []
  for (let i = 0; i < stageIdx; i++) {
    const s = pipeline.stages[i]
    const t = config.teams.find((tm) => tm.id === s.teamId)
    const teamName = t?.name || s.teamId
    if (s.handoff) {
      prevSections.push(renderHandoffMarkdown(teamName, s.handoff))
    } else if (s.output) {
      const outStr = typeof s.output === "string" ? s.output : JSON.stringify(s.output, null, 2)
      prevSections.push(`### ${teamName} Output (unstructured)\n${outStr}`)
    }
  }

  const directive = prevSections.length > 0
    ? `\n\n## Prior Stage Handoffs\n\n> The excerpts and file references below are authoritative for this task. Do NOT re-read these files unless you need information beyond what is shown — the prior stage already navigated the codebase for you.\n\n${prevSections.join("\n\n---\n\n")}`
    : ""

  // Story context — planner only (stageIdx === 0). Later stages rely on planner's structured handoff.
  const storyBlock = stageIdx === 0 && pipeline.story
    ? `\n\n${renderStoryContext(pipeline.story)}`
    : ""

  // Handoff format reminder for the current stage
  const handoffReminder = `\n\n## Required Handoff Output

When you finish, your final assistant message MUST end with a fenced JSON block tagged \`handoff\`:

\`\`\`json handoff
{
  "stage": "${stage.teamId}",
  "summary": "<what was accomplished or planned>",
  "approach": "<high-level approach, planner-leaning>",
  "filesToModify": [{ "path": "...", "purpose": "...", "lineStart": 0, "lineEnd": 0, "excerpt": "<actual code, <=150 lines>" }],
  "filesToCreate": [{ "path": "...", "purpose": "...", "skeleton": "<starter content>" }],
  "filesChanged": [{ "path": "...", "change": "added|modified|deleted", "summary": "..." }],
  "references": [{ "path": "...", "symbol": "...", "lineStart": 0, "lineEnd": 0, "excerpt": "<actual code>" }],
  "steps": ["<concrete step>", "..."],
  "testing": "<how to verify or results>",
  "testResults": { "passed": 0, "failed": 0, "failures": [] },
  "risks": ["..."],
  "openQuestions": ["..."]
}
\`\`\`

Include real code excerpts (not just paths) in \`filesToModify\` and \`references\` — the next stage will use these directly without re-navigating. Cap each excerpt at ~150 lines. Omit fields that don't apply to your stage.

### Need clarification first?

If you cannot produce a complete handoff because you need answers from the user, output a fenced block tagged \`handoff_question\` (NOT the json one) containing your questions, and stop. The pipeline will pause; once the user replies in the chat, your session will resume automatically. Do NOT emit \`\`\`json handoff\`\`\` until all questions are resolved.

\`\`\`handoff_question
1. <your question>
2. <your question>
\`\`\``

  return `## Pipeline Task: ${pipeline.storyTitle}${pipeline.storyId ? ` (Story: ${pipeline.storyId})` : ""}

You are the **${team?.name || stage.teamId} Lead** in this pipeline workflow.${modeNote}${storyBlock}${directive}${handoffReminder}

Please proceed with your stage of the pipeline.`
}

/** Internal fetch helper for calling the same server's session API */
async function internalFetch(pipePath: string, dir: string, opts?: RequestInit): Promise<any> {
  const base = serverUrl?.href || "http://127.0.0.1:3000"
  const sep = pipePath.includes("?") ? "&" : "?"
  const fullUrl = `${base.replace(/\/$/, "")}${pipePath}${sep}directory=${encodeURIComponent(dir)}`
  const method = opts?.method || "GET"

  // Build auth header (server uses Basic Auth when OPENCODE_SERVER_PASSWORD is set)
  const username = process.env.OPENCODE_SERVER_USERNAME || "opencode"
  const password = process.env.OPENCODE_SERVER_PASSWORD || ""
  const authHeaders: Record<string, string> = {}
  if (password) {
    authHeaders["Authorization"] = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
  }

  console.log(`[pipeline] fetch ${method} ${fullUrl} (auth=${password ? "yes" : "no"})`)

  try {
    const res = await fetch(fullUrl, {
      ...opts,
      headers: { "Content-Type": "application/json", ...authHeaders, ...(opts?.headers || {}) },
    })
    const text = await res.text()
    const preview = text.length > 500 ? text.slice(0, 500) + "...[truncated]" : text
    console.log(`[pipeline] fetch ${method} ${fullUrl} -> ${res.status} ${res.statusText} body=${preview}`)
    if (!res.ok) return null
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  } catch (err) {
    console.error(`[pipeline] fetch ${method} ${fullUrl} threw:`, err instanceof Error ? err.stack || err.message : err)
    return null
  }
}

/** Create a session and send the initial prompt to the team lead */
async function startStageSession(pipeline: PipelineInstance, stageIdx: number, config: WorkflowConfig): Promise<string | null> {
  const stage = pipeline.stages[stageIdx]
  const team = config.teams.find((t) => t.id === stage.teamId)
  if (!team) {
    console.error(`[pipeline] startStageSession: no team found for teamId=${stage.teamId} (pipeline=${pipeline.id} stage=${stageIdx})`)
    return null
  }

  const agentName = agentNameFromFile(team.lead)
  console.log(`[pipeline] startStageSession enter pipeline=${pipeline.id} stage=${stageIdx} team=${team.id} lead=${team.lead} agent=${agentName} dir=${pipeline.directory}`)

  // 1. Create session (note: /session without trailing slash — that's what the route is registered as)
  const session = await internalFetch("/session", pipeline.directory, {
    method: "POST",
    body: JSON.stringify({ title: `[Pipeline] ${team.name}: ${pipeline.storyTitle}` }),
  })
  if (!session?.id) {
    console.error(`[pipeline] startStageSession: session creation FAILED for pipeline=${pipeline.id} stage=${stageIdx} session response=${JSON.stringify(session)}`)
    return null
  }

  const sessionId = session.id
  console.log(`[pipeline] startStageSession: created session=${sessionId}`)

  // 2. Send prompt async (fire-and-forget)
  const prompt = buildStagePrompt(pipeline, stageIdx, config)
  const promptResult = await internalFetch(`/session/${sessionId}/prompt_async`, pipeline.directory, {
    method: "POST",
    body: JSON.stringify({
      parts: [{ type: "text", text: prompt }],
      agent: agentName,
    }),
  })
  console.log(`[pipeline] startStageSession: prompt_async result=${JSON.stringify(promptResult)?.slice(0, 200)}`)

  return sessionId
}

// ============ Session Completion Polling ============

/** Map of pipelineId → polling interval */
const activePollers = new Map<string, ReturnType<typeof setInterval>>()

/** Check if a session is still busy */
async function isSessionBusy(sessionId: string, dir: string): Promise<boolean> {
  const status = await internalFetch("/session/status", dir)
  if (!status) {
    console.log(`[pipeline] isSessionBusy(${sessionId}): status response was null, treating as not busy`)
    return false
  }
  const entry = status[sessionId]
  const busy = entry?.type === "busy" || entry?.type === "retry"
  return busy
}

/** Get the last assistant message from a session (for output extraction) */
async function getSessionLastMessage(sessionId: string, dir: string): Promise<string | null> {
  const messages = await internalFetch(`/session/${sessionId}/message`, dir)
  if (!messages || !Array.isArray(messages)) return null
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") {
      const parts = messages[i].parts || []
      const textParts = parts.filter((p: any) => p.type === "text").map((p: any) => p.text)
      if (textParts.length > 0) return textParts.join("\n")
    }
  }
  return null
}

/** Map a task tool part's state.status to a StageState status. */
function mapTaskStatusToStage(s: string | undefined): StageState["status"] {
  if (s === "completed") return "completed"
  if (s === "error" || s === "failed") return "failed"
  if (s === "running" || s === "pending") return "running"
  return "running"
}

/** Discover `task` tool delegations in a session's messages.
 * Returns one record per task part: id, subagent name, label, status, optional child sessionId, timestamps. */
async function fetchTaskDelegations(sessionId: string, dir: string): Promise<Array<{
  partId: string
  agent: string
  label: string
  status: StageState["status"]
  childSessionId?: string
  startedAt?: string
  completedAt?: string
  output?: string
}>> {
  const messages = await internalFetch(`/session/${sessionId}/message`, dir)
  if (!messages || !Array.isArray(messages)) return []
  const out: Array<any> = []
  for (let mi = 0; mi < messages.length; mi++) {
    const msg = messages[mi]
    const parts = msg.parts || []
    for (let pi = 0; pi < parts.length; pi++) {
      const p = parts[pi]
      if (p.type !== "tool" || p.tool !== "task") continue
      const input = p.state?.input || {}
      const agent = input.subagent_type || input.agent || "subagent"
      const label = input.description || input.prompt?.slice(0, 80) || agent
      const status = mapTaskStatusToStage(p.state?.status)
      const partId = p.id || `${msg.id || mi}:${pi}`
      const childSessionId =
        p.state?.metadata?.sessionId ||
        p.state?.metadata?.sessionID ||
        p.state?.output?.sessionID ||
        (typeof p.state?.output === "string"
          ? p.state.output.match(/task_id:\s*(ses_[A-Za-z0-9_-]+)/)?.[1]
          : undefined)
      const startedAt = p.state?.time?.start ? new Date(p.state.time.start).toISOString() : undefined
      const completedAt = p.state?.time?.end ? new Date(p.state.time.end).toISOString() : undefined
      const rawOutput = p.state?.output
      const outStr = typeof rawOutput === "string" ? rawOutput : rawOutput ? JSON.stringify(rawOutput).slice(0, 2000) : undefined
      out.push({ partId, agent, label, status, childSessionId, startedAt, completedAt, output: outStr })
    }
  }
  return out
}

/** Reconcile a pipeline's dynamic stages against the orchestrator's current task delegations. */
function reconcileDynamicStages(pipeline: PipelineInstance, delegations: Awaited<ReturnType<typeof fetchTaskDelegations>>): boolean {
  let changed = false
  const byPartId = new Map<string, StageState>()
  for (const s of pipeline.stages) if (s.partId) byPartId.set(s.partId, s)

  for (const d of delegations) {
    const existing = byPartId.get(d.partId)
    if (existing) {
      // Update fields if they changed
      if (existing.status !== d.status) { existing.status = d.status; changed = true }
      if (d.childSessionId && existing.sessionId !== d.childSessionId) { existing.sessionId = d.childSessionId; changed = true }
      if (d.startedAt && !existing.startedAt) { existing.startedAt = d.startedAt; changed = true }
      if (d.completedAt && !existing.completedAt) { existing.completedAt = d.completedAt; changed = true }
      if (d.output && !existing.output) { existing.output = d.output; changed = true }
      if (d.label && existing.label !== d.label) { existing.label = d.label; changed = true }
    } else {
      pipeline.stages.push({
        teamId: d.agent,
        status: d.status,
        sessionId: d.childSessionId,
        startedAt: d.startedAt || new Date().toISOString(),
        completedAt: d.completedAt,
        output: d.output,
        partId: d.partId,
        label: d.label,
      })
      changed = true
    }
  }
  return changed
}

/** Start polling a pipeline for orchestrator session status + dynamic delegation updates. */
function startPolling(pipelineId: string, dir: string) {
  if (activePollers.has(pipelineId)) return
  console.log(`[pipeline] startPolling(${pipelineId}): begin (interval=3s) dir=${dir}`)

  const interval = setInterval(async () => {
    const pipeline = loadPipeline(dir, pipelineId)
    if (!pipeline || pipeline.status === "completed" || pipeline.status === "stopped") {
      clearInterval(interval)
      activePollers.delete(pipelineId)
      return
    }

    const orchestratorStage = pipeline.stages.find((s) => s.teamId === "orchestrator" && s.partId === undefined)
    if (!orchestratorStage || !orchestratorStage.sessionId) return

    let dirty = false

    // 1. Pull task delegations from the orchestrator's session and reconcile dynamic stages.
    const delegations = await fetchTaskDelegations(orchestratorStage.sessionId, dir)
    if (reconcileDynamicStages(pipeline, delegations)) dirty = true

    // 2. Track orchestrator's own busy state.
    const busy = await isSessionBusy(orchestratorStage.sessionId, dir)
    if (busy) {
      if (orchestratorStage.status !== "running") { orchestratorStage.status = "running"; dirty = true }
    } else if (orchestratorStage.status === "running") {
      // Orchestrator went idle: capture last message as output
      const output = await getSessionLastMessage(orchestratorStage.sessionId, dir)
      if (output) orchestratorStage.output = output
      orchestratorStage.status = "completed"
      orchestratorStage.completedAt = new Date().toISOString()
      dirty = true
    }

    // 3. Decide whether the pipeline as a whole is done.
    const anyActive = pipeline.stages.some((s) => s.status === "running" || s.status === "pending" || s.status === "waiting")
    if (!anyActive && orchestratorStage.status !== "running") {
      const anyFailed = pipeline.stages.some((s) => s.status === "failed")
      pipeline.status = anyFailed ? "stopped" : "completed"
      pipeline.completedAt = new Date().toISOString()
      dirty = true
      if (dirty) savePipeline(pipeline)
      console.log(`[pipeline] poll(${pipelineId}): pipeline ${pipeline.status} (stages=${pipeline.stages.length})`)
      clearInterval(interval)
      activePollers.delete(pipelineId)
      return
    }

    if (dirty) savePipeline(pipeline)
  }, 3000)

  activePollers.set(pipelineId, interval)
}

// ============ Routes ============

export function PipelineRoutes() {
  return new Hono()
    // Get workflow config
    .get("/config", async (c) => {
      const dir = c.req.query("dir") || process.cwd()
      const config = loadWorkflowConfig(dir)
      if (!config) return c.json({ found: false, default: defaultWorkflowConfig() })
      return c.json({ found: true, config })
    })

    // Save workflow config
    .put("/config", async (c) => {
      const body = await c.req.json()
      const dir = body.directory || process.cwd()
      const config = body.config as WorkflowConfig
      if (!config || !config.teams || !config.workflows) return c.json({ error: "Invalid config" }, 400)
      saveWorkflowConfig(dir, config)
      return c.json({ success: true })
    })

    // List pipeline instances
    .get("/instances", async (c) => {
      const dir = c.req.query("dir") || process.cwd()
      const pipelines = listPipelines(dir)
      // Backfill missing childSessionIds for historical/finished pipelines.
      await Promise.all(
        pipelines.map(async (p) => {
          const orchStage = p.stages.find((s) => s.teamId === "orchestrator" && s.partId === undefined)
          if (!orchStage?.sessionId) return
          const dyn = p.stages.filter((s) => s.partId !== undefined)
          if (dyn.length > 0 && dyn.every((s) => !!s.sessionId)) return
          const delegations = await fetchTaskDelegations(orchStage.sessionId, dir).catch(() => [])
          if (reconcileDynamicStages(p, delegations)) savePipeline(p)
        }),
      )
      pipelines.sort((a, b) => {
        if (a.status === "running" && b.status !== "running") return -1
        if (b.status === "running" && a.status !== "running") return 1
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      })
      return c.json(pipelines)
    })

    // Get single pipeline instance
    .get("/instance/:id", async (c) => {
      const dir = c.req.query("dir") || process.cwd()
      const id = c.req.param("id")
      const pipeline = loadPipeline(dir, id)
      if (!pipeline) return c.json({ error: "Pipeline not found" }, 404)
      const orchStage = pipeline.stages.find((s) => s.teamId === "orchestrator" && s.partId === undefined)
      if (orchStage?.sessionId) {
        const dyn = pipeline.stages.filter((s) => s.partId !== undefined)
        if (dyn.length === 0 || dyn.some((s) => !s.sessionId)) {
          const delegations = await fetchTaskDelegations(orchStage.sessionId, dir).catch(() => [])
          if (reconcileDynamicStages(pipeline, delegations)) savePipeline(pipeline)
        }
      }
      return c.json(pipeline)
    })

    // Start a new pipeline (always orchestrator-driven; legacy workflowId values are ignored)
    .post("/start", async (c) => {
      const body = await c.req.json()
      const dir = body.directory || process.cwd()
      const storyTitle = body.storyTitle
      const storyId = body.storyId
      const mode: "full" | "quick" = body.mode === "quick" ? "quick" : "full"
      const story = normalizeStory(body.story)

      console.log(`[pipeline] /start request: dir=${dir} mode=${mode} storyTitle=${storyTitle} storyId=${storyId} hasStory=${!!story}`)

      if (!storyTitle) return c.json({ error: "Missing storyTitle" }, 400)

      const config = loadWorkflowConfig(dir) || defaultWorkflowConfig()
      // Always run the orchestrator workflow regardless of body.workflowId.
      const workflow = config.workflows.find((w) => w.id === "orchestrator")
        || defaultWorkflowConfig().workflows[0]
      if (!config.teams.find((t) => t.id === "orchestrator")) {
        // User has a stale workflow.json without orchestrator team — fall back to default.
        config.teams.push(defaultWorkflowConfig().teams[0])
      }

      const pipeline: PipelineInstance = {
        id: randomUUID(),
        storyTitle,
        storyId,
        workflowId: "orchestrator",
        mode,
        stages: [{ teamId: "orchestrator", status: "running", startedAt: new Date().toISOString() }],
        currentStage: 0,
        directory: dir,
        createdAt: new Date().toISOString(),
        status: "running",
        story,
        version: PIPELINE_STATE_VERSION,
      }
      void workflow

      savePipeline(pipeline)
      console.log(`[pipeline] /start: created pipeline=${pipeline.id} (orchestrator entry stage)`)

      // Invoke orchestrator session
      const sessionId = await startStageSession(pipeline, 0, config)
      if (sessionId) {
        pipeline.stages[0].sessionId = sessionId
        savePipeline(pipeline)
      } else {
        console.error(`[pipeline] /start: FAILED to start orchestrator session for pipeline=${pipeline.id}`)
        pipeline.stages[0].status = "failed"
        pipeline.stages[0].output = "Failed to create orchestrator session — see server logs for [pipeline] entries"
        pipeline.stages[0].completedAt = new Date().toISOString()
        pipeline.status = "stopped"
        savePipeline(pipeline)
        return c.json({ error: "Failed to create orchestrator session", pipeline }, 500)
      }

      // Start polling for orchestrator status + dynamic delegations
      startPolling(pipeline.id, dir)

      return c.json({ success: true, pipeline })
    })

    // Advance pipeline (no-op for orchestrator workflow — orchestrator drives all delegation)
    .post("/advance/:id", async (c) => {
      const dir = c.req.query("dir") || process.cwd()
      const id = c.req.param("id")
      const pipeline = loadPipeline(dir, id)
      if (!pipeline) return c.json({ error: "Pipeline not found" }, 404)
      return c.json({ success: true, pipeline, note: "Orchestrator pipelines advance automatically via delegations." })
    })

    // Skip current stage — disabled for orchestrator pipelines.
    .post("/skip/:id", async (c) => {
      const dir = c.req.query("dir") || process.cwd()
      const id = c.req.param("id")
      const pipeline = loadPipeline(dir, id)
      if (!pipeline) return c.json({ error: "Pipeline not found" }, 404)
      return c.json({ success: true, pipeline, note: "Skip is not supported for orchestrator pipelines." })
    })

    // Skip the next pending stage — disabled for orchestrator pipelines.
    .post("/skip-next/:id", async (c) => {
      const dir = c.req.query("dir") || process.cwd()
      const id = c.req.param("id")
      const pipeline = loadPipeline(dir, id)
      if (!pipeline) return c.json({ error: "Pipeline not found" }, 404)
      return c.json({ success: true, pipeline, note: "Skip-next is not supported for orchestrator pipelines." })
    })

    // Stop pipeline
    .post("/stop/:id", async (c) => {
      const dir = c.req.query("dir") || process.cwd()
      const id = c.req.param("id")
      const pipeline = loadPipeline(dir, id)
      if (!pipeline) return c.json({ error: "Pipeline not found" }, 404)

      pipeline.status = "stopped"
      // Mark any running/waiting stages as failed
      for (const stage of pipeline.stages) {
        if (stage.status === "running" || stage.status === "waiting") {
          stage.status = "failed"
          stage.completedAt = new Date().toISOString()
        }
      }

      savePipeline(pipeline)
      return c.json({ success: true, pipeline })
    })

    // Update stage state (used by session completion hooks)
    .post("/stage-update/:id", async (c) => {
      const dir = c.req.query("dir") || process.cwd()
      const id = c.req.param("id")
      const body = await c.req.json()
      const pipeline = loadPipeline(dir, id)
      if (!pipeline) return c.json({ error: "Pipeline not found" }, 404)

      const stageIdx = body.stageIndex ?? pipeline.currentStage
      const stage = pipeline.stages[stageIdx]
      if (!stage) return c.json({ error: "Invalid stage index" }, 400)

      if (body.sessionId) stage.sessionId = body.sessionId
      if (body.status) stage.status = body.status
      if (body.output) stage.output = body.output
      if (body.question) {
        stage.question = body.question
        stage.status = "waiting"
        pipeline.status = "paused"
      }
      if (body.status === "completed") {
        stage.completedAt = new Date().toISOString()
      }

      savePipeline(pipeline)
      return c.json({ success: true, pipeline })
    })

    // Answer a question from a stage
    .post("/answer/:id", async (c) => {
      const dir = c.req.query("dir") || process.cwd()
      const id = c.req.param("id")
      const body = await c.req.json()
      const pipeline = loadPipeline(dir, id)
      if (!pipeline) return c.json({ error: "Pipeline not found" }, 404)

      const stage = pipeline.stages[pipeline.currentStage]
      if (!stage || stage.status !== "waiting") return c.json({ error: "No question pending" }, 400)

      stage.status = "running"
      stage.question = undefined
      pipeline.status = "running"

      // Send the answer to the session
      if (stage.sessionId && body.answer) {
        await internalFetch(`/session/${stage.sessionId}/prompt_async`, dir, {
          method: "POST",
          body: JSON.stringify({ parts: [{ type: "text", text: body.answer }] }),
        })
      }

      savePipeline(pipeline)

      // Resume polling
      startPolling(pipeline.id, dir)

      return c.json({ success: true, pipeline, answer: body.answer })
    })
}
