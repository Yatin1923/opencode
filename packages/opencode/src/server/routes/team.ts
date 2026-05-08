import { Hono } from "hono"
import * as fs from "node:fs"
import * as path from "node:path"
import { execSync } from "node:child_process"

/**
 * Team API Routes
 * Provides auto-detection and generation of AI team configuration files.
 */

// ============ Detection Logic ============

function detectProjectName(dir: string): string | null {
  const pkgPath = path.join(dir, "package.json")
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"))
      if (pkg.name && !pkg.name.startsWith("@")) return pkg.name
      if (pkg.name && pkg.name.startsWith("@")) return pkg.name.split("/").pop() || null
    } catch (_) {}
  }
  return path.basename(dir)
}

function gitExec(cmd: string, cwd: string): string | null {
  try {
    return execSync(cmd, { cwd, encoding: "utf-8", timeout: 5000 }).trim()
  } catch (_) {
    return null
  }
}

function detectGitInfo(dir: string) {
  const remoteUrl = gitExec("git remote get-url origin", dir)
  if (!remoteUrl) return null

  // Azure DevOps
  let match = remoteUrl.match(/dev\.azure\.com[/:](?:v3\/)?([^/]+)\/([^/]+)/)
  if (match) return { provider: "azure-devops", org: match[1], adoProject: match[2] }
  match = remoteUrl.match(/([^@]+)@dev\.azure\.com\/([^/]+)\/([^/]+)/)
  if (match) return { provider: "azure-devops", org: match[2], adoProject: match[3] }
  match = remoteUrl.match(/([^.]+)\.visualstudio\.com\/([^/]+)/)
  if (match) return { provider: "azure-devops", org: match[1], adoProject: match[2] }

  // GitHub
  match = remoteUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)/)
  if (match) return { provider: "github", org: match[1] }

  // GitLab
  match = remoteUrl.match(/gitlab\.com[/:]([^/]+)\/([^/.]+)/)
  if (match) return { provider: "gitlab", org: match[1] }

  // Bitbucket
  match = remoteUrl.match(/bitbucket\.org[/:]([^/]+)\/([^/.]+)/)
  if (match) return { provider: "bitbucket", org: match[1] }

  return null
}

function readAllDeps(dir: string): Record<string, string> {
  const pkgPath = path.join(dir, "package.json")
  if (!fs.existsSync(pkgPath)) return {}
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"))
    return { ...pkg.dependencies, ...pkg.devDependencies }
  } catch (_) {
    return {}
  }
}

function globExists(dir: string, pattern: string): boolean {
  // Simple check for common patterns
  try {
    const entries = fs.readdirSync(dir, { recursive: true }) as string[]
    const ext = pattern.replace("**/*", "").replace("*", "")
    return entries.some((e) => e.toString().endsWith(ext))
  } catch (_) {
    return false
  }
}

function detectTechStack(dir: string) {
  const result: any = { frontend: null, backend: null, database: null, cloud: null, iac: null }
  const deps = readAllDeps(dir)
  const depKeys = Object.keys(deps)

  // Frontend
  if (deps["next"]) result.frontend = "nextjs-typescript"
  else if (deps["react"]) result.frontend = "react-typescript"
  else if (deps["vue"] || deps["@vue/core"]) result.frontend = "vue-typescript"
  else if (deps["@angular/core"]) result.frontend = "angular"
  else if (deps["svelte"]) result.frontend = "svelte-typescript"

  // Backend
  if (globExists(dir, "*.csproj")) result.backend = "dotnet"
  if (deps["express"]) result.backend = result.backend || "node-express"
  if (deps["fastify"]) result.backend = "node-fastify"
  if (fs.existsSync(path.join(dir, "go.mod"))) result.backend = "go"
  if (fs.existsSync(path.join(dir, "requirements.txt"))) {
    const reqs = fs.readFileSync(path.join(dir, "requirements.txt"), "utf-8").toLowerCase()
    if (reqs.includes("fastapi")) result.backend = "python-fastapi"
    else if (reqs.includes("django")) result.backend = "python-django"
  }
  if (fs.existsSync(path.join(dir, "pom.xml"))) result.backend = result.backend || "java-spring"

  // Database
  if (deps["mssql"] || deps["tedious"]) result.database = "sqlserver"
  else if (deps["pg"] || deps["pg-promise"]) result.database = "postgresql"
  else if (deps["mysql2"] || deps["mysql"]) result.database = "mysql"
  else if (deps["mongoose"] || deps["mongodb"]) result.database = "mongodb"
  else if (deps["better-sqlite3"] || deps["sqlite3"]) result.database = "sqlite"
  else if (deps["@aws-sdk/client-dynamodb"]) result.database = "dynamodb"

  // Cloud
  if (depKeys.some((d) => d.startsWith("@azure/"))) result.cloud = "azure"
  else if (depKeys.some((d) => d.startsWith("@aws-sdk/"))) result.cloud = "aws"
  else if (depKeys.some((d) => d.startsWith("@google-cloud/"))) result.cloud = "gcp"
  if (fs.existsSync(path.join(dir, "azure-pipelines.yml"))) result.cloud = result.cloud || "azure"

  // IaC
  if (globExists(dir, "*.tf")) result.iac = "terraform"
  else if (globExists(dir, "*.bicep")) result.iac = "bicep"
  else if (fs.existsSync(path.join(dir, "cdk.json"))) result.iac = "cdk"
  else if (fs.existsSync(path.join(dir, "Pulumi.yaml"))) result.iac = "pulumi"

  return result
}

