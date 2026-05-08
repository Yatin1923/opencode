import { Hono } from "hono"
import * as fs from "node:fs"
import * as path from "node:path"
import * as https from "node:https"

/**
 * Azure DevOps API Routes
 * Provides integration with Azure DevOps work items, sprints, branches, and PRs.
 */

// ============ Types ============

interface AdoConfig {
  org: string
  project: string
  team?: string
  defaultRepo?: string
}

interface AdoSecrets {
  pat: string
}

// ============ Config Helpers ============

function configPath(dir: string): string {
  return path.join(dir, ".opencode", "ado.json")
}

function secretsPath(dir: string): string {
  return path.join(dir, ".opencode", "ado-secrets.json")
}

function loadConfig(dir: string): AdoConfig | null {
  // First try dedicated ado.json
  const p = configPath(dir)
  if (fs.existsSync(p)) {
    try {
      return JSON.parse(fs.readFileSync(p, "utf-8"))
    } catch (_) {}
  }
  // Fallback: read from team.json
  const teamPath = path.join(dir, ".opencode", "team.json")
  if (fs.existsSync(teamPath)) {
    try {
      const team = JSON.parse(fs.readFileSync(teamPath, "utf-8"))
      if (team.project?.provider === "azure-devops" && team.project?.org) {
        return {
          org: team.project.org,
          project: team.project.adoProject || team.project.name || "",
          team: team.project.adoProject ? `${team.project.adoProject} Team` : undefined,
        }
      }
    } catch (_) {}
  }
  return null
}

function loadSecrets(dir: string): AdoSecrets | null {
  const p = secretsPath(dir)
  if (!fs.existsSync(p)) return null
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"))
  } catch (_) {
    return null
  }
}

function saveConfig(dir: string, config: AdoConfig) {
  const opencodeDir = path.join(dir, ".opencode")
  fs.mkdirSync(opencodeDir, { recursive: true })
  fs.writeFileSync(configPath(dir), JSON.stringify(config, null, 2))
}

function saveSecrets(dir: string, secrets: AdoSecrets) {
  const opencodeDir = path.join(dir, ".opencode")
  fs.mkdirSync(opencodeDir, { recursive: true })
  fs.writeFileSync(secretsPath(dir), JSON.stringify(secrets, null, 2))

  // Ensure ado-secrets.json is in .gitignore
  const gitignorePath = path.join(dir, ".gitignore")
  const secretsEntry = ".opencode/ado-secrets.json"
  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, "utf-8")
    if (!content.includes(secretsEntry)) {
      fs.appendFileSync(gitignorePath, `\n${secretsEntry}\n`)
    }
  } else {
    fs.writeFileSync(gitignorePath, `${secretsEntry}\n`)
  }
}

// ============ ADO API Client ============

function adoRequest(
  method: string,
  urlPath: string,
  config: AdoConfig,
  pat: string,
  body?: any,
): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const auth = Buffer.from(`:${pat}`).toString("base64")
    const separator = urlPath.includes("?") ? "&" : "?"
    const org = encodeURIComponent(config.org)
    const project = encodeURIComponent(config.project)
    const fullPath = `/${org}/${project}/${urlPath}${separator}api-version=7.1`

    const options: https.RequestOptions = {
      hostname: "dev.azure.com",
      path: fullPath,
      method,
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    }

    const req = https.request(options, (res) => {
      const chunks: Buffer[] = []
      res.on("data", (chunk) => chunks.push(chunk))
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf-8")
        try {
          resolve({ status: res.statusCode || 500, data: JSON.parse(raw) })
        } catch (_) {
          resolve({ status: res.statusCode || 500, data: raw })
        }
      })
    })

    req.on("error", reject)
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

