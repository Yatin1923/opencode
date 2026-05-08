import { createStore } from "solid-js/store"
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Tabs } from "@opencode-ai/ui/tabs"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useServer } from "@/context/server"

// ============ Types ============

interface Repo {
  name: string
  techStack: string
  description: string
  defaultBranch: string
}

interface Developer {
  name: string
  specialization: string
}

interface TeamConfig {
  project: {
    name: string
    org: string
    provider: string
    adoProject: string
    repos: Repo[]
    prReviewer: string
    testerAssignee: string
  }
  agents: {
    enableOrchestrator: boolean
    enablePlanner: boolean
    enableSeniorDev: boolean
    enableTestEngineer: boolean
    enableCodeReviewer: boolean
    enableSecurityScanner: boolean
    enableDbAgent: boolean
    enableInfraAgent: boolean
    enableDocAgent: boolean
    enableRefactor: boolean
    developers: Developer[]
    seniorDevName: string
  }
  models: {
    developer: string
    small: string
    escalation: string
    orchestrator: string
  }
  techStack: {
    frontend: string
    backend: string
    database: string
    cloud: string
    iac: string
    testing: {
      unitTestFrontend: string
      unitTestBackend: string
      e2eCommand: string
    }
  }
  mcpServers: string[]
}

// ============ Constants ============

const PROVIDERS = [
  { label: "Azure DevOps", value: "azure-devops" },
  { label: "GitHub", value: "github" },
  { label: "GitLab", value: "gitlab" },
  { label: "Bitbucket", value: "bitbucket" },
  { label: "None / Local only", value: "none" },
]

const FRONTEND_OPTIONS = [
  { label: "None (API only)", value: "none" },
  { label: "React + TypeScript", value: "react-typescript" },
  { label: "Next.js + TypeScript", value: "nextjs-typescript" },
  { label: "Vue 3 + TypeScript", value: "vue-typescript" },
  { label: "Angular", value: "angular" },
  { label: "Svelte + TypeScript", value: "svelte-typescript" },
  { label: "Solid.js + TypeScript", value: "solidjs-typescript" },
]

const BACKEND_OPTIONS = [
  { label: "None (Frontend only)", value: "none" },
  { label: "Node.js + Express", value: "node-express" },
  { label: "Node.js + Fastify", value: "node-fastify" },
  { label: ".NET / C#", value: "dotnet" },
  { label: "Go", value: "go" },
  { label: "Python + FastAPI", value: "python-fastapi" },
  { label: "Python + Django", value: "python-django" },
  { label: "Java + Spring Boot", value: "java-spring" },
  { label: "Rust + Actix", value: "rust-actix" },
]

const DATABASE_OPTIONS = [
  { label: "None", value: "none" },
  { label: "SQL Server", value: "sqlserver" },
  { label: "PostgreSQL", value: "postgresql" },
  { label: "MySQL", value: "mysql" },
  { label: "MongoDB", value: "mongodb" },
  { label: "SQLite", value: "sqlite" },
  { label: "DynamoDB", value: "dynamodb" },
  { label: "CosmosDB", value: "cosmosdb" },
]

const CLOUD_OPTIONS = [
  { label: "None / Self-hosted", value: "none" },
  { label: "Azure", value: "azure" },
  { label: "AWS", value: "aws" },
  { label: "Google Cloud", value: "gcp" },
]

const IAC_OPTIONS = [
  { label: "None", value: "none" },
  { label: "Terraform", value: "terraform" },
  { label: "Bicep", value: "bicep" },
  { label: "AWS CDK", value: "cdk" },
  { label: "Pulumi", value: "pulumi" },
]

const MODEL_OPTIONS = [
  { label: "Claude Opus 4.6 (Copilot)", value: "github-copilot/claude-opus-4.6" },
  { label: "Claude Sonnet 4.5 (Copilot)", value: "github-copilot/claude-sonnet-4.5" },
  { label: "Claude Haiku 4.5 (Copilot)", value: "github-copilot/claude-haiku-4.5" },
  { label: "GPT-4o (Copilot)", value: "github-copilot/gpt-4o" },
  { label: "GPT-4.1 (Copilot)", value: "github-copilot/gpt-4.1" },
  { label: "GPT-4.1 mini (Copilot)", value: "github-copilot/gpt-4.1-mini" },
  { label: "o3 (Copilot)", value: "github-copilot/o3" },
  { label: "o4-mini (Copilot)", value: "github-copilot/o4-mini" },
  { label: "Gemini 2.5 Pro (Copilot)", value: "github-copilot/gemini-2.5-pro" },
]

const MCP_SERVER_OPTIONS = [
  { label: "Azure DevOps", value: "azure-devops", description: "Work items, repos, PRs" },
  { label: "Memory", value: "memory", description: "Persistent memory across sessions" },
  { label: "Playwright", value: "playwright", description: "Browser automation & testing" },
  { label: "Sequential Thinking", value: "sequential-thinking", description: "Complex reasoning" },
  { label: "GitHub", value: "github-mcp", description: "GitHub issues, PRs, repos" },
  { label: "Teams", value: "teams-mcp", description: "Microsoft Teams integration" },
]