function detectTesting(dir: string, deps: Record<string, string>) {
  const result: any = { unitTestFrontend: null, unitTestBackend: null, e2eCommand: null }

  if (deps["vitest"]) result.unitTestFrontend = "Vitest"
  else if (deps["jest"]) result.unitTestFrontend = "Jest"
  else if (deps["mocha"]) result.unitTestFrontend = "Mocha"

  if (deps["xunit"] || globExists(dir, "*.csproj")) result.unitTestBackend = "xUnit"
  else if (deps["pytest"] || fs.existsSync(path.join(dir, "pytest.ini"))) result.unitTestBackend = "pytest"
  else result.unitTestBackend = result.unitTestFrontend

  if (deps["@playwright/test"]) result.e2eCommand = "npx playwright test"
  else if (deps["cypress"]) result.e2eCommand = "npx cypress run"

  return result
}

function detectRepos(dir: string) {
  const repos: any[] = []
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith(".") || ["node_modules", "dist", "build", "out"].includes(entry.name)) continue
      const subDir = path.join(dir, entry.name)
      const hasProject =
        fs.existsSync(path.join(subDir, "package.json")) ||
        fs.existsSync(path.join(subDir, "go.mod")) ||
        fs.existsSync(path.join(subDir, "pom.xml")) ||
        globExists(subDir, "*.csproj")
      if (hasProject) {
        const stack = detectTechStack(subDir)
        const defaultBranch = gitExec("git symbolic-ref --short HEAD", subDir) || "main"
        repos.push({
          name: entry.name,
          description: entry.name,
          techStack: [stack.frontend, stack.backend].filter(Boolean).join(" + ") || "Unknown",
          defaultBranch,
        })
      }
    }
  } catch (_) {}

  // If no sub-repos, treat root as single repo
  if (repos.length === 0) {
    const stack = detectTechStack(dir)
    const defaultBranch = gitExec("git symbolic-ref --short HEAD", dir) || "main"
    repos.push({
      name: path.basename(dir),
      description: path.basename(dir),
      techStack: [stack.frontend, stack.backend].filter(Boolean).join(" + ") || "Unknown",
      defaultBranch,
    })
  }

  return repos
}

function detectPrReviewer(dir: string): string | null {
  const codeownersPath = path.join(dir, "CODEOWNERS")
  const ghCodeownersPath = path.join(dir, ".github", "CODEOWNERS")
  const filePath = fs.existsSync(codeownersPath) ? codeownersPath : fs.existsSync(ghCodeownersPath) ? ghCodeownersPath : null
  if (!filePath) return null
  try {
    const content = fs.readFileSync(filePath, "utf-8")
    const match = content.match(/^\*\s+(.+)$/m)
    if (match) return match[1].trim()
  } catch (_) {}
  return null
}

// ============ Generation Logic ============

const GENERATED_HEADER = "<!-- Generated by OpenCode Team -->"

function generateOpencodeJson(config: any, dir: string) {
  const opcConfig: any = {
    $schema: "https://opencode.ai/config.json",
    model: config.models.developer,
    small_model: config.models.small,
    default_agent: config.agents.enableOrchestrator ? "orchestrator" : undefined,
    instructions: [".opencode/rules/global.md"],
    share: "manual",
    compaction: { auto: true, prune: true },
    mcp: {},
  }

  for (const server of config.mcpServers || []) {
    switch (server) {
      case "azure-devops":
        opcConfig.mcp["azure-devops"] = {
          type: "local",
          command: ["npx", "-y", "@azure-devops/mcp", config.project.org, "-p", config.project.adoProject || config.project.name, "-d", "core", "work-items", "repositories", "-a", "pat"],
          env: { PERSONAL_ACCESS_TOKEN: "YOUR_BASE64_ENCODED_PAT_HERE" },
        }
        break
      case "memory":
        opcConfig.mcp.memory = { type: "local", command: ["npx", "-y", "@modelcontextprotocol/server-memory"], enabled: true, env: { MEMORY_FILE_PATH: ".opencode/memory.jsonl" } }
        break
      case "playwright":
        opcConfig.mcp.playwright = { type: "local", command: ["npx", "@playwright/mcp@latest"], enabled: true }
        break
      case "sequential-thinking":
        opcConfig.mcp["sequential-thinking"] = { type: "local", command: ["npx", "-y", "@modelcontextprotocol/server-sequential-thinking"], enabled: true }
        break
      case "github-mcp":
        opcConfig.mcp.github = { type: "local", command: ["npx", "-y", "@modelcontextprotocol/server-github"], enabled: true, env: { GITHUB_TOKEN: "YOUR_GITHUB_TOKEN_HERE" } }
        break
      case "teams-mcp":
        opcConfig.mcp["teams-mcp"] = { type: "local", command: ["npx", "-y", "@floriscornel/teams-mcp@latest"], enabled: true }
        break
    }
  }

  fs.writeFileSync(path.join(dir, "opencode.json"), JSON.stringify(opcConfig, null, 2))
}