function adoRequestRaw(
  method: string,
  fullUrlPath: string,
  pat: string,
  body?: any,
  contentType?: string,
): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const auth = Buffer.from(`:${pat}`).toString("base64")
    const url = new URL(fullUrlPath.startsWith("https://") ? fullUrlPath : `https://dev.azure.com${fullUrlPath}`)
    const separator = url.search ? "&" : "?"
    const pathWithVersion = `${url.pathname}${url.search}${separator}api-version=7.1`

    const options: https.RequestOptions = {
      hostname: url.hostname,
      path: pathWithVersion,
      method,
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": contentType || "application/json",
        Accept: "application/json",
      },
    }

    const req = https.request(options, (res) => {
      const chunks: Buffer[] = []
      res.on("data", (chunk) => chunks.push(chunk))
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf-8")
        try {
          resolve({ status: res.statusCode || 500, data: JSON.parse(raw) })
        } catch (_) {
          resolve({ status: res.statusCode || 500, data: raw })
        }
      })
    })

    req.on("error", reject)
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

// ============ Helpers ============

function mapWorkItem(item: any) {
  const fields = item.fields || {}
  const relations = item.relations || []
  const prCount = relations.filter(
    (r: any) => r.rel === "ArtifactLink" && (r.url || "").includes("PullRequestId"),
  ).length
  return {
    id: item.id,
    title: fields["System.Title"] || "Untitled",
    state: fields["System.State"] || "New",
    type: fields["System.WorkItemType"] || "User Story",
    assignedTo: fields["System.AssignedTo"]?.displayName || null,
    priority: fields["Microsoft.VSTS.Common.Priority"] || 4,
    storyPoints: fields["Microsoft.VSTS.Scheduling.StoryPoints"] || null,
    tags: fields["System.Tags"] || "",
    description: fields["System.Description"] || "",
    acceptanceCriteria: fields["Microsoft.VSTS.Common.AcceptanceCriteria"] || "",
    areaPath: fields["System.AreaPath"] || "",
    iterationPath: fields["System.IterationPath"] || "",
    url: item._links?.html?.href || item.url || "",
    prCount,
  }
}

function getConfigAndPat(dir: string): { config: AdoConfig; pat: string } | null {
  const config = loadConfig(dir)
  const secrets = loadSecrets(dir)
  if (!config || !secrets?.pat) return null
  return { config, pat: secrets.pat }
}

// ============ Routes ============

