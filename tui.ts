import path from "node:path"
import { Plugin } from "@opencode/plugin/tui"

/**
 * Session list with worktree/project-aware search.
 *
 * The built-in `session.list` dialog searches titles only. This plugin replaces it
 * with a picker whose search matches:
 *   - session title
 *   - the worktree label shown on the right (relative to the project root)
 *   - the project name (all-projects mode)
 *
 * Bind it by reusing the built-in command id `session.list`, so the existing
 * `<leader>l` keybind keeps working:
 *   "keybinds": { "session.list": "<leader>l" }
 */

const PAGE_SIZE = 100
const MAX_PAGES = 5
const DELETE_CONFIRM_MS = 4000

/** cache: canonical directory -> current branch (or null when unknown) */
const branchCache = new Map()
/** guards against re-entrant opens from double key presses */
let opening = false

function projectName(project) {
  if (!project) return ""
  return project.name?.trim() || path.basename(project.canonical ?? project.directory ?? "")
}

function sessionDirectory(session) {
  return session?.location?.directory
}

/** walk up from the session directory by the number of subpath segments */
function sessionRoot(session) {
  const directory = sessionDirectory(session)
  if (!directory) return undefined
  const depth = session.subpath ? session.subpath.split("/").filter(Boolean).length : 0
  if (depth === 0) return directory
  return path.resolve(directory, ...Array(depth).fill(".."))
}

/** label shown on the right: path of the worktree relative to the project root */
function worktreeLabel(session, project) {
  const root = sessionRoot(session)
  if (!root) return ""
  const canonical = project?.canonical ?? project?.directory
  if (!canonical) return path.basename(root)
  const relative = path.relative(canonical, root)
  if (!relative) return ""
  if (relative.startsWith("..") || path.isAbsolute(relative)) return path.basename(root)
  return relative.split(path.sep).join("/")
}

function dayLabel(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  const now = new Date()
  const day = (input) => new Date(input.getFullYear(), input.getMonth(), input.getDate()).getTime()
  const diff = Math.round((day(now) - day(date)) / 86_400_000)
  if (diff <= 0) return "Today"
  if (diff === 1) return "Yesterday"
  const monthDay = `${date.getMonth() + 1}-${String(date.getDate()).padStart(2, "0")}`
  return date.getFullYear() === now.getFullYear() ? monthDay : `${date.getFullYear()}-${monthDay}`
}

async function resolveRootLabel(ctx, directory, fallback) {
  if (!directory) return fallback
  if (branchCache.has(directory)) return branchCache.get(directory) || fallback
  const location = { directory }
  try {
    await ctx.data.location.vcs.sync(location)
    const info = ctx.data.location.vcs.info(location)
    const branch = info?.branch?.current ?? null
    branchCache.set(directory, branch)
    return branch || fallback
  } catch {
    branchCache.set(directory, null)
    return fallback
  }
}

async function fetchSessions(ctx, projectID) {
  const sessions = []
  let cursor
  for (let page = 0; page < MAX_PAGES; page++) {
    const response = await ctx.client.session.list({
      limit: PAGE_SIZE,
      order: "desc",
      parentID: null,
      archived: false,
      ...(projectID ? { project: projectID } : {}),
      ...(cursor ? { cursor } : {}),
    })
    const data = response?.data ?? []
    sessions.push(...data)
    cursor = response?.cursor?.next
    if (!cursor || data.length === 0) break
  }
  return sessions
}

function filterOptions(query, options) {
  const text = query.trim().toLowerCase()
  if (!text) return options
  const tokens = text.split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return options
  return options.filter((option) => tokens.every((token) => option.searchText.includes(token)))
}

function scheduleReopen(ctx, allProjects) {
  setTimeout(() => void openSessions(ctx, allProjects), 0)
}