function generateGlobalRules(config: any, rulesDir: string) {
  const p = config.project
  let reposTable = "| Directory | Tech Stack | Description |\n|-----------|-----------|-------------|\n"
  for (const repo of p.repos) {
    reposTable += `| \`${repo.name}/\` | ${repo.techStack || "N/A"} | ${repo.description || repo.name} |\n`
  }

  let providerSection = ""
  if (p.provider === "azure-devops") {
    providerSection = `## Organization\n- **Azure DevOps**: Organization \`${p.org}\`, Project \`${p.adoProject || p.name}\`\n${p.prReviewer ? `- **PR Reviewer**: ${p.prReviewer}` : ""}`
  } else if (p.provider === "github") {
    providerSection = `## Organization\n- **GitHub**: \`${p.org}/${p.name}\`\n${p.prReviewer ? `- **PR Reviewer**: ${p.prReviewer}` : ""}`
  }

  const content = `${GENERATED_HEADER}
# ${p.name} - Project Rules

${providerSection}

## Projects Overview

${reposTable}

## Cross-Project Conventions

### Branch Naming
- Features: \`feature/{story-id}-{short-kebab-description}\`
- Bugfixes: \`bugfix/{defect-id}-{short-kebab-description}\`

### PR Conventions
- Link work item ID in PR description.
${p.prReviewer ? `- Assign reviewer: ${p.prReviewer}` : ""}

## Security & Compliance
- Never commit secrets - No API keys, connection strings, or credentials in code
- Use environment variables for configuration that differs per environment

## Agent Communication Standards
- Always report: what was built/fixed, which files were modified, and any assumptions made
- For PRs: provide clear summary of changes for code review
`

  fs.writeFileSync(path.join(rulesDir, "global.md"), content)
}

function generateAgent(agentsDir: string, filename: string, frontmatter: string, body: string) {
  // Remove lines with empty scalar values (e.g. "model: ") but keep YAML mapping parents like "permission:"
  const mappingKeys = new Set(["permission", "bash", "tools", "edit"])
  const cleanedFrontmatter = frontmatter.split("\n").filter((line) => {
    const match = line.match(/^([a-zA-Z_]+):\s*$/)
    if (!match) return true
    return mappingKeys.has(match[1])
  }).join("\n")
  const content = `---\n# Generated by OpenCode Team\n${cleanedFrontmatter}\n---\n\n${body}\n`
  fs.writeFileSync(path.join(agentsDir, filename), content)
}

function generateOrchestrator(config: any, agentsDir: string) {
  const devNames = config.agents.developers.map((d: any, i: number) => `\`@developer-${i + 1}\` (${d.name})`).join(", ")
  const frontmatter = `description: Orchestrator - Tech Lead that reads stories, plans, delegates, and raises PRs.
mode: primary
model: ${config.models.orchestrator || config.models.escalation || "github-copilot/claude-opus-4.6"}
steps: 50
color: "#2A9D8F"
permission:
  edit: deny
  bash:
    "*": deny
    "git *": allow`

  const body = `You are the **Orchestrator** for the ${config.project.name} project. You do NOT write code yourself. You plan, delegate, and orchestrate.

## Your Team
- Developers: ${devNames}
${config.agents.enablePlanner ? "- Planner: `@planner` - Creates implementation plans" : ""}
${config.agents.enableSeniorDev ? "- Senior Developer: `@senior-developer` - Handles complex/escalated tasks" : ""}
${config.agents.enableTestEngineer ? "- Test Engineer: `@test-engineer` - Runs tests and validates" : ""}
${config.agents.enableCodeReviewer ? "- Code Reviewer: `@code-reviewer` - Reviews code quality" : ""}
${config.agents.enableSecurityScanner ? "- Security Scanner: `@security-scanner` - Checks for vulnerabilities" : ""}

## Workflow
1. Receive work (story/task/bug)
2. Assess complexity (FAST mode for simple, FULL mode for complex)
3. Create feature branch
4. Delegate to developers in parallel
5. Run tests via test engineer
6. Get code reviewed
7. Create PR

## Rules
- Never write code yourself - always delegate
- Create separate PRs for each repository
- Ask user confirmation before creating PRs
- Maximum 3 test-fix loops before escalating`

  generateAgent(agentsDir, "orchestrator.md", frontmatter, body)
}