export const AdoRoutes = () =>
  new Hono()
    // Check ADO connection status
    .get("/status", async (c) => {
      const dir = c.req.query("dir") || process.cwd()
      const ctx = getConfigAndPat(dir)
      if (!ctx) return c.json({ connected: false, reason: "No config or PAT found" })

      try {
        const res = await adoRequestRaw("GET", `https://dev.azure.com/${ctx.config.org}/_apis/projects?$top=1`, ctx.pat)
        if (res.status === 200) return c.json({ connected: true, org: ctx.config.org, project: ctx.config.project })
        return c.json({ connected: false, reason: `ADO returned status ${res.status}` })
      } catch (err: any) {
        return c.json({ connected: false, reason: err.message })
      }
    })

    // Save ADO PAT + config
    .put("/settings", async (c) => {
      const dir = c.req.query("dir") || process.cwd()
      const body = await c.req.json().catch(() => null)
      if (!body) return c.json({ error: "Invalid JSON body" }, 400)

      const { pat } = body
      if (!pat) return c.json({ error: "PAT is required" }, 400)

      // If org/project provided, save them; otherwise read from team config
      let org = body.org
      let project = body.project
      let team = body.team
      if (!org || !project) {
        const existing = loadConfig(dir)
        if (existing) {
          org = org || existing.org
          project = project || existing.project
          team = team || existing.team
        }
      }
      if (!org || !project) return c.json({ error: "Could not determine org/project. Configure team settings first." }, 400)

      saveConfig(dir, { org, project, team: team || undefined, defaultRepo: body.defaultRepo || undefined })
      saveSecrets(dir, { pat })

      return c.json({ success: true })
    })

    // Load saved ADO config (without secrets)
    .get("/config", async (c) => {
      const dir = c.req.query("dir") || process.cwd()
      const config = loadConfig(dir)
      if (!config) return c.json({ found: false, connected: false })
      const secrets = loadSecrets(dir)
      const hasPat = !!secrets?.pat
      if (!hasPat) return c.json({ found: true, config: { org: config.org, project: config.project, team: config.team }, connected: false })
      // Quick connection test
      try {
        const res = await adoRequestRaw("GET", `https://dev.azure.com/${config.org}/_apis/projects?$top=1`, secrets.pat)
        return c.json({ found: true, config: { org: config.org, project: config.project, team: config.team, pat: "***" }, connected: res.status === 200 })
      } catch (_) {
        return c.json({ found: true, config: { org: config.org, project: config.project, team: config.team, pat: "***" }, connected: false })
      }
    })

    // List sprints (all project iterations merged with team timeframe data)
    .get("/sprints", async (c) => {
      const dir = c.req.query("dir") || process.cwd()
      const ctx = getConfigAndPat(dir)
      if (!ctx) return c.json({ error: "ADO not configured" }, 400)

      const teamSegment = ctx.config.team ? `/${encodeURIComponent(ctx.config.team)}` : ""

      // Get team iterations (has timeFrame info)
      const teamRes = await adoRequest("GET", `${teamSegment}/_apis/work/teamsettings/iterations`, ctx.config, ctx.pat)
      const teamIterMap = new Map<string, string>()
      if (teamRes.status === 200) {
        for (const iter of (teamRes.data.value || [])) {
          teamIterMap.set(iter.id, iter.attributes?.timeFrame || "future")
        }
      }

      // Get ALL project iterations (includes ones not subscribed to team)
      const allRes = await adoRequest("GET", `_apis/wit/classificationnodes/Iterations?$depth=10`, ctx.config, ctx.pat)
      if (allRes.status !== 200) {
        // Fallback: just return team iterations
        if (teamRes.status === 200) {
          return c.json((teamRes.data.value || []).map((s: any) => ({
            id: s.id, name: s.name, path: s.path,
            startDate: s.attributes?.startDate || null, finishDate: s.attributes?.finishDate || null,
            timeFrame: s.attributes?.timeFrame || null,
          })))
        }
        return c.json({ error: "Failed to fetch sprints" }, 500)
      }

      function flattenIterations(node: any, parentPath = ""): any[] {
        const results: any[] = []
        const nodePath = parentPath ? `${parentPath}\\${node.name}` : node.name
        if (node.children) {
          for (const child of node.children) {
            if (!child.children || child.children.length === 0) {
              results.push({
                id: child.identifier || String(child.id),
                name: child.name,
                path: `${nodePath}\\${child.name}`,
                startDate: child.attributes?.startDate || null,
                finishDate: child.attributes?.finishDate || null,
                timeFrame: teamIterMap.get(child.identifier || String(child.id)) || "past",
              })
            } else {
              results.push(...flattenIterations(child, nodePath))
            }
          }
        }
        return results
      }

      const sprints = flattenIterations(allRes.data)

      // Sort: current first, then future, then past (descending by name)
      sprints.sort((a: any, b: any) => {
        const order: Record<string, number> = { current: 0, future: 1, past: 2 }
        const oa = order[a.timeFrame] ?? 3
        const ob = order[b.timeFrame] ?? 3
        if (oa !== ob) return oa - ob
        return b.name.localeCompare(a.name, undefined, { numeric: true })
      })

      return c.json(sprints)
    })

    // Get current sprint
    .get("/sprints/current", async (c) => {
      const dir = c.req.query("dir") || process.cwd()
      const ctx = getConfigAndPat(dir)
      if (!ctx) return c.json({ error: "ADO not configured" }, 400)

      const teamSegment = ctx.config.team ? `/${encodeURIComponent(ctx.config.team)}` : ""
      const res = await adoRequest(
        "GET",
        `${teamSegment}/_apis/work/teamsettings/iterations?$timeframe=current`,
        ctx.config,
        ctx.pat,
      )
      if (res.status !== 200) return c.json({ error: "Failed to fetch current sprint", details: res.data }, res.status as any)

      const sprints = res.data.value || []
      if (sprints.length === 0) return c.json({ error: "No current sprint found" }, 404)

      const s = sprints[0]
      return c.json({
        id: s.id,
        name: s.name,
        path: s.path,
        startDate: s.attributes?.startDate || null,
        finishDate: s.attributes?.finishDate || null,
        timeFrame: s.attributes?.timeFrame || null,
      })
    })

    // Get work items in a sprint
    .get("/sprints/:id/items", async (c) => {
      const dir = c.req.query("dir") || process.cwd()
      const sprintId = c.req.param("id")
      const iterationPath = c.req.query("path")
      const ctx = getConfigAndPat(dir)
      if (!ctx) return c.json({ error: "ADO not configured" }, 400)

      const teamSegment = ctx.config.team ? `/${encodeURIComponent(ctx.config.team)}` : ""

      // Try team iterations API first (works for team-subscribed sprints)
      const iterRes = await adoRequest(
        "GET",
        `${teamSegment}/_apis/work/teamsettings/iterations/${sprintId}/workitems`,
        ctx.config,
        ctx.pat,
      )

      let ids: number[] = []

      if (iterRes.status === 200) {
        const workItemRefs = iterRes.data.workItemRelations || []
        ids = workItemRefs.map((r: any) => r.target?.id).filter(Boolean)
      } else if (iterationPath) {
        // Fallback: use WIQL query with iteration path (works for non-team-subscribed sprints)
        const wiql = `SELECT [System.Id] FROM WorkItems WHERE [System.IterationPath] UNDER '${iterationPath.replace(/'/g, "''")}' ORDER BY [System.ChangedDate] DESC`
        const wiqlRes = await adoRequest(
          "POST",
          `_apis/wit/wiql`,
          ctx.config,
          ctx.pat,
          { query: wiql },
        )
        if (wiqlRes.status === 200) {
          ids = (wiqlRes.data.workItems || []).map((w: any) => w.id).filter(Boolean)
        } else {
          return c.json({ error: "Failed to fetch sprint work items", details: wiqlRes.data }, wiqlRes.status as any)
        }
      } else {
        return c.json({ error: "Failed to fetch sprint work items", details: iterRes.data }, iterRes.status as any)
      }

      if (ids.length === 0) return c.json([])

      const batchRes = await adoRequest(
        "POST",
        `_apis/wit/workitemsbatch`,
        ctx.config,
        ctx.pat,
        {
          ids,
          fields: [
            "System.Id", "System.Title", "System.State", "System.WorkItemType",
            "System.AssignedTo", "Microsoft.VSTS.Common.Priority",
            "Microsoft.VSTS.Scheduling.StoryPoints", "System.Tags",
            "System.AreaPath", "System.IterationPath",
          ],
        },
      )
      if (batchRes.status !== 200) return c.json({ error: "Failed to fetch work item details", details: batchRes.data }, batchRes.status as any)

      return c.json((batchRes.data.value || []).map(mapWorkItem))
    })

    // Get single work item with children, PRs, comments
    .get("/items/:id", async (c) => {
      const dir = c.req.query("dir") || process.cwd()
      const itemId = c.req.param("id")
      const ctx = getConfigAndPat(dir)
      if (!ctx) return c.json({ error: "ADO not configured" }, 400)

      const res = await adoRequest(
        "GET",
        `_apis/wit/workitems/${itemId}?$expand=relations`,
        ctx.config,
        ctx.pat,
      )
      if (res.status !== 200) return c.json({ error: "Failed to fetch work item", details: res.data }, res.status as any)

      const item = mapWorkItem(res.data)
      const relations = res.data.relations || []

      // Extract child IDs
      const childIds = relations
        .filter((r: any) => r.rel === "System.LinkTypes.Hierarchy-Forward")
        .map((r: any) => {
          const match = (r.url || "").match(/workItems\/(\d+)/)
          return match ? parseInt(match[1], 10) : null
        })
        .filter(Boolean)

      let children: any[] = []
      if (childIds.length > 0) {
        const childRes = await adoRequest(
          "POST",
          `_apis/wit/workitemsbatch`,
          ctx.config,
          ctx.pat,
          {
            ids: childIds,
            fields: [
              "System.Id", "System.Title", "System.State", "System.WorkItemType",
              "System.AssignedTo", "Microsoft.VSTS.Common.Priority",
              "Microsoft.VSTS.Scheduling.StoryPoints", "System.Tags",
            ],
          },
        )
        if (childRes.status === 200) children = (childRes.data.value || []).map(mapWorkItem)
      }

      // Extract PR links
      const prLinks = relations
        .filter((r: any) => r.rel === "ArtifactLink" && (r.url || "").includes("PullRequestId"))
        .map((r: any) => ({
          url: r.url,
          name: r.attributes?.name || "Pull Request",
        }))

      // Fetch comments
      const commentsRes = await adoRequest(
        "GET",
        `_apis/wit/workitems/${itemId}/comments`,
        ctx.config,
        ctx.pat,
      )
      const comments = commentsRes.status === 200
        ? (commentsRes.data.comments || []).map((comment: any) => ({
            id: comment.id,
            text: comment.text,
            createdBy: comment.createdBy?.displayName || null,
            createdDate: comment.createdDate || null,
          }))
        : []

      return c.json({ ...item, children, prLinks, comments })
    })

    // Get board columns
    .get("/board/columns", async (c) => {
      const dir = c.req.query("dir") || process.cwd()
      const ctx = getConfigAndPat(dir)
      if (!ctx) return c.json({ error: "ADO not configured" }, 400)

      const teamSegment = ctx.config.team ? `/${encodeURIComponent(ctx.config.team)}` : ""
      const boardName = c.req.query("board") || "Stories"
      let res = await adoRequest(
        "GET",
        `${teamSegment}/_apis/work/boards/${boardName}`,
        ctx.config,
        ctx.pat,
      )
      // Fallback board names if Stories doesn't exist
      if (res.status !== 200) {
        res = await adoRequest("GET", `${teamSegment}/_apis/work/boards/Backlog%20items`, ctx.config, ctx.pat)
      }
      if (res.status !== 200) {
        // Try listing boards and use first one
        const boardsRes = await adoRequest("GET", `${teamSegment}/_apis/work/boards`, ctx.config, ctx.pat)
        if (boardsRes.status === 200 && boardsRes.data.value?.length > 0) {
          res = await adoRequest("GET", `${teamSegment}/_apis/work/boards/${encodeURIComponent(boardsRes.data.value[0].name)}`, ctx.config, ctx.pat)
        }
      }
      if (res.status !== 200) return c.json({ error: "Failed to fetch board columns", details: res.data }, res.status as any)

      return c.json((res.data.columns || []).map((col: any) => ({
        id: col.id,
        name: col.name,
        itemLimit: col.itemLimit || 0,
        stateMappings: col.stateMappings || {},
        columnType: col.columnType || null,
      })))
    })

    // Create work item
    .post("/items", async (c) => {
      const dir = c.req.query("dir") || process.cwd()
      const ctx = getConfigAndPat(dir)
      if (!ctx) return c.json({ error: "ADO not configured" }, 400)

      const body = await c.req.json().catch(() => null)
      if (!body) return c.json({ error: "Invalid JSON body" }, 400)

      const type = encodeURIComponent(body.type || "User Story")
      const patchDoc: any[] = []

      if (body.title) patchDoc.push({ op: "add", path: "/fields/System.Title", value: body.title })
      if (body.description) patchDoc.push({ op: "add", path: "/fields/System.Description", value: body.description })
      if (body.assignedTo) patchDoc.push({ op: "add", path: "/fields/System.AssignedTo", value: body.assignedTo })
      if (body.state) patchDoc.push({ op: "add", path: "/fields/System.State", value: body.state })
      if (body.priority) patchDoc.push({ op: "add", path: "/fields/Microsoft.VSTS.Common.Priority", value: body.priority })
      if (body.storyPoints) patchDoc.push({ op: "add", path: "/fields/Microsoft.VSTS.Scheduling.StoryPoints", value: body.storyPoints })
      if (body.tags) patchDoc.push({ op: "add", path: "/fields/System.Tags", value: body.tags })
      if (body.areaPath) patchDoc.push({ op: "add", path: "/fields/System.AreaPath", value: body.areaPath })
      if (body.iterationPath) patchDoc.push({ op: "add", path: "/fields/System.IterationPath", value: body.iterationPath })
      if (body.acceptanceCriteria) patchDoc.push({ op: "add", path: "/fields/Microsoft.VSTS.Common.AcceptanceCriteria", value: body.acceptanceCriteria })
      if (body.parentId) patchDoc.push({ op: "add", path: "/relations/-", value: { rel: "System.LinkTypes.Hierarchy-Reverse", url: `https://dev.azure.com/${ctx.config.org}/${ctx.config.project}/_apis/wit/workItems/${body.parentId}` } })

      const res = await adoRequestRaw(
        "POST",
        `https://dev.azure.com/${ctx.config.org}/${ctx.config.project}/_apis/wit/workitems/$${type}`,
        ctx.pat,
        patchDoc,
        "application/json-patch+json",
      )
      if (res.status !== 200) return c.json({ error: "Failed to create work item", details: res.data }, res.status as any)

      return c.json(mapWorkItem(res.data))
    })

    // Update work item
    .patch("/items/:id", async (c) => {
      const dir = c.req.query("dir") || process.cwd()
      const itemId = c.req.param("id")
      const ctx = getConfigAndPat(dir)
      if (!ctx) return c.json({ error: "ADO not configured" }, 400)

      const body = await c.req.json().catch(() => null)
      if (!body) return c.json({ error: "Invalid JSON body" }, 400)

      const patchDoc: any[] = []
      const fieldMap: Record<string, string> = {
        title: "System.Title",
        description: "System.Description",
        state: "System.State",
        assignedTo: "System.AssignedTo",
        priority: "Microsoft.VSTS.Common.Priority",
        storyPoints: "Microsoft.VSTS.Scheduling.StoryPoints",
        tags: "System.Tags",
        areaPath: "System.AreaPath",
        iterationPath: "System.IterationPath",
        acceptanceCriteria: "Microsoft.VSTS.Common.AcceptanceCriteria",
      }

      for (const [key, field] of Object.entries(fieldMap)) {
        if (body[key] !== undefined) patchDoc.push({ op: "replace", path: `/fields/${field}`, value: body[key] })
      }

      if (patchDoc.length === 0) return c.json({ error: "No fields to update" }, 400)

      const res = await adoRequestRaw(
        "PATCH",
        `https://dev.azure.com/${ctx.config.org}/${ctx.config.project}/_apis/wit/workitems/${itemId}`,
        ctx.pat,
        patchDoc,
        "application/json-patch+json",
      )
      if (res.status !== 200) return c.json({ error: "Failed to update work item", details: res.data }, res.status as any)

      return c.json(mapWorkItem(res.data))
    })

    // Create branch from work item
    .post("/branches", async (c) => {
      const dir = c.req.query("dir") || process.cwd()
      const ctx = getConfigAndPat(dir)
      if (!ctx) return c.json({ error: "ADO not configured" }, 400)

      const body = await c.req.json().catch(() => null)
      if (!body) return c.json({ error: "Invalid JSON body" }, 400)

      const { branchName, workItemId, repo } = body
      const repoName = repo || ctx.config.defaultRepo
      if (!branchName || !repoName) return c.json({ error: "branchName and repo are required" }, 400)

      // Get default branch and latest commit
      const repoRes = await adoRequest(
        "GET",
        `_apis/git/repositories/${encodeURIComponent(repoName)}`,
        ctx.config,
        ctx.pat,
      )
      if (repoRes.status !== 200) return c.json({ error: "Failed to fetch repository", details: repoRes.data }, repoRes.status as any)

      const defaultBranch = repoRes.data.defaultBranch || "refs/heads/main"
      const repoId = repoRes.data.id

      // Get latest commit on default branch
      const refsRes = await adoRequest(
        "GET",
        `_apis/git/repositories/${repoId}/refs?filter=${defaultBranch.replace("refs/", "")}`,
        ctx.config,
        ctx.pat,
      )
      if (refsRes.status !== 200) return c.json({ error: "Failed to fetch refs", details: refsRes.data }, refsRes.status as any)

      const refs = refsRes.data.value || []
      if (refs.length === 0) return c.json({ error: "Default branch ref not found" }, 404)

      const latestCommitId = refs[0].objectId

      // Create the branch
      const createRes = await adoRequest(
        "POST",
        `_apis/git/repositories/${repoId}/refs`,
        ctx.config,
        ctx.pat,
        [
          {
            name: `refs/heads/${branchName}`,
            oldObjectId: "0000000000000000000000000000000000000000",
            newObjectId: latestCommitId,
          },
        ],
      )
      if (createRes.status !== 200) return c.json({ error: "Failed to create branch", details: createRes.data }, createRes.status as any)

      const created = (createRes.data.value || [])[0]
      return c.json({
        success: created?.success ?? true,
        branchName,
        commitId: latestCommitId,
        workItemId: workItemId || null,
      })
    })

    // Create PR linked to work item
    .post("/pullrequests", async (c) => {
      const dir = c.req.query("dir") || process.cwd()
      const ctx = getConfigAndPat(dir)
      if (!ctx) return c.json({ error: "ADO not configured" }, 400)

      const body = await c.req.json().catch(() => null)
      if (!body) return c.json({ error: "Invalid JSON body" }, 400)

      const { title, description, sourceBranch, targetBranch, repo, workItemId, reviewers } = body
      const repoName = repo || ctx.config.defaultRepo
      if (!title || !sourceBranch || !repoName) return c.json({ error: "title, sourceBranch, and repo are required" }, 400)

      const sourceRef = sourceBranch.startsWith("refs/") ? sourceBranch : `refs/heads/${sourceBranch}`
      const targetRef = targetBranch
        ? targetBranch.startsWith("refs/") ? targetBranch : `refs/heads/${targetBranch}`
        : undefined

      const prBody: any = {
        title,
        description: description || "",
        sourceRefName: sourceRef,
      }
      if (targetRef) prBody.targetRefName = targetRef
      if (reviewers && Array.isArray(reviewers)) {
        prBody.reviewers = reviewers.map((r: any) => (typeof r === "string" ? { uniqueName: r } : r))
      }

      const prRes = await adoRequest(
        "POST",
        `_apis/git/repositories/${encodeURIComponent(repoName)}/pullrequests`,
        ctx.config,
        ctx.pat,
        prBody,
      )
      if (prRes.status !== 201 && prRes.status !== 200) return c.json({ error: "Failed to create pull request", details: prRes.data }, prRes.status as any)

      const prData = prRes.data

      // Link work item to PR if workItemId provided
      if (workItemId) {
        const artifactLink = `vstfs:///Git/PullRequestId/${prData.repository?.project?.id || ctx.config.project}%2F${prData.repository?.id}%2F${prData.pullRequestId}`
        await adoRequestRaw(
          "PATCH",
          `https://dev.azure.com/${ctx.config.org}/${ctx.config.project}/_apis/wit/workitems/${workItemId}`,
          ctx.pat,
          [
            {
              op: "add",
              path: "/relations/-",
              value: {
                rel: "ArtifactLink",
                url: artifactLink,
                attributes: { name: "Pull Request" },
              },
            },
          ],
          "application/json-patch+json",
        )
      }

      return c.json({
        pullRequestId: prData.pullRequestId,
        title: prData.title,
        status: prData.status,
        url: prData._links?.web?.href || prData.url || "",
        workItemId: workItemId || null,
      })
    })