async function openSessions(ctx, allProjects) {
  if (opening) return
  opening = true
  try {
    const location = ctx.location ?? ctx.data.location.default()
    let projectID
    if (!allProjects) {
      if (!ctx.data.location.info(location)) await ctx.data.location.sync(location)
      projectID = ctx.data.location.info(location)?.project?.id
    }

    try {
      await ctx.data.project.sync()
    } catch {}

    const sessions = await fetchSessions(ctx, projectID)

    const projects = ctx.data.project.list() ?? []
    const projectMap = new Map()
    for (const project of projects) if (project?.id) projectMap.set(project.id, project)
    for (const session of sessions) {
      const id = session.projectID
      if (!id || projectMap.has(id)) continue
      const project = ctx.data.project.get(id)
      if (project) projectMap.set(id, project)
    }

    const rootLabels = new Map()
    const pending = new Map()
    for (const session of sessions) {
      if (worktreeLabel(session, projectMap.get(session.projectID))) continue
      const project = projectMap.get(session.projectID)
      const canonical = project?.canonical ?? project?.directory ?? sessionDirectory(session)
      if (!canonical) continue
      pending.set(canonical, projectName(project) || path.basename(canonical))
    }
    await Promise.all(
      [...pending].map(async ([directory, fallback]) => {
        rootLabels.set(directory, await resolveRootLabel(ctx, directory, fallback))
      }),
    )

    const options = []
    for (const session of sessions) {
      const project = projectMap.get(session.projectID)
      const name = projectName(project)
      const canonical = project?.canonical ?? project?.directory
      let label = worktreeLabel(session, project)
      if (!label) label = rootLabels.get(canonical) || name || path.basename(sessionDirectory(session) ?? "")
      const title = session.title?.trim() || "(untitled)"
      const day = dayLabel(session.time?.updated)
      options.push({
        title,
        value: session.id,
        category: day,
        description: allProjects ? name || undefined : day || undefined,
        searchFooter: label || undefined,
        footer: label || undefined,
        searchText: [title, label, allProjects ? name : "", session.id].join(" ").toLowerCase(),
      })
    }

    let deleteTarget
    let deleteArmedAt = 0

    const selected = await ctx.ui.dialog.select({
      title: allProjects ? "Sessions · all projects" : "Sessions",
      placeholder: "Search title, worktree or project…",
      current: ctx.ui.router.current()?.type === "session" ? ctx.ui.router.current().sessionID : undefined,
      options,
      search: filterOptions,
      actions: [
        {
          bind: "ctrl+a",
          title: allProjects ? "current project" : "all projects",
          selection: "none",
          onTrigger: () => {
            ctx.ui.dialog.clear()
            scheduleReopen(ctx, !allProjects)
          },
        },
        {
          bind: "ctrl+d",
          title: "delete",
          onTrigger: (value) => {
            const now = Date.now()
            if (deleteTarget !== value || now - deleteArmedAt > DELETE_CONFIRM_MS) {
              deleteTarget = value
              deleteArmedAt = now
              ctx.ui.toast.show({ message: "Press ctrl+d again to delete this session" })
              return
            }
            deleteTarget = undefined
            ctx.client.session
              .remove({ sessionID: value })
              .then(() => {
                ctx.ui.toast.show({ message: "Session deleted", variant: "success" })
                ctx.ui.dialog.clear()
                scheduleReopen(ctx, allProjects)
              })
              .catch((error) => {
                ctx.ui.toast.show({ message: String(error?.message ?? error), variant: "error" })
              })
          },
        },
        {
          bind: "ctrl+r",
          title: "rename",
          onTrigger: async (value) => {
            const option = options.find((item) => item.value === value)
            const title = await ctx.ui.dialog.prompt({
              title: "Rename session",
              placeholder: "Session title",
              value: option?.title,
            })
            if (title === undefined) return
            const next = title.trim()
            if (!next) return
            try {
              await ctx.client.session.update({ sessionID: value, title: next })
              scheduleReopen(ctx, allProjects)
            } catch (error) {
              ctx.ui.toast.show({ message: String(error?.message ?? error), variant: "error" })
            }
          },
        },
      ],
    })

    if (selected) ctx.ui.router.navigate({ type: "session", sessionID: selected })
  } catch (error) {
    ctx.ui.toast.show({
      message: `Session search failed: ${String(error?.message ?? error)}`,
      variant: "error",
    })
  } finally {
    opening = false
  }
}

export default Plugin.define({
  id: "yyshine760.session-list-enhanced",
  setup(ctx) {
    ctx.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "session.list",
          title: "Search sessions",
          description: "List sessions and search titles, worktrees and projects",
          group: "Session",
          palette: true,
          enabled: () => true,
          run: () => openSessions(ctx, false),
        },
      ],
    }))
  },
})