function generatePlanner(config: any, agentsDir: string) {
  const frontmatter = `description: Planner - Analyzes stories and creates detailed implementation plans.
mode: subagent
model: ${config.models.escalation}
permission:
  edit: deny
  bash: deny`

  const body = `You are the **Planner** for the ${config.project.name} project. You analyze requirements and create implementation plans.

## Your Job
- Read stories/tasks/requirements carefully
- Ask up to 3 clarifying questions if critical info is missing (unless in Quick mode)
- Create a detailed implementation plan including:
  - Files to create/modify
  - Implementation approach
  - Testing strategy
  - Potential risks

## Pipeline Mode
When invoked as part of a pipeline workflow:
- Your output will be passed to the Developer Team as context
- The Developer should NOT need to re-navigate the codebase. Include real code excerpts (not just paths) so they can implement directly.
- Your final assistant message MUST end with a fenced \`json handoff\` block (the orchestrator parses this). Schema:

\`\`\`json handoff
{
  "stage": "planner",
  "summary": "<what needs to be done>",
  "approach": "<high-level approach>",
  "filesToModify": [{ "path": "src/foo.ts", "purpose": "...", "lineStart": 10, "lineEnd": 45, "excerpt": "<actual code, <=150 lines>" }],
  "filesToCreate": [{ "path": "src/bar.ts", "purpose": "...", "skeleton": "<starter content>" }],
  "references": [{ "path": "src/types.ts", "symbol": "User", "lineStart": 5, "lineEnd": 20, "excerpt": "<actual code>" }],
  "steps": ["<concrete step 1>", "<concrete step 2>"],
  "testing": "<how to verify>",
  "risks": ["..."],
  "openQuestions": ["..."]
}
\`\`\`

- Cap each excerpt at ~150 lines. Use \`references\` for read-only context the developer needs but should not modify.
- In **Quick mode**: Do NOT ask questions. Make reasonable assumptions and proceed immediately with the plan.
- In **Full mode**: You may ask clarifying questions. The user will approve your plan before developers start.

### Need clarification first?

If you cannot produce a complete plan because you need answers from the user, end your message with a fenced \`handoff_question\` block (NOT the json one) and stop. Do NOT emit a \`json handoff\` block until all questions are resolved — emitting it ends your turn and marks the stage Done.

\`\`\`handoff_question
1. <your question>
2. <your question>
\`\`\`

The pipeline will pause and the user will reply in the chat. Your session will resume automatically once they answer.

## Rules
- Do NOT write code
- Do NOT make changes
- Focus on planning only
- Be concise and actionable`

  generateAgent(agentsDir, "planner.md", frontmatter, body)
}

function generateDeveloper(config: any, agentsDir: string, dev: any, index: number) {
  const frontmatter = `description: Developer ${dev.name} - ${dev.specialization || "Full-stack"} developer agent.
mode: subagent
model: ${config.models.developer}
permission:
  edit: allow
  bash:
    "*": allow`

  const body = `You are **${dev.name}**, a ${dev.specialization || "full-stack"} developer on the ${config.project.name} team.

## Your Job
- Implement features, fix bugs, and write clean code
- Follow existing project patterns and conventions
- Write tests for your changes
- Report what you built and which files were modified

## Rules
- Read the project's AGENTS.md for conventions
- Follow the branch naming convention
- Never push directly - the orchestrator handles git operations
- If stuck after 2 attempts, escalate to senior developer`

  generateAgent(agentsDir, `developer-${index}.md`, frontmatter, body)
}