const AGENT_TYPES = [
  { id: "orchestrator", label: "Orchestrator", description: "Tech lead that delegates and manages workflow", key: "enableOrchestrator" },
  { id: "planner", label: "Planner", description: "Analyzes stories and creates implementation plans", key: "enablePlanner" },
  { id: "senior-dev", label: "Senior Developer", description: "Handles complex/escalated tasks", key: "enableSeniorDev" },
  { id: "test-engineer", label: "Test Engineer", description: "Runs tests and validates changes", key: "enableTestEngineer" },
  { id: "code-reviewer", label: "Code Reviewer", description: "Reviews PRs for quality and best practices", key: "enableCodeReviewer" },
  { id: "security-scanner", label: "Security Scanner", description: "Checks for security vulnerabilities", key: "enableSecurityScanner" },
  { id: "db-agent", label: "Database Agent", description: "Handles migrations and schema changes", key: "enableDbAgent" },
  { id: "infra-agent", label: "Infrastructure Agent", description: "Manages IaC (Terraform, Bicep, etc.)", key: "enableInfraAgent" },
  { id: "doc-agent", label: "Documentation Agent", description: "Writes and maintains documentation", key: "enableDocAgent" },
  { id: "refactor", label: "Refactor Agent", description: "Improves code structure and readability", key: "enableRefactor" },
] as const

const SPECIALIZATIONS = [
  { label: "Full-stack", value: "Full-stack" },
  { label: "Frontend", value: "Frontend" },
  { label: "Backend", value: "Backend" },
  { label: "API / Services", value: "API" },
  { label: "Mobile", value: "Mobile" },
  { label: "DevOps / CI-CD", value: "DevOps" },
  { label: "Data / ML", value: "Data" },
  { label: "Testing / QA", value: "Testing" },
]

const DEV_NAMES = ["Alice", "Bob", "Charlie", "Diana", "Eve", "Frank", "Grace", "Hank"]

// ============ Agent ID → Filename mapping ============

const AGENT_ID_TO_FILE: Record<string, string> = {
  orchestrator: "orchestrator.md",
  planner: "planner.md",
  "senior-dev": "senior-developer.md",
  "test-engineer": "test-engineer.md",
  "code-reviewer": "code-reviewer.md",
  "security-scanner": "security-scanner.md",
  "db-agent": "db-agent.md",
  "infra-agent": "infra-agent.md",
  "doc-agent": "doc-agent.md",
  refactor: "refactor.md",
}
function agentIdToFilename(id: string): string {
  return AGENT_ID_TO_FILE[id] || `${id}.md`
}

// ============ Shared Input Components ============

function DetectedBadge() {
  return <span class="text-10-regular text-icon-success-base bg-icon-success-base/10 px-1.5 py-0.5 rounded">detected</span>
}

function TextInput(props: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; detected?: boolean }) {
  return (
    <label class="flex flex-col gap-1.5">
      <div class="flex items-center gap-2">
        <span class="text-12-medium text-text-base">{props.label}</span>
        <Show when={props.detected}><DetectedBadge /></Show>
      </div>
      <input
        type="text"
        value={props.value}
        onInput={(e) => props.onChange(e.currentTarget.value)}
        placeholder={props.placeholder}
        class="px-3 py-2 rounded-lg border border-border-base bg-surface-base text-text-strong text-13-regular focus:outline-none focus:border-brand-base focus:ring-1 focus:ring-brand-base transition-colors"
      />
    </label>
  )
}

function SelectInput(props: { label: string; value: string; onChange: (v: string) => void; options: { label: string; value: string }[]; detected?: boolean }) {
  return (
    <label class="flex flex-col gap-1.5">
      <div class="flex items-center gap-2">
        <span class="text-12-medium text-text-base">{props.label}</span>
        <Show when={props.detected}><DetectedBadge /></Show>
      </div>
      <select
        value={props.value}
        onChange={(e) => props.onChange(e.currentTarget.value)}
        class="px-3 py-2 rounded-lg border border-border-base bg-surface-base text-text-strong text-13-regular focus:outline-none focus:border-brand-base focus:ring-1 focus:ring-brand-base transition-colors"
      >
        <For each={props.options}>{(opt) => <option value={opt.value}>{opt.label}</option>}</For>
      </select>
    </label>
  )
}

function CheckboxItem(props: { label: string; description?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label class="flex items-start gap-3 py-2.5 px-3 rounded-lg hover:bg-surface-raised-base transition-colors cursor-pointer">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(e) => props.onChange(e.currentTarget.checked)}
        class="mt-0.5 w-4 h-4 rounded border-border-base accent-brand-base"
      />
      <div class="flex flex-col gap-0.5">
        <span class="text-13-medium text-text-strong">{props.label}</span>
        <Show when={props.description}>
          <span class="text-11-regular text-text-weak">{props.description}</span>
        </Show>
      </div>
    </label>
  )
}

function RemoveButton(props: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      class="p-1.5 rounded text-text-weak hover:text-icon-critical-base hover:bg-icon-critical-base/10 transition-colors"
      aria-label={props.label || "Remove"}
    >
      <svg width="14" height="14" viewBox="0 0 20 20" fill="none"><path d="M3.75 3.75L16.25 16.25M16.25 3.75L3.75 16.25" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /></svg>
    </button>
  )
}

// ============ Tab Panels ============