function generateSeniorDeveloper(config: any, agentsDir: string) {
  const frontmatter = `description: Senior Developer - Handles complex tasks and escalations.
mode: subagent
model: ${config.models.escalation}
permission:
  edit: allow
  bash:
    "*": allow`

  const devNames = config.agents.developers.map((d: any, i: number) => `\`@developer-${i + 1}\` (${d.name})`).join(", ")
  const body = `You are the **Senior Developer** on the ${config.project.name} team. You handle complex tasks and serve as the Developer Team Lead in pipeline workflows.

## Your Job
- Solve complex architectural problems
- Debug difficult issues
- Provide guidance on implementation approaches
- Handle escalated tasks from developers

## Pipeline Mode (Developer Team Lead)
When invoked as the Developer Team lead in a pipeline:
- You receive the Planner's structured handoff (summary, files-to-modify with excerpts, steps, references) as context
- **Trust the planner's excerpts** — do NOT re-read those files unless you need information beyond what's shown
- Delegate subtasks to your team members: ${devNames || "available developers"}
- Coordinate parallel work and merge results
- Your final message MUST end with a fenced \`json handoff\` block summarizing what was built:

\`\`\`json handoff
{
  "stage": "developer",
  "summary": "<what was implemented>",
  "filesChanged": [{ "path": "src/foo.ts", "change": "modified", "summary": "added X" }],
  "steps": ["<actual actions taken>"],
  "testing": "<how to verify; commands to run>",
  "risks": ["..."],
  "openQuestions": ["..."]
}
\`\`\`

If you need clarification before you can implement, end with a \`handoff_question\` fenced block instead and stop. The pipeline pauses until the user replies.

## Rules
- Think carefully before implementing
- Consider edge cases and performance implications
- If you can't solve it in 2 attempts, report blockers to the user`

  generateAgent(agentsDir, "senior-developer.md", frontmatter, body)
}

function generateTestEngineer(config: any, agentsDir: string) {
  const ts = config.techStack?.testing || {}
  const frontmatter = `description: Test Engineer - Runs tests and validates changes.
mode: subagent
model: ${config.models.small}
permission:
  edit: allow
  bash:
    "*": allow`

  const body = `You are the **Test Engineer** on the ${config.project.name} team. You ensure code quality through testing. You serve as the Test Team Lead in pipeline workflows.

## Testing Commands
${ts.unitTestFrontend ? `- Frontend unit tests: ${ts.unitTestFrontend}` : ""}
${ts.unitTestBackend ? `- Backend unit tests: ${ts.unitTestBackend}` : ""}
${ts.e2eCommand ? `- E2E tests: ${ts.e2eCommand}` : ""}

## Your Job
- Run relevant tests for changed files
- Report pass/fail results clearly
- If tests fail, report which tests and why
- Write new tests if coverage is missing

## Pipeline Mode (Test Team Lead)
When invoked as the Test Team lead in a pipeline:
- You receive the Developer Team's structured handoff (filesChanged, testing notes) as context
- Run all relevant test suites for the changed code
- Your final message MUST end with a fenced \`json handoff\` block:

\`\`\`json handoff
{
  "stage": "test",
  "summary": "<test run summary>",
  "testResults": { "passed": 0, "failed": 0, "failures": ["<test name: error>"] },
  "testing": "<commands run>",
  "risks": ["..."]
}
\`\`\`

If you need clarification before running tests, end with a \`handoff_question\` fenced block instead. The pipeline pauses until the user replies.

- If tests fail, report back with details (the pipeline will pause for user decision)

## Rules
- Always run tests before reporting success
- Report exact error messages for failures
- Don't fix code yourself - report failures back`

  generateAgent(agentsDir, "test-engineer.md", frontmatter, body)
}

function generateCodeReviewer(config: any, agentsDir: string) {
  const frontmatter = `description: Code Reviewer - Reviews code for quality and best practices.
mode: subagent
model: ${config.models.developer}
permission:
  edit: deny
  bash:
    "*": deny
    "git diff*": allow
    "git log*": allow`

  const body = `You are the **Code Reviewer** on the ${config.project.name} team. You review code for quality and serve as the PR Team Lead in pipeline workflows.

## Your Job
- Review changed files for bugs, security issues, and best practices
- Check code follows project conventions
- Verify error handling and edge cases
- Check for performance issues

## Pipeline Mode (PR Team Lead)
When invoked as the PR Team lead in a pipeline:
- You receive the planner/developer/test handoffs as context (summary, filesChanged, testResults)
- Review all changed files via \`git diff\`
- If review passes: create the PR with a summary of changes
- If review has critical findings: report them (pipeline pauses for user decision)
- Your final message MUST end with a fenced \`json handoff\` block:

\`\`\`json handoff
{
  "stage": "pr",
  "summary": "<review outcome and PR status>",
  "risks": ["<critical findings, if any>"],
  "openQuestions": ["..."]
}
\`\`\`

If you need clarification before approving the PR, end with a \`handoff_question\` fenced block instead. The pipeline pauses until the user replies.
${config.project.prReviewer ? `- Assign reviewer: ${config.project.prReviewer}` : ""}

## Rules
- Don't make changes yourself
- Rate findings as: critical, warning, or suggestion
- Critical findings block the PR
- Be constructive and specific`

  generateAgent(agentsDir, "code-reviewer.md", frontmatter, body)
}

function generateSecurityScanner(config: any, agentsDir: string) {
  const frontmatter = `description: Security Scanner - Checks for security vulnerabilities.
mode: subagent
model: ${config.models.small}
permission:
  edit: deny
  bash:
    "*": deny
    "grep *": allow`

  const body = `You are the **Security Scanner** on the ${config.project.name} team. You identify security vulnerabilities.

## Your Job
- Check for hardcoded secrets and credentials
- Identify SQL injection, XSS, and other vulnerabilities
- Check authentication and authorization issues
- Review dependency security

## Rules
- Critical security findings BLOCK the PR
- Be specific about the vulnerability and how to fix it
- Don't make changes yourself`

  generateAgent(agentsDir, "security-scanner.md", frontmatter, body)
}

function generateDbAgent(config: any, agentsDir: string) {
  const frontmatter = `description: Database Agent - Handles migrations and schema changes.
mode: subagent
model: ${config.models.developer}
permission:
  edit: allow
  bash:
    "*": allow`

  const body = `You are the **Database Agent** on the ${config.project.name} team. You handle database schema changes and migrations.

## Your Job
- Create database migrations
- Update models/entities
- Ensure data integrity
- Handle rollback strategies`

  generateAgent(agentsDir, "db-agent.md", frontmatter, body)
}

function generateInfraAgent(config: any, agentsDir: string) {
  const frontmatter = `description: Infrastructure Agent - Manages IaC and deployment configs.
mode: subagent
model: ${config.models.developer}
permission:
  edit: allow
  bash:
    "*": allow`

  const body = `You are the **Infrastructure Agent** on the ${config.project.name} team. You manage infrastructure as code.

## Your Job
- Write and update ${config.techStack?.iac || "infrastructure"} configurations
- Manage deployment pipelines
- Handle environment configurations`

  generateAgent(agentsDir, "infra-agent.md", frontmatter, body)
}

function generateDocAgent(config: any, agentsDir: string) {
  const frontmatter = `description: Documentation Agent - Writes and maintains documentation.
mode: subagent
model: ${config.models.small}
permission:
  edit: allow
  bash: deny`

  const body = `You are the **Documentation Agent** on the ${config.project.name} team. You write clear, comprehensive documentation.

## Your Job
- Write API documentation
- Update README files
- Document architecture decisions
- Create onboarding guides`

  generateAgent(agentsDir, "doc-agent.md", frontmatter, body)
}

function generateRefactorAgent(config: any, agentsDir: string) {
  const frontmatter = `description: Refactor Agent - Improves code structure and readability.
mode: subagent
model: ${config.models.developer}
permission:
  edit: allow
  bash:
    "*": allow`

  const body = `You are the **Refactor Agent** on the ${config.project.name} team. You improve code quality without changing behavior.

## Your Job
- Extract common patterns into reusable functions
- Improve naming and code organization
- Remove dead code and duplication
- Ensure all tests still pass after changes`

  generateAgent(agentsDir, "refactor.md", frontmatter, body)
}

function generate(config: any, dir: string) {
  const opencodeDir = path.join(dir, ".opencode")
  const agentsDir = path.join(opencodeDir, "agents")
  const rulesDir = path.join(opencodeDir, "rules")

  fs.mkdirSync(agentsDir, { recursive: true })
  fs.mkdirSync(rulesDir, { recursive: true })

  // Clean old generated agent files before regenerating
  const existingAgents = fs.readdirSync(agentsDir).filter((f) => f.endsWith(".md"))
  for (const file of existingAgents) {
    const content = fs.readFileSync(path.join(agentsDir, file), "utf-8")
    if (content.startsWith(GENERATED_HEADER) || content.includes("# Generated by OpenCode Team")) {
      fs.unlinkSync(path.join(agentsDir, file))
    }
  }

  // Generate opencode.json
  generateOpencodeJson(config, dir)

  // Generate global rules
  generateGlobalRules(config, rulesDir)

  // Generate agents
  if (config.agents.enableOrchestrator) generateOrchestrator(config, agentsDir)
  if (config.agents.enablePlanner) generatePlanner(config, agentsDir)
  for (let i = 0; i < config.agents.developers.length; i++) {
    generateDeveloper(config, agentsDir, config.agents.developers[i], i + 1)
  }
  if (config.agents.enableSeniorDev) generateSeniorDeveloper(config, agentsDir)
  if (config.agents.enableTestEngineer) generateTestEngineer(config, agentsDir)
  if (config.agents.enableCodeReviewer) generateCodeReviewer(config, agentsDir)
  if (config.agents.enableSecurityScanner) generateSecurityScanner(config, agentsDir)
  if (config.agents.enableDbAgent) generateDbAgent(config, agentsDir)
  if (config.agents.enableInfraAgent) generateInfraAgent(config, agentsDir)
  if (config.agents.enableDocAgent) generateDocAgent(config, agentsDir)
  if (config.agents.enableRefactor) generateRefactorAgent(config, agentsDir)

  // Store full team config in .opencode/team.json for reliable reload
  fs.writeFileSync(path.join(opencodeDir, "team.json"), JSON.stringify(config, null, 2))

  // Auto-generate workflow.json if it doesn't exist.
  // Single orchestrator workflow — orchestrator delegates dynamically; pipeline stages
  // appear live as `task` tool calls fire from the orchestrator session.
  const workflowPath = path.join(opencodeDir, "workflow.json")
  if (!fs.existsSync(workflowPath)) {
    const devMembers = config.agents.developers.map((_: any, i: number) => `developer-${i + 1}.md`)
    const orchestratorMembers: string[] = []
    if (config.agents.enablePlanner) orchestratorMembers.push("planner.md")
    if (config.agents.enableSeniorDev) orchestratorMembers.push("senior-developer.md")
    orchestratorMembers.push(...devMembers)
    if (config.agents.enableTestEngineer) orchestratorMembers.push("test-engineer.md")
    if (config.agents.enableCodeReviewer) orchestratorMembers.push("code-reviewer.md")
    if (config.agents.enableSecurityScanner) orchestratorMembers.push("security-scanner.md")
    if (config.agents.enableDbAgent) orchestratorMembers.push("db-agent.md")
    if (config.agents.enableInfraAgent) orchestratorMembers.push("infra-agent.md")
    if (config.agents.enableDocAgent) orchestratorMembers.push("doc-agent.md")
    if (config.agents.enableRefactor) orchestratorMembers.push("refactor.md")

    const workflowConfig = {
      teams: [
        { id: "orchestrator", name: "Orchestrator", lead: "orchestrator.md", members: orchestratorMembers, icon: "compass" },
      ],
      workflows: [
        { id: "orchestrator", name: "Orchestrator", stages: ["orchestrator"], gates: {} },
      ],
      defaults: { workflow: "orchestrator", gates: {} },
    }
    fs.writeFileSync(workflowPath, JSON.stringify(workflowConfig, null, 2))
  }
}