function TabProject(props: { config: TeamConfig; setConfig: any; detected: Record<string, boolean> }) {
  function addRepo() {
    props.setConfig("project", "repos", (repos: Repo[]) => [...repos, { name: "", techStack: "", description: "", defaultBranch: "main" }])
  }
  function removeRepo(idx: number) {
    props.setConfig("project", "repos", (repos: Repo[]) => repos.filter((_: Repo, i: number) => i !== idx))
  }

  return (
    <div class="flex flex-col gap-5">
      <div class="grid grid-cols-2 gap-4">
        <TextInput label="Project Name" value={props.config.project.name} onChange={(v) => props.setConfig("project", "name", v)} placeholder="my-project" detected={props.detected["project.name"]} />
        <TextInput label="Organization" value={props.config.project.org} onChange={(v) => props.setConfig("project", "org", v)} placeholder="my-org" detected={props.detected["project.org"]} />
      </div>
      <div class="grid grid-cols-2 gap-4">
        <SelectInput label="Git Provider" value={props.config.project.provider} onChange={(v) => props.setConfig("project", "provider", v)} options={PROVIDERS} detected={props.detected["project.provider"]} />
        <Show when={props.config.project.provider === "azure-devops"}>
          <TextInput label="ADO Project" value={props.config.project.adoProject} onChange={(v) => props.setConfig("project", "adoProject", v)} placeholder="MyProject" detected={props.detected["project.adoProject"]} />
        </Show>
      </div>
      <div class="grid grid-cols-2 gap-4">
        <TextInput label="PR Reviewer" value={props.config.project.prReviewer} onChange={(v) => props.setConfig("project", "prReviewer", v)} placeholder="@team-leads" />
        <TextInput label="Tester Assignee" value={props.config.project.testerAssignee} onChange={(v) => props.setConfig("project", "testerAssignee", v)} placeholder="qa@company.com" />
      </div>

      {/* Repos */}
      <div class="flex flex-col gap-3">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="text-13-medium text-text-strong">Repositories</span>
            <Show when={props.detected["project.repos"]}><DetectedBadge /></Show>
          </div>
          <Button size="small" onClick={addRepo}>+ Add Repo</Button>
        </div>
        <For each={props.config.project.repos}>
          {(repo, i) => (
            <div class="flex items-start gap-2 p-3 rounded-lg border border-border-base bg-surface-raised-base">
              <div class="flex-1 grid grid-cols-3 gap-2">
                <TextInput label="Name" value={repo.name} onChange={(v) => props.setConfig("project", "repos", i(), "name", v)} placeholder="api-service" />
                <TextInput label="Tech Stack" value={repo.techStack} onChange={(v) => props.setConfig("project", "repos", i(), "techStack", v)} placeholder="Node.js + Express" />
                <TextInput label="Branch" value={repo.defaultBranch} onChange={(v) => props.setConfig("project", "repos", i(), "defaultBranch", v)} placeholder="main" />
              </div>
              <div class="pt-6"><RemoveButton onClick={() => removeRepo(i())} label="Remove repo" /></div>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}

function TabTechStack(props: { config: TeamConfig; setConfig: any; detected: Record<string, boolean> }) {
  return (
    <div class="flex flex-col gap-5">
      <div class="grid grid-cols-2 gap-4">
        <SelectInput label="Frontend" value={props.config.techStack.frontend} onChange={(v) => props.setConfig("techStack", "frontend", v)} options={FRONTEND_OPTIONS} detected={props.detected["techStack.frontend"]} />
        <SelectInput label="Backend" value={props.config.techStack.backend} onChange={(v) => props.setConfig("techStack", "backend", v)} options={BACKEND_OPTIONS} detected={props.detected["techStack.backend"]} />
      </div>
      <div class="grid grid-cols-3 gap-4">
        <SelectInput label="Database" value={props.config.techStack.database} onChange={(v) => props.setConfig("techStack", "database", v)} options={DATABASE_OPTIONS} detected={props.detected["techStack.database"]} />
        <SelectInput label="Cloud" value={props.config.techStack.cloud} onChange={(v) => props.setConfig("techStack", "cloud", v)} options={CLOUD_OPTIONS} detected={props.detected["techStack.cloud"]} />
        <SelectInput label="IaC" value={props.config.techStack.iac} onChange={(v) => props.setConfig("techStack", "iac", v)} options={IAC_OPTIONS} detected={props.detected["techStack.iac"]} />
      </div>
      <div class="border-t border-border-base pt-4">
        <span class="text-13-medium text-text-strong">Testing</span>
        <div class="grid grid-cols-3 gap-4 mt-3">
          <TextInput label="Frontend Unit Test" value={props.config.techStack.testing.unitTestFrontend} onChange={(v) => props.setConfig("techStack", "testing", "unitTestFrontend", v)} placeholder="Vitest" detected={props.detected["techStack.testing.unitTestFrontend"]} />
          <TextInput label="Backend Unit Test" value={props.config.techStack.testing.unitTestBackend} onChange={(v) => props.setConfig("techStack", "testing", "unitTestBackend", v)} placeholder="xUnit" detected={props.detected["techStack.testing.unitTestBackend"]} />
          <TextInput label="E2E Command" value={props.config.techStack.testing.e2eCommand} onChange={(v) => props.setConfig("techStack", "testing", "e2eCommand", v)} placeholder="npx playwright test" detected={props.detected["techStack.testing.e2eCommand"]} />
        </div>
      </div>
    </div>
  )
}

function AgentFileEditor(props: { directory: string; filename: string; onClose: () => void }) {
  const server = useServer()
  const [content, setContent] = createSignal("")
  const [originalContent, setOriginalContent] = createSignal("")
  const [isGenerated, setIsGenerated] = createSignal(true)
  const [loading, setLoading] = createSignal(true)
  const [saving, setSaving] = createSignal(false)
  const [error, setError] = createSignal("")

  const authHeaders = (): Record<string, string> => {
    const headers: Record<string, string> = { "Content-Type": "application/json" }
    const http = server.current?.http
    if (http?.password) headers["Authorization"] = `Basic ${btoa(`${http.username ?? "opencode"}:${http.password}`)}`
    return headers
  }

  onMount(async () => {
    try {
      const base = server.current?.http.url || ""
      const res = await fetch(`${base}/api/team/agent-file?dir=${encodeURIComponent(props.directory)}&filename=${encodeURIComponent(props.filename)}`, { headers: authHeaders() })
      if (res.ok) {
        const data = await res.json()
        setContent(data.content)
        setOriginalContent(data.content)
        setIsGenerated(data.isGenerated)
      } else {
        setError("Failed to load file")
      }
    } catch (_) {
      setError("Network error")
    } finally {
      setLoading(false)
    }
  })

  async function handleSave() {
    setSaving(true)
    setError("")
    try {
      const base = server.current?.http.url || ""
      const res = await fetch(`${base}/api/team/agent-file`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ directory: props.directory, filename: props.filename, content: content() }),
      })
      if (res.ok) {
        setOriginalContent(content())
        setIsGenerated(false)
        props.onClose()
      } else {
        const data = await res.json().catch(() => ({ error: "Save failed" }))
        setError(data.error || "Save failed")
      }
    } catch (_) {
      setError("Network error")
    } finally {
      setSaving(false)
    }
  }

  async function handleReset() {
    // Re-read the original generated content
    setContent(originalContent())
  }

  const hasChanges = () => content() !== originalContent()

  return (
    <div class="flex flex-col h-full">
      <div class="shrink-0 flex items-center justify-between px-4 py-3 border-b border-border-base">
        <div class="flex items-center gap-2">
          <button type="button" onClick={props.onClose} class="text-text-weak hover:text-text-strong transition-colors">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 12L6 8l4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <span class="text-13-medium text-text-strong font-mono">{props.filename}</span>
          <Show when={!isGenerated()}>
            <span class="text-10-regular text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded">customized</span>
          </Show>
        </div>
        <div class="flex items-center gap-2">
          <Show when={error()}>
            <span class="text-11-regular text-icon-critical-base">{error()}</span>
          </Show>
          <Button variant="ghost" size="small" onClick={props.onClose}>Cancel</Button>
          <Button size="small" onClick={handleSave} disabled={!hasChanges() || saving()}>
            {saving() ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
      <Show when={loading()}>
        <div class="flex-1 flex items-center justify-center">
          <div class="w-5 h-5 rounded-full border-2 border-brand-base border-t-transparent animate-spin" />
        </div>
      </Show>
      <Show when={!loading()}>
        <textarea
          class="flex-1 w-full p-4 bg-surface-base text-text-strong text-13-regular font-mono resize-none focus:outline-none border-none"
          style="tab-size: 2"
          value={content()}
          onInput={(e) => setContent(e.currentTarget.value)}
          spellcheck={false}
        />
      </Show>
    </div>
  )
}

function TabAgents(props: { config: TeamConfig; setConfig: any; directory: string; editingFile: string | null; setEditingFile: (f: string | null) => void; agentFileStatus: Record<string, boolean> }) {
  const [showAddMenu, setShowAddMenu] = createSignal(false)
  let menuRef: HTMLDivElement | undefined

  const enabledAgents = createMemo(() => AGENT_TYPES.filter((a) => (props.config.agents as any)[a.key]))
  const disabledAgents = createMemo(() => AGENT_TYPES.filter((a) => !(props.config.agents as any)[a.key]))

  // Close dropdown on outside click
  function handleClickOutside(e: MouseEvent) {
    if (menuRef && !menuRef.contains(e.target as Node)) setShowAddMenu(false)
  }
  onMount(() => document.addEventListener("mousedown", handleClickOutside))
  onCleanup(() => document.removeEventListener("mousedown", handleClickOutside))

  function addAgent(key: string) {
    props.setConfig("agents", key, true)
    setShowAddMenu(false)
  }
  function removeAgent(key: string) {
    props.setConfig("agents", key, false)
  }
  function addDeveloper() {
    const idx = props.config.agents.developers.length
    const name = DEV_NAMES[idx % DEV_NAMES.length] || `Dev-${idx + 1}`
    props.setConfig("agents", "developers", (devs: Developer[]) => [...devs, { name, specialization: "Full-stack" }])
    setShowAddMenu(false)
  }
  function removeDeveloper(idx: number) {
    props.setConfig("agents", "developers", (devs: Developer[]) => devs.filter((_: Developer, i: number) => i !== idx))
  }

  return (
    <div class="flex flex-col gap-4">
      <div class="flex items-center justify-between">
        <span class="text-13-medium text-text-strong">
          {enabledAgents().length + props.config.agents.developers.length} agent{enabledAgents().length + props.config.agents.developers.length !== 1 ? "s" : ""} configured
        </span>
        <div class="relative" ref={menuRef}>
          <Button size="small" onClick={() => setShowAddMenu(!showAddMenu())}>+ Add Agent</Button>
          <Show when={showAddMenu()}>
            <div class="absolute right-0 top-full mt-1 z-50 w-64 bg-surface-raised-base border border-border-base rounded-lg shadow-lg overflow-hidden">
              <div class="max-h-60 overflow-y-auto">
                <Show when={disabledAgents().length > 0}>
                  <For each={disabledAgents()}>
                    {(agent) => (
                      <button type="button" class="w-full text-left px-4 py-2 hover:bg-surface-base-hover transition-colors" onClick={() => addAgent(agent.key)}>
                        <div class="text-13-medium text-text-strong">{agent.label}</div>
                        <div class="text-11-regular text-text-weak">{agent.description}</div>
                      </button>
                    )}
                  </For>
                </Show>
                <div class="border-t border-border-base">
                  <button type="button" class="w-full text-left px-4 py-2 hover:bg-surface-base-hover transition-colors" onClick={addDeveloper}>
                    <div class="text-13-medium text-text-strong">Developer Agent</div>
                    <div class="text-11-regular text-text-weak">Writes code with a specialization</div>
                  </button>
                </div>
              </div>
            </div>
          </Show>
        </div>
      </div>

      <div class="flex flex-col gap-1.5">
        <For each={enabledAgents()}>
          {(agent) => {
            const filename = agentIdToFilename(agent.id)
            const isCustomized = () => props.agentFileStatus[filename] === false
            return (
              <div class="flex items-center justify-between px-4 py-2.5 rounded-lg border border-border-base bg-surface-raised-base">
                <div class="flex flex-col">
                  <div class="flex items-center gap-2">
                    <span class="text-13-medium text-text-strong">{agent.label}</span>
                    <Show when={isCustomized()}>
                      <span class="text-10-regular text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded">customized</span>
                    </Show>
                  </div>
                  <span class="text-11-regular text-text-weak">{agent.description}</span>
                </div>
                <div class="flex items-center gap-1">
                  <button type="button" onClick={() => props.setEditingFile(filename)} class="px-2 py-1 text-11-regular text-text-weak hover:text-brand-base transition-colors rounded hover:bg-surface-base-hover" title={`Edit ${filename}`}>Edit</button>
                  <RemoveButton onClick={() => removeAgent(agent.key)} label={`Remove ${agent.label}`} />
                </div>
              </div>
            )
          }}
        </For>

        <For each={props.config.agents.developers}>
          {(dev, i) => {
            const filename = () => `developer-${i() + 1}.md`
            const isCustomized = () => props.agentFileStatus[filename()] === false
            return (
              <div class="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-border-base bg-surface-raised-base">
                <div class="flex-1 grid grid-cols-2 gap-3">
                  <div class="flex flex-col gap-1">
                    <div class="flex items-center gap-2">
                      <span class="text-11-regular text-text-weak">Name</span>
                      <Show when={isCustomized()}>
                        <span class="text-10-regular text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded">customized</span>
                      </Show>
                    </div>
                    <input
                      type="text"
                      value={dev.name}
                      onInput={(e) => props.setConfig("agents", "developers", i(), "name", e.currentTarget.value)}
                      class="px-2.5 py-1.5 rounded-md border border-border-base bg-surface-base text-text-strong text-13-regular focus:outline-none focus:border-brand-base"
                    />
                  </div>
                  <div class="flex flex-col gap-1">
                    <span class="text-11-regular text-text-weak">Specialization</span>
                    <select
                      value={dev.specialization}
                      onChange={(e) => props.setConfig("agents", "developers", i(), "specialization", e.currentTarget.value)}
                      class="px-2.5 py-1.5 rounded-md border border-border-base bg-surface-base text-text-strong text-13-regular focus:outline-none focus:border-brand-base"
                    >
                      <For each={SPECIALIZATIONS}>{(opt) => <option value={opt.value}>{opt.label}</option>}</For>
                    </select>
                  </div>
                </div>
                <div class="flex items-center gap-1">
                  <button type="button" onClick={() => props.setEditingFile(filename())} class="px-2 py-1 text-11-regular text-text-weak hover:text-brand-base transition-colors rounded hover:bg-surface-base-hover" title={`Edit ${filename()}`}>Edit</button>
                  <RemoveButton onClick={() => removeDeveloper(i())} label="Remove developer" />
                </div>
              </div>
            )
          }}
        </For>
      </div>

      <Show when={enabledAgents().length === 0 && props.config.agents.developers.length === 0}>
        <div class="text-center py-6 text-text-weak text-13-regular border border-dashed border-border-base rounded-lg">
          No agents added. Click "+ Add Agent" to build your team.
        </div>
      </Show>
    </div>
  )
}

function TabModels(props: { config: TeamConfig; setConfig: any }) {
  return (
    <div class="flex flex-col gap-5">
      <div class="grid grid-cols-2 gap-4">
        <SelectInput label="Developer Model" value={props.config.models.developer} onChange={(v) => props.setConfig("models", "developer", v)} options={MODEL_OPTIONS} />
        <SelectInput label="Small/Fast Model" value={props.config.models.small} onChange={(v) => props.setConfig("models", "small", v)} options={MODEL_OPTIONS} />
        <SelectInput label="Escalation Model" value={props.config.models.escalation} onChange={(v) => props.setConfig("models", "escalation", v)} options={MODEL_OPTIONS} />
        <SelectInput label="Orchestrator Model" value={props.config.models.orchestrator} onChange={(v) => props.setConfig("models", "orchestrator", v)} options={MODEL_OPTIONS} />
      </div>
      <div class="p-3 rounded-lg bg-surface-raised-base border border-border-base">
        <p class="text-12-regular text-text-weak">
          <strong class="text-text-base">Tip:</strong> Use a powerful model (Opus/o3) for orchestration and escalation,
          a balanced model (Sonnet/GPT-4.1) for development, and a fast model (Haiku/4.1-mini) for quick tasks.
        </p>
      </div>
    </div>
  )
}

function TabMcpServers(props: { config: TeamConfig; setConfig: any }) {
  function toggleServer(value: string) {
    props.setConfig("mcpServers", (servers: string[]) =>
      servers.includes(value) ? servers.filter((s: string) => s !== value) : [...servers, value],
    )
  }

  return (
    <div class="flex flex-col gap-1 border border-border-base rounded-lg overflow-hidden">
      <For each={MCP_SERVER_OPTIONS}>
        {(server) => (
          <CheckboxItem
            label={server.label}
            description={server.description}
            checked={props.config.mcpServers.includes(server.value)}
            onChange={() => toggleServer(server.value)}
          />
        )}
      </For>
    </div>
  )
}

// ============ Tab: Workflows ============

function TabWorkflows(props: { directory: string }) {
  const server = useServer()
  const [config, setConfig] = createSignal<any>(null)
  const [loading, setLoading] = createSignal(true)
  const [saving, setSaving] = createSignal(false)

  const authHeaders = (): Record<string, string> => {
    const headers: Record<string, string> = { "Content-Type": "application/json" }
    const http = server.current?.http
    if (http?.password) headers["Authorization"] = `Basic ${btoa(`${http.username ?? "opencode"}:${http.password}`)}`
    return headers
  }

  onMount(async () => {
    try {
      const base = server.current?.http.url || ""
      const res = await fetch(`${base}/api/pipeline/config?dir=${encodeURIComponent(props.directory)}`, { headers: authHeaders() })
      if (res.ok) {
        const data = await res.json()
        setConfig(data.found ? data.config : data.default)
      }
    } catch (_) {}
    setLoading(false)
  })

  async function handleSave() {
    if (!config()) return
    setSaving(true)
    try {
      const base = server.current?.http.url || ""
      await fetch(`${base}/api/pipeline/config`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ directory: props.directory, config: config() }),
      })
    } catch (_) {}
    setSaving(false)
  }

  function updateTeamMembers(teamId: string, members: string) {
    const c = config()
    if (!c) return
    const teams = c.teams.map((t: any) => t.id === teamId ? { ...t, members: members.split(",").map((m: string) => m.trim()).filter(Boolean) } : t)
    setConfig({ ...c, teams })
  }

  function updateTeamLead(teamId: string, lead: string) {
    const c = config()
    if (!c) return
    const teams = c.teams.map((t: any) => t.id === teamId ? { ...t, lead } : t)
    setConfig({ ...c, teams })
  }

  function updateWorkflowGate(workflowId: string, stageId: string, gate: "manual" | "auto") {
    const c = config()
    if (!c) return
    const workflows = c.workflows.map((w: any) => {
      if (w.id !== workflowId) return w
      const gates = { ...w.gates }
      if (gate === "auto") delete gates[stageId]
      else gates[stageId] = gate
      return { ...w, gates }
    })
    setConfig({ ...c, workflows })
  }

  return (
    <div class="flex flex-col gap-6">
      <Show when={loading()}>
        <div class="flex items-center justify-center py-8">
          <div class="w-5 h-5 rounded-full border-2 border-brand-base border-t-transparent animate-spin" />
        </div>
      </Show>
      <Show when={!loading() && config()}>
        {/* Teams */}
        <div>
          <div class="flex items-center justify-between mb-3">
            <span class="text-13-medium text-text-strong">Teams</span>
          </div>
          <div class="flex flex-col gap-2">
            <For each={config()?.teams || []}>
              {(team: any) => (
                <div class="px-4 py-3 rounded-lg border border-border-base bg-surface-raised-base">
                  <div class="flex items-center gap-3 mb-2">
                    <span class="text-13-medium text-text-strong">{team.name}</span>
                    <span class="text-10-regular text-text-weak font-mono px-1.5 py-0.5 bg-surface-base rounded">{team.icon}</span>
                  </div>
                  <div class="grid grid-cols-2 gap-3">
                    <div class="flex flex-col gap-1">
                      <span class="text-11-regular text-text-weak">Lead Agent</span>
                      <input
                        type="text"
                        value={team.lead}
                        onInput={(e) => updateTeamLead(team.id, e.currentTarget.value)}
                        class="px-2.5 py-1.5 rounded-md border border-border-base bg-surface-base text-text-strong text-12-regular font-mono focus:outline-none focus:border-brand-base"
                      />
                    </div>
                    <div class="flex flex-col gap-1">
                      <span class="text-11-regular text-text-weak">Members (comma-separated)</span>
                      <input
                        type="text"
                        value={team.members.join(", ")}
                        onInput={(e) => updateTeamMembers(team.id, e.currentTarget.value)}
                        class="px-2.5 py-1.5 rounded-md border border-border-base bg-surface-base text-text-strong text-12-regular font-mono focus:outline-none focus:border-brand-base"
                      />
                    </div>
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>

        {/* Workflow Templates */}
        <div>
          <span class="text-13-medium text-text-strong">Workflow Templates</span>
          <div class="flex flex-col gap-3 mt-3">
            <For each={config()?.workflows || []}>
              {(workflow: any) => (
                <div class="px-4 py-3 rounded-lg border border-border-base bg-surface-raised-base">
                  <div class="text-13-medium text-text-strong mb-2">{workflow.name}</div>
                  <div class="flex items-center gap-2 flex-wrap">
                    <For each={workflow.stages}>
                      {(stageId: string, i) => {
                        const gate = () => workflow.gates?.[stageId] || "auto"
                        return (
                          <div class="flex items-center gap-1">
                            <div class="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-surface-base border border-border-base">
                              <span class="text-11-medium text-text-strong">{stageId}</span>
                              <select
                                value={gate()}
                                onChange={(e) => updateWorkflowGate(workflow.id, stageId, e.currentTarget.value as "manual" | "auto")}
                                class="text-10-regular bg-transparent border-none outline-none text-text-weak cursor-pointer"
                              >
                                <option value="auto">auto</option>
                                <option value="manual">manual</option>
                              </select>
                            </div>
                            <Show when={i() < workflow.stages.length - 1}>
                              <span class="text-text-weak text-xs">→</span>
                            </Show>
                          </div>
                        )
                      }}
                    </For>
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>

        {/* Save */}
        <div class="flex justify-end">
          <Button size="small" onClick={handleSave} disabled={saving()}>
            {saving() ? "Saving..." : "Save Workflow Config"}
          </Button>
        </div>
      </Show>
    </div>
  )
}

// ============ Main Dialog ============

export function DialogTeamSetup(props: { directory: string }) {
  const server = useServer()
  const dialog = useDialog()
  const [generating, setGenerating] = createSignal(false)
  const [generated, setGenerated] = createSignal(false)
  const [detecting, setDetecting] = createSignal(true)
  const [detected, setDetected] = createSignal<Record<string, boolean>>({})
  const [error, setError] = createSignal("")
  const [editingFile, setEditingFile] = createSignal<string | null>(null)
  const [agentFileStatus, setAgentFileStatus] = createSignal<Record<string, boolean>>({})

  const projectName = () => props.directory.split("/").pop() || props.directory

  const authHeaders = (): Record<string, string> => {
    const headers: Record<string, string> = { "Content-Type": "application/json" }
    const http = server.current?.http
    if (http?.password) headers["Authorization"] = `Basic ${btoa(`${http.username ?? "opencode"}:${http.password}`)}`
    return headers
  }

  const [config, setConfig] = createStore<TeamConfig>({
    project: {
      name: "",
      org: "",
      provider: "none",
      adoProject: "",
      repos: [{ name: "", techStack: "", description: "", defaultBranch: "main" }],
      prReviewer: "",
      testerAssignee: "",
    },
    agents: {
      enableOrchestrator: true,
      enablePlanner: true,
      enableSeniorDev: true,
      enableTestEngineer: true,
      enableCodeReviewer: true,
      enableSecurityScanner: true,
      enableDbAgent: false,
      enableInfraAgent: false,
      enableDocAgent: false,
      enableRefactor: false,
      developers: [{ name: "Alice", specialization: "Full-stack" }],
      seniorDevName: "Senior",
    },
    models: {
      developer: "github-copilot/claude-sonnet-4.5",
      small: "github-copilot/claude-haiku-4.5",
      escalation: "github-copilot/claude-opus-4.6",
      orchestrator: "github-copilot/claude-opus-4.6",
    },
    techStack: {
      frontend: "none",
      backend: "none",
      database: "none",
      cloud: "none",
      iac: "none",
      testing: { unitTestFrontend: "", unitTestBackend: "", e2eCommand: "" },
    },
    mcpServers: ["memory"],
  })

  // Validation
  const canSave = createMemo(() => {
    if (!config.project.name.trim()) return false
    const hasAgents = AGENT_TYPES.some((a) => (config.agents as any)[a.key]) || config.agents.developers.length > 0
    if (!hasAgents) return false
    if (!config.models.developer || !config.models.small) return false
    return true
  })

  // Load existing config or auto-detect
  onMount(async () => {
    try {
      const base = server.current?.http.url || ""
      const dir = props.directory

      // Try loading existing config first
      const configRes = await fetch(`${base}/api/team/config?dir=${encodeURIComponent(dir)}`, { headers: authHeaders() })
      if (configRes.ok) {
        const data = await configRes.json()
        if (data.found && data.config) {
          const c = data.config
          if (c.project) setConfig("project", c.project)
          if (c.agents) setConfig("agents", c.agents)
          if (c.models) setConfig("models", c.models)
          if (c.techStack) setConfig("techStack", c.techStack)
          if (c.mcpServers) setConfig("mcpServers", c.mcpServers)
          setDetecting(false)
          return
        }
      }

      // No existing config — auto-detect
      const res = await fetch(`${base}/api/team/detect`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ directory: dir }),
      })
      if (!res.ok) { setDetecting(false); return }
      const result = await res.json()
      const detectedFields: Record<string, boolean> = {}

      if (result.project) {
        if (result.project.name) { setConfig("project", "name", result.project.name); detectedFields["project.name"] = true }
        if (result.project.org) { setConfig("project", "org", result.project.org); detectedFields["project.org"] = true }
        if (result.project.provider) { setConfig("project", "provider", result.project.provider); detectedFields["project.provider"] = true }
        if (result.project.adoProject) { setConfig("project", "adoProject", result.project.adoProject); detectedFields["project.adoProject"] = true }
        if (result.project.repos && result.project.repos.length > 0) {
          setConfig("project", "repos", result.project.repos as Repo[])
          detectedFields["project.repos"] = true
        }
      }
      if (result.techStack) {
        if (result.techStack.frontend) { setConfig("techStack", "frontend", result.techStack.frontend); detectedFields["techStack.frontend"] = true }
        if (result.techStack.backend) { setConfig("techStack", "backend", result.techStack.backend); detectedFields["techStack.backend"] = true }
        if (result.techStack.database) { setConfig("techStack", "database", result.techStack.database); detectedFields["techStack.database"] = true }
        if (result.techStack.cloud) { setConfig("techStack", "cloud", result.techStack.cloud); detectedFields["techStack.cloud"] = true }
        if (result.techStack.iac) { setConfig("techStack", "iac", result.techStack.iac); detectedFields["techStack.iac"] = true }
        if (result.techStack.testing) {
          const t = result.techStack.testing
          if (t.unitTestFrontend) { setConfig("techStack", "testing", "unitTestFrontend", t.unitTestFrontend); detectedFields["techStack.testing.unitTestFrontend"] = true }
          if (t.unitTestBackend) { setConfig("techStack", "testing", "unitTestBackend", t.unitTestBackend); detectedFields["techStack.testing.unitTestBackend"] = true }
          if (t.e2eCommand) { setConfig("techStack", "testing", "e2eCommand", t.e2eCommand); detectedFields["techStack.testing.e2eCommand"] = true }
        }
      }

      setDetected(detectedFields)
      // Load agent file statuses
      await loadAgentFileStatus()
    } catch (_) {
      // Detection failed, use defaults
    } finally {
      setDetecting(false)
    }
  })

  async function loadAgentFileStatus() {
    try {
      const base = server.current?.http.url || ""
      const res = await fetch(`${base}/api/team/agent-files?dir=${encodeURIComponent(props.directory)}`, { headers: authHeaders() })
      if (res.ok) {
        const data = await res.json()
        const status: Record<string, boolean> = {}
        for (const f of data.files) status[f.filename] = f.isGenerated
        setAgentFileStatus(status)
      }
    } catch (_) {}
  }

  async function handleSave() {
    setGenerating(true)
    setError("")
    try {
      const base = server.current?.http.url || ""
      const res = await fetch(`${base}/api/team/generate`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ directory: props.directory, config }),
      })
      if (res.ok) {
        setGenerated(true)
      } else {
        const data = await res.json().catch(() => ({ error: "Unknown error" }))
        setError(data.error || "Failed to save")
      }
    } catch (_) {
      setError("Network error — could not save")
    } finally {
      setGenerating(false)
    }
  }

  return (
    <Dialog size="x-large" transition>
      <div class="flex flex-col h-full">
        {/* Header */}
        <div class="shrink-0 border-b border-border-base px-6 py-4 flex items-center justify-between">
          <div class="flex items-center gap-3">
            <h2 class="text-16-medium text-text-strong">Team Configuration</h2>
            <span class="text-12-regular text-text-weak bg-surface-raised-base px-2 py-0.5 rounded font-mono">{projectName()}</span>
          </div>
          <span class="text-11-regular text-text-weak font-mono truncate max-w-[300px]">{props.directory}</span>
        </div>

        {/* Loading */}
        <Show when={detecting()}>
          <div class="flex-1 flex items-center justify-center">
            <div class="flex flex-col items-center gap-3">
              <div class="w-6 h-6 rounded-full border-2 border-brand-base border-t-transparent animate-spin" />
              <p class="text-13-regular text-text-weak">Detecting project settings...</p>
            </div>
          </div>
        </Show>

        {/* Success */}
        <Show when={generated()}>
          <div class="flex-1 flex items-center justify-center">
            <div class="flex flex-col items-center gap-4">
              <div class="w-12 h-12 rounded-full bg-icon-success-base flex items-center justify-center">
                <svg width="24" height="24" viewBox="0 0 20 20" fill="none"><path d="M4.58341 10.4165L8.33341 14.1665L15.4167 5.83317" stroke="white" stroke-width="2" stroke-linecap="square" /></svg>
              </div>
              <h3 class="text-16-medium text-text-strong">Team saved successfully</h3>
              <p class="text-13-regular text-text-weak text-center max-w-sm">
                Agent files created in <code class="text-brand-base font-mono">.opencode/agents/</code>
              </p>
              <Button size="small" onClick={() => dialog.close()}>Done</Button>
            </div>
          </div>
        </Show>

        {/* Main content with tabs */}
        <Show when={!detecting() && !generated() && !editingFile()}>
          <Tabs orientation="horizontal" variant="normal" defaultValue="project" class="flex-1 flex flex-col min-h-0">
            <div class="shrink-0 border-b border-border-base px-6">
              <Tabs.List>
                <Tabs.Trigger value="project">Project</Tabs.Trigger>
                <Tabs.Trigger value="techstack">Tech Stack</Tabs.Trigger>
                <Tabs.Trigger value="agents">Agents</Tabs.Trigger>
                <Tabs.Trigger value="models">Models</Tabs.Trigger>
                <Tabs.Trigger value="workflows">Workflows</Tabs.Trigger>
                <Tabs.Trigger value="mcp">MCP Servers</Tabs.Trigger>
              </Tabs.List>
            </div>

            <div class="flex-1 overflow-y-auto p-6">
              <Tabs.Content value="project">
                <TabProject config={config} setConfig={setConfig} detected={detected()} />
              </Tabs.Content>
              <Tabs.Content value="techstack">
                <TabTechStack config={config} setConfig={setConfig} detected={detected()} />
              </Tabs.Content>
              <Tabs.Content value="agents">
                <TabAgents config={config} setConfig={setConfig} directory={props.directory} editingFile={editingFile()} setEditingFile={setEditingFile} agentFileStatus={agentFileStatus()} />
              </Tabs.Content>
              <Tabs.Content value="models">
                <TabModels config={config} setConfig={setConfig} />
              </Tabs.Content>
              <Tabs.Content value="mcp">
                <TabMcpServers config={config} setConfig={setConfig} />
              </Tabs.Content>
              <Tabs.Content value="workflows">
                <TabWorkflows directory={props.directory} />
              </Tabs.Content>
            </div>

            {/* Footer with save */}
            <div class="shrink-0 border-t border-border-base px-6 py-3 flex items-center justify-between">
              <div class="flex items-center gap-3">
                <Show when={error()}>
                  <span class="text-12-regular text-icon-critical-base">{error()}</span>
                </Show>
                <Show when={!canSave()}>
                  <span class="text-12-regular text-text-weak">
                    {!config.project.name.trim() ? "Project name is required" :
                     !(AGENT_TYPES.some((a) => (config.agents as any)[a.key]) || config.agents.developers.length > 0) ? "Add at least one agent" :
                     "Select developer and small models"}
                  </span>
                </Show>
              </div>
              <div class="flex items-center gap-2">
                <Button variant="ghost" size="small" onClick={() => dialog.close()}>Cancel</Button>
                <Button size="small" onClick={handleSave} disabled={!canSave() || generating()}>
                  {generating() ? "Saving..." : "Save"}
                </Button>
              </div>
            </div>
          </Tabs>
        </Show>

        {/* Agent file editor */}
        <Show when={editingFile()}>
          <AgentFileEditor
            directory={props.directory}
            filename={editingFile()!}
            onClose={() => { setEditingFile(null); loadAgentFileStatus() }}
          />
        </Show>
      </div>
    </Dialog>
  )
}