// ============ Routes ============

export const TeamRoutes = () =>
  new Hono()
    .post("/detect", async (c) => {
      const body = await c.req.json().catch(() => ({}))
      const dir = body.directory || process.cwd()

      if (!fs.existsSync(dir)) {
        return c.json({ error: "Directory not found" }, 404)
      }

      const projectName = detectProjectName(dir)
      const gitInfo = detectGitInfo(dir)
      const repos = detectRepos(dir)
      const techStack = detectTechStack(dir)
      const deps = readAllDeps(dir)
      const testing = detectTesting(dir, deps)
      const prReviewer = detectPrReviewer(dir)

      return c.json({
        project: {
          name: projectName,
          provider: gitInfo?.provider || null,
          org: gitInfo?.org || null,
          adoProject: (gitInfo as any)?.adoProject || null,
          repos,
          prReviewer,
        },
        techStack: {
          ...techStack,
          testing,
        },
      })
    })
    .post("/generate", async (c) => {
      const body = await c.req.json()
      const dir = body.directory || process.cwd()
      const config = body.config

      if (!config) {
        return c.json({ error: "Missing config" }, 400)
      }
      if (!fs.existsSync(dir)) {
        return c.json({ error: "Directory not found" }, 404)
      }

      try {
        generate(config, dir)
        return c.json({ success: true, directory: dir })
      } catch (err: any) {
        return c.json({ error: err.message }, 500)
      }
    })
    .get("/status", async (c) => {
      const dir = c.req.query("dir") || process.cwd()
      const agentsDir = path.join(dir, ".opencode", "agents")
      const configured = fs.existsSync(agentsDir) && fs.readdirSync(agentsDir).length > 0
      return c.json({ configured })
    })
    .get("/config", async (c) => {
      const dir = c.req.query("dir") || process.cwd()
      const teamJsonPath = path.join(dir, ".opencode", "team.json")
      const opencodeJsonPath = path.join(dir, "opencode.json")

      // Primary: read from .opencode/team.json (saved by generate)
      if (fs.existsSync(teamJsonPath)) {
        try {
          const config = JSON.parse(fs.readFileSync(teamJsonPath, "utf-8"))
          return c.json({ found: true, config })
        } catch (_) {}
      }

      // Fallback: check if agents dir exists at all (legacy or manually created)
      const agentsDir = path.join(dir, ".opencode", "agents")
      if (!fs.existsSync(agentsDir)) return c.json({ found: false })
      const agentFiles = fs.readdirSync(agentsDir).filter((f) => f.endsWith(".md"))
      if (agentFiles.length === 0) return c.json({ found: false })

      // Reconstruct config from agent files (for projects set up before team key existed)
      const config: any = {
        project: { name: detectProjectName(dir) || "", org: "", provider: "none", adoProject: "", repos: detectRepos(dir), prReviewer: "", testerAssignee: "" },
        agents: {
          enableOrchestrator: false, enablePlanner: false, enableSeniorDev: false,
          enableTestEngineer: false, enableCodeReviewer: false, enableSecurityScanner: false,
          enableDbAgent: false, enableInfraAgent: false, enableDocAgent: false, enableRefactor: false,
          developers: [], seniorDevName: "Senior",
        },
        models: { developer: "", small: "", escalation: "", orchestrator: "" },
        techStack: { frontend: "none", backend: "none", database: "none", cloud: "none", iac: "none", testing: { unitTestFrontend: "", unitTestBackend: "", e2eCommand: "" } },
        mcpServers: [] as string[],
      }

      const fileToFlag: Record<string, string> = {
        "orchestrator.md": "enableOrchestrator", "planner.md": "enablePlanner", "senior-developer.md": "enableSeniorDev",
        "test-engineer.md": "enableTestEngineer", "code-reviewer.md": "enableCodeReviewer", "security-scanner.md": "enableSecurityScanner",
        "db-agent.md": "enableDbAgent", "infra-agent.md": "enableInfraAgent", "doc-agent.md": "enableDocAgent", "refactor.md": "enableRefactor",
      }

      for (const file of agentFiles) {
        if (fileToFlag[file]) config.agents[fileToFlag[file]] = true
        const devMatch = file.match(/^developer-(\d+)\.md$/)
        if (devMatch) {
          const content = fs.readFileSync(path.join(agentsDir, file), "utf-8")
          const nameMatch = content.match(/You are \*\*([^*]+)\*\*/)
          const specMatch = content.match(/a\s+([\w-]+(?:\s+[\w-]+)?)\s+developer on/)
          config.agents.developers.push({
            name: nameMatch ? nameMatch[1] : `Dev-${devMatch[1]}`,
            specialization: specMatch ? specMatch[1].charAt(0).toUpperCase() + specMatch[1].slice(1) : "Full-stack",
          })
        }
      }

      // Fill models and MCP from opencode.json
      if (fs.existsSync(opencodeJsonPath)) {
        try {
          const opc = JSON.parse(fs.readFileSync(opencodeJsonPath, "utf-8"))
          if (opc.model) config.models.developer = opc.model
          if (opc.small_model) config.models.small = opc.small_model
          if (opc.mcp) {
            const mcpMap: Record<string, string> = { memory: "memory", "azure-devops": "azure-devops", playwright: "playwright", "sequential-thinking": "sequential-thinking", github: "github-mcp", "teams-mcp": "teams-mcp" }
            for (const key of Object.keys(opc.mcp)) {
              if (mcpMap[key]) config.mcpServers.push(mcpMap[key])
            }
          }
        } catch (_) {}
      }

      const gitInfo = detectGitInfo(dir)
      if (gitInfo) {
        config.project.provider = gitInfo.provider
        config.project.org = gitInfo.org || ""
        if ((gitInfo as any).adoProject) config.project.adoProject = (gitInfo as any).adoProject
      }

      return c.json({ found: true, config })
    })
    .get("/agent-files", async (c) => {
      const dir = c.req.query("dir") || process.cwd()
      const agentsDir = path.join(dir, ".opencode", "agents")
      if (!fs.existsSync(agentsDir)) return c.json({ files: [] })
      const files = fs.readdirSync(agentsDir).filter((f) => f.endsWith(".md")).map((filename) => {
        const content = fs.readFileSync(path.join(agentsDir, filename), "utf-8")
        const isGenerated = content.includes("# Generated by OpenCode Team")
        return { filename, isGenerated, content }
      })
      return c.json({ files })
    })
    .get("/agent-file", async (c) => {
      const dir = c.req.query("dir") || process.cwd()
      const filename = c.req.query("filename")
      if (!filename) return c.json({ error: "Missing filename" }, 400)
      const filePath = path.join(dir, ".opencode", "agents", filename)
      if (!fs.existsSync(filePath)) return c.json({ error: "File not found" }, 404)
      const content = fs.readFileSync(filePath, "utf-8")
      const isGenerated = content.includes("# Generated by OpenCode Team")
      return c.json({ filename, content, isGenerated })
    })
    .put("/agent-file", async (c) => {
      const body = await c.req.json()
      const dir = body.directory || process.cwd()
      const filename = body.filename
      const content = body.content
      if (!filename || content === undefined) return c.json({ error: "Missing filename or content" }, 400)
      const agentsDir = path.join(dir, ".opencode", "agents")
      if (!fs.existsSync(agentsDir)) fs.mkdirSync(agentsDir, { recursive: true })
      // Strip generated marker so manual edits are protected from regeneration
      const cleaned = content.replace(/^# Generated by OpenCode Team\n?/m, "")
      fs.writeFileSync(path.join(agentsDir, filename), cleaned)
      return c.json({ success: true, isGenerated: false })
    })
