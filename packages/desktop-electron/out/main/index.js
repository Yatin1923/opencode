import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { extname, dirname, join, resolve, relative, isAbsolute, basename } from "node:path";
import { app, protocol, net, nativeImage, BrowserWindow, nativeTheme, ipcMain, dialog, shell, clipboard, Notification, Menu } from "electron";
import pkg from "electron-updater";
import contextMenu from "electron-context-menu";
import { execFileSync, execFile, spawnSync } from "node:child_process";
import Store from "electron-store";
import windowState from "electron-window-state";
import { fileURLToPath, pathToFileURL } from "node:url";
import log from "electron-log/main.js";
import { marked } from "marked";
import { drizzle } from "drizzle-orm/node-sqlite/driver";
function checkAppExists(appName) {
  if (process.platform === "win32") return true;
  if (process.platform === "linux") return true;
  return checkMacosApp(appName);
}
function resolveAppPath(appName) {
  if (process.platform !== "win32") return appName;
  return resolveWindowsAppPath(appName);
}
function wslPath(path, mode) {
  if (process.platform !== "win32") return path;
  const flag = mode === "windows" ? "-w" : "-u";
  try {
    if (path.startsWith("~")) {
      const suffix = path.slice(1);
      const cmd = `wslpath ${flag} "$HOME${suffix.replace(/"/g, '\\"')}"`;
      const output2 = execFileSync("wsl", ["-e", "sh", "-lc", cmd]);
      return output2.toString().trim();
    }
    const output = execFileSync("wsl", ["-e", "wslpath", flag, path]);
    return output.toString().trim();
  } catch (error) {
    throw new Error(`Failed to run wslpath: ${String(error)}`, { cause: error });
  }
}
function checkMacosApp(appName) {
  const locations = [`/Applications/${appName}.app`, `/System/Applications/${appName}.app`];
  const home = process.env.HOME;
  if (home) locations.push(`${home}/Applications/${appName}.app`);
  if (locations.some((location) => existsSync(location))) return true;
  try {
    execFileSync("which", [appName]);
    return true;
  } catch {
    return false;
  }
}
function resolveWindowsAppPath(appName) {
  let output;
  try {
    output = execFileSync("where", [appName]).toString();
  } catch {
    return null;
  }
  const paths = output.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  const hasExt = (path, ext) => extname(path).toLowerCase() === `.${ext}`;
  const exe = paths.find((path) => hasExt(path, "exe"));
  if (exe) return exe;
  const resolveCmd = (path) => {
    const content = readFileSync(path, "utf8");
    for (const token of content.split('"').map((value) => value.trim())) {
      const lower = token.toLowerCase();
      if (!lower.includes(".exe")) continue;
      const index = lower.indexOf("%~dp0");
      if (index >= 0) {
        const base = dirname(path);
        const suffix = token.slice(index + 5);
        const resolved = suffix.replace(/\//g, "\\").split("\\").filter((part) => part && part !== ".").reduce((current, part) => {
          if (part === "..") return dirname(current);
          return join(current, part);
        }, base);
        if (existsSync(resolved)) return resolved;
      }
      if (existsSync(token)) return token;
    }
    return null;
  };
  for (const path of paths) {
    if (hasExt(path, "cmd") || hasExt(path, "bat")) {
      const resolved = resolveCmd(path);
      if (resolved) return resolved;
    }
    if (!extname(path)) {
      const cmd = `${path}.cmd`;
      if (existsSync(cmd)) {
        const resolved = resolveCmd(cmd);
        if (resolved) return resolved;
      }
      const bat = `${path}.bat`;
      if (existsSync(bat)) {
        const resolved = resolveCmd(bat);
        if (resolved) return resolved;
      }
    }
  }
  const key = appName.split("").filter((value) => /[a-z0-9]/i.test(value)).map((value) => value.toLowerCase()).join("");
  if (key) {
    for (const path of paths) {
      const dirs = [dirname(path), dirname(dirname(path)), dirname(dirname(dirname(path)))];
      for (const dir of dirs) {
        try {
          for (const entry of readdirSync(dir)) {
            const candidate = join(dir, entry);
            if (!hasExt(candidate, "exe")) continue;
            const stem = entry.replace(/\.exe$/i, "");
            const name = stem.split("").filter((value) => /[a-z0-9]/i.test(value)).map((value) => value.toLowerCase()).join("");
            if (name.includes(key) || key.includes(name)) return candidate;
          }
        } catch {
          continue;
        }
      }
    }
  }
  return paths[0] ?? null;
}
const raw = "dev";
const CHANNEL = raw;
const SETTINGS_STORE = "opencode.settings";
const DEFAULT_SERVER_URL_KEY = "defaultServerUrl";
const WSL_ENABLED_KEY = "wslEnabled";
const UPDATER_ENABLED = app.isPackaged && CHANNEL !== "dev";
const cache = /* @__PURE__ */ new Map();
function getStore(name = SETTINGS_STORE) {
  const cached = cache.get(name);
  if (cached) return cached;
  const next = new Store({ name, fileExtension: "", accessPropertiesByDotNotation: false });
  cache.set(name, next);
  return next;
}
const root = dirname(fileURLToPath(import.meta.url));
const rendererRoot = join(root, "../renderer");
const rendererProtocol = "oc";
const rendererHost = "renderer";
protocol.registerSchemesAsPrivileged([
  {
    scheme: rendererProtocol,
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true
    }
  }
]);
let backgroundColor;
function setBackgroundColor(color) {
  backgroundColor = color;
}
function iconsDir() {
  return app.isPackaged ? join(process.resourcesPath, "icons") : join(root, "../../resources/icons");
}
function iconPath() {
  const ext = process.platform === "win32" ? "ico" : "png";
  return join(iconsDir(), `icon.${ext}`);
}
function tone() {
  return nativeTheme.shouldUseDarkColors ? "dark" : "light";
}
function overlay(theme = {}) {
  const mode = theme.mode ?? tone();
  return {
    color: "#00000000",
    symbolColor: mode === "dark" ? "white" : "black",
    height: 40
  };
}
function setTitlebar(win, theme = {}) {
  if (process.platform !== "win32") return;
  win.setTitleBarOverlay(overlay(theme));
}
function setDockIcon() {
  if (process.platform !== "darwin") return;
  const icon = nativeImage.createFromPath(join(iconsDir(), "dock.png"));
  if (!icon.isEmpty()) app.dock?.setIcon(icon);
}
function createMainWindow() {
  const state = windowState({
    defaultWidth: 1280,
    defaultHeight: 800
  });
  const mode = tone();
  const win = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    show: false,
    title: "Crewup",
    icon: iconPath(),
    backgroundColor,
    ...process.platform === "darwin" ? {
      titleBarStyle: "hidden",
      trafficLightPosition: { x: 12, y: 14 }
    } : {},
    ...process.platform === "win32" ? {
      frame: false,
      titleBarStyle: "hidden",
      titleBarOverlay: overlay({ mode })
    } : {},
    webPreferences: {
      preload: join(root, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
    const { requestHeaders } = details;
    upsertKeyValue(requestHeaders, "Access-Control-Allow-Origin", ["*"]);
    callback({ requestHeaders });
  });
  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const { responseHeaders = {} } = details;
    upsertKeyValue(responseHeaders, "Access-Control-Allow-Origin", ["*"]);
    upsertKeyValue(responseHeaders, "Access-Control-Allow-Headers", ["*"]);
    callback({ responseHeaders });
  });
  state.manage(win);
  loadWindow(win, "index.html");
  wireZoom(win);
  win.once("ready-to-show", () => {
    win.show();
  });
  return win;
}
function createLoadingWindow() {
  const mode = tone();
  const win = new BrowserWindow({
    width: 640,
    height: 480,
    resizable: false,
    center: true,
    show: true,
    icon: iconPath(),
    backgroundColor,
    ...process.platform === "darwin" ? { titleBarStyle: "hidden" } : {},
    ...process.platform === "win32" ? {
      frame: false,
      titleBarStyle: "hidden",
      titleBarOverlay: overlay({ mode })
    } : {},
    webPreferences: {
      preload: join(root, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  loadWindow(win, "loading.html");
  return win;
}
function registerRendererProtocol() {
  if (protocol.isProtocolHandled(rendererProtocol)) return;
  protocol.handle(rendererProtocol, (request) => {
    const url = new URL(request.url);
    if (url.host !== rendererHost) {
      return new Response("Not found", { status: 404 });
    }
    const file = resolve(rendererRoot, `.${decodeURIComponent(url.pathname)}`);
    const rel = relative(rendererRoot, file);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      return new Response("Not found", { status: 404 });
    }
    return net.fetch(pathToFileURL(file).toString());
  });
}
function loadWindow(win, html) {
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    const url = new URL(html, devUrl);
    void win.loadURL(url.toString());
    return;
  }
  void win.loadURL(`${rendererProtocol}://${rendererHost}/${html}`);
}
function wireZoom(win) {
  win.webContents.setZoomFactor(1);
  win.webContents.on("zoom-changed", () => {
    win.webContents.setZoomFactor(1);
  });
}
function upsertKeyValue(obj, keyToChange, value) {
  const keyToChangeLower = keyToChange.toLowerCase();
  for (const key of Object.keys(obj)) {
    if (key.toLowerCase() === keyToChangeLower) {
      obj[key] = value;
      return;
    }
  }
  obj[keyToChange] = value;
}
const pickerFilters = (ext) => {
  if (!ext || ext.length === 0) return void 0;
  return [{ name: "Files", extensions: ext }];
};
function registerIpcHandlers(deps) {
  ipcMain.handle("kill-sidecar", () => deps.killSidecar());
  ipcMain.handle("await-initialization", (event) => {
    const send = (step) => event.sender.send("init-step", step);
    return deps.awaitInitialization(send);
  });
  ipcMain.handle("get-window-config", () => deps.getWindowConfig());
  ipcMain.handle("consume-initial-deep-links", () => deps.consumeInitialDeepLinks());
  ipcMain.handle("get-default-server-url", () => deps.getDefaultServerUrl());
  ipcMain.handle(
    "set-default-server-url",
    (_event, url) => deps.setDefaultServerUrl(url)
  );
  ipcMain.handle("get-wsl-config", () => deps.getWslConfig());
  ipcMain.handle("set-wsl-config", (_event, config) => deps.setWslConfig(config));
  ipcMain.handle("get-display-backend", () => deps.getDisplayBackend());
  ipcMain.handle(
    "set-display-backend",
    (_event, backend) => deps.setDisplayBackend(backend)
  );
  ipcMain.handle("parse-markdown", (_event, markdown) => deps.parseMarkdown(markdown));
  ipcMain.handle("check-app-exists", (_event, appName) => deps.checkAppExists(appName));
  ipcMain.handle(
    "wsl-path",
    (_event, path, mode) => deps.wslPath(path, mode)
  );
  ipcMain.handle("resolve-app-path", (_event, appName) => deps.resolveAppPath(appName));
  ipcMain.on("loading-window-complete", () => deps.loadingWindowComplete());
  ipcMain.handle("run-updater", (_event, alertOnFail) => deps.runUpdater(alertOnFail));
  ipcMain.handle("check-update", () => deps.checkUpdate());
  ipcMain.handle("install-update", () => deps.installUpdate());
  ipcMain.handle("set-background-color", (_event, color) => deps.setBackgroundColor(color));
  ipcMain.handle("store-get", (_event, name, key) => {
    const store = getStore(name);
    const value = store.get(key);
    if (value === void 0 || value === null) return null;
    return typeof value === "string" ? value : JSON.stringify(value);
  });
  ipcMain.handle("store-set", (_event, name, key, value) => {
    getStore(name).set(key, value);
  });
  ipcMain.handle("store-delete", (_event, name, key) => {
    getStore(name).delete(key);
  });
  ipcMain.handle("store-clear", (_event, name) => {
    getStore(name).clear();
  });
  ipcMain.handle("store-keys", (_event, name) => {
    const store = getStore(name);
    return Object.keys(store.store);
  });
  ipcMain.handle("store-length", (_event, name) => {
    const store = getStore(name);
    return Object.keys(store.store).length;
  });
  ipcMain.handle(
    "open-directory-picker",
    async (_event, opts) => {
      const result = await dialog.showOpenDialog({
        properties: ["openDirectory", ...opts?.multiple ? ["multiSelections"] : [], "createDirectory"],
        title: opts?.title ?? "Choose a folder",
        defaultPath: opts?.defaultPath
      });
      if (result.canceled) return null;
      return opts?.multiple ? result.filePaths : result.filePaths[0];
    }
  );
  ipcMain.handle(
    "open-file-picker",
    async (_event, opts) => {
      const result = await dialog.showOpenDialog({
        properties: ["openFile", ...opts?.multiple ? ["multiSelections"] : []],
        title: opts?.title ?? "Choose a file",
        defaultPath: opts?.defaultPath,
        filters: pickerFilters(opts?.extensions)
      });
      if (result.canceled) return null;
      return opts?.multiple ? result.filePaths : result.filePaths[0];
    }
  );
  ipcMain.handle(
    "save-file-picker",
    async (_event, opts) => {
      const result = await dialog.showSaveDialog({
        title: opts?.title ?? "Save file",
        defaultPath: opts?.defaultPath
      });
      if (result.canceled) return null;
      return result.filePath ?? null;
    }
  );
  ipcMain.on("open-link", (_event, url) => {
    void shell.openExternal(url);
  });
  ipcMain.handle("open-path", async (_event, path, app2) => {
    if (!app2) return shell.openPath(path);
    await new Promise((resolve2, reject) => {
      const [cmd, args] = process.platform === "darwin" ? ["open", ["-a", app2, path]] : [app2, [path]];
      execFile(cmd, args, (err) => err ? reject(err) : resolve2());
    });
  });
  ipcMain.handle("read-clipboard-image", () => {
    const image = clipboard.readImage();
    if (image.isEmpty()) return null;
    const buffer = image.toPNG().buffer;
    const size = image.getSize();
    return { buffer, width: size.width, height: size.height };
  });
  ipcMain.on("show-notification", (_event, title, body) => {
    new Notification({ title, body }).show();
  });
  ipcMain.handle("get-window-count", () => BrowserWindow.getAllWindows().length);
  ipcMain.handle("get-window-focused", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win?.isFocused() ?? false;
  });
  ipcMain.handle("set-window-focus", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.focus();
  });
  ipcMain.handle("show-window", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.show();
  });
  ipcMain.on("relaunch", () => {
    app.relaunch();
    app.exit(0);
  });
  ipcMain.handle("get-zoom-factor", (event) => event.sender.getZoomFactor());
  ipcMain.handle("set-zoom-factor", (event, factor) => event.sender.setZoomFactor(factor));
  ipcMain.handle("set-titlebar", (event, theme) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    setTitlebar(win, theme);
  });
}
function sendSqliteMigrationProgress(win, progress) {
  win.webContents.send("sqlite-migration-progress", progress);
}
function sendMenuCommand(win, id) {
  win.webContents.send("menu-command", id);
}
function sendDeepLinks(win, urls) {
  win.webContents.send("deep-link", urls);
}
const MAX_LOG_AGE_DAYS = 7;
function initLogging() {
  log.transports.file.maxSize = 5 * 1024 * 1024;
  cleanup();
  return log;
}
function cleanup() {
  const path = log.transports.file.getFile().path;
  const dir = dirname(path);
  const cutoff = Date.now() - MAX_LOG_AGE_DAYS * 24 * 60 * 60 * 1e3;
  for (const entry of readdirSync(dir)) {
    const file = join(dir, entry);
    try {
      const info = statSync(file);
      if (!info.isFile()) continue;
      if (info.mtimeMs < cutoff) unlinkSync(file);
    } catch {
      continue;
    }
  }
}
const renderer = new marked.Renderer();
renderer.link = ({ href, title, text }) => {
  const titleAttr = title ? ` title="${title}"` : "";
  return `<a href="${href}"${titleAttr} class="external-link" target="_blank" rel="noopener noreferrer">${text}</a>`;
};
function parseMarkdown(input) {
  return marked(input, {
    renderer,
    breaks: false,
    gfm: true
  });
}
function createMenu(deps) {
  if (process.platform !== "darwin") return;
  const template = [
    {
      label: "Crewup",
      submenu: [
        { role: "about" },
        {
          label: "Check for Updates...",
          enabled: UPDATER_ENABLED,
          click: () => deps.checkForUpdates()
        },
        {
          label: "Reload Webview",
          click: () => deps.reload()
        },
        {
          label: "Restart",
          click: () => deps.relaunch()
        },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" }
      ]
    },
    {
      label: "File",
      submenu: [
        { label: "New Session", accelerator: "Shift+Cmd+S", click: () => deps.trigger("session.new") },
        { label: "Open Project...", accelerator: "Cmd+O", click: () => deps.trigger("project.open") },
        {
          label: "New Window",
          accelerator: "Cmd+Shift+N",
          click: () => createMainWindow()
        },
        { type: "separator" },
        { role: "close" }
      ]
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" }
      ]
    },
    {
      label: "View",
      submenu: [
        { label: "Toggle Sidebar", accelerator: "Cmd+B", click: () => deps.trigger("sidebar.toggle") },
        { label: "Toggle Terminal", accelerator: "Ctrl+`", click: () => deps.trigger("terminal.toggle") },
        { label: "Toggle File Tree", click: () => deps.trigger("fileTree.toggle") },
        { type: "separator" },
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" }
      ]
    },
    {
      label: "Go",
      submenu: [
        { label: "Back", accelerator: "Cmd+[", click: () => deps.trigger("common.goBack") },
        { label: "Forward", accelerator: "Cmd+]", click: () => deps.trigger("common.goForward") },
        { type: "separator" },
        {
          label: "Previous Session",
          accelerator: "Option+Up",
          click: () => deps.trigger("session.previous")
        },
        {
          label: "Next Session",
          accelerator: "Option+Down",
          click: () => deps.trigger("session.next")
        },
        { type: "separator" },
        {
          label: "Previous Project",
          accelerator: "Cmd+Option+Up",
          click: () => deps.trigger("project.previous")
        },
        {
          label: "Next Project",
          accelerator: "Cmd+Option+Down",
          click: () => deps.trigger("project.next")
        }
      ]
    },
    { role: "windowMenu" },
    {
      label: "Help",
      submenu: [
        { label: "Crewup Documentation", click: () => shell.openExternal("https://opencode.ai/docs") },
        { label: "Support Forum", click: () => shell.openExternal("https://discord.com/invite/opencode") },
        { type: "separator" },
        { type: "separator" },
        {
          label: "Share Feedback",
          click: () => shell.openExternal("https://github.com/anomalyco/opencode/issues/new?template=feature_request.yml")
        },
        {
          label: "Report a Bug",
          click: () => shell.openExternal("https://github.com/anomalyco/opencode/issues/new?template=bug_report.yml")
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
const TIMEOUT = 5e3;
function getUserShell() {
  return process.env.SHELL || "/bin/sh";
}
function parseShellEnv(out) {
  const env = {};
  for (const line of out.toString("utf8").split("\0")) {
    if (!line) continue;
    const ix = line.indexOf("=");
    if (ix <= 0) continue;
    env[line.slice(0, ix)] = line.slice(ix + 1);
  }
  return env;
}
function probe(shell2, mode) {
  const out = spawnSync(shell2, [mode, "-c", "env -0"], {
    stdio: ["ignore", "pipe", "ignore"],
    timeout: TIMEOUT,
    windowsHide: true
  });
  const err = out.error;
  if (err) {
    if (err.code === "ETIMEDOUT") return { type: "Timeout" };
    console.log(`[server] Shell env probe failed for ${shell2} ${mode}: ${err.message}`);
    return { type: "Unavailable" };
  }
  if (out.status !== 0) {
    console.log(`[server] Shell env probe exited with non-zero status for ${shell2} ${mode}`);
    return { type: "Unavailable" };
  }
  const env = parseShellEnv(out.stdout);
  if (Object.keys(env).length === 0) {
    console.log(`[server] Shell env probe returned empty env for ${shell2} ${mode}`);
    return { type: "Unavailable" };
  }
  return { type: "Loaded", value: env };
}
function isNushell(shell2) {
  const name = basename(shell2).toLowerCase();
  const raw2 = shell2.toLowerCase();
  return name === "nu" || name === "nu.exe" || raw2.endsWith("\\nu.exe");
}
function loadShellEnv(shell2) {
  if (isNushell(shell2)) {
    console.log(`[server] Skipping shell env probe for nushell: ${shell2}`);
    return null;
  }
  const interactive = probe(shell2, "-il");
  if (interactive.type === "Loaded") {
    console.log(`[server] Loaded shell environment with -il (${Object.keys(interactive.value).length} vars)`);
    return interactive.value;
  }
  if (interactive.type === "Timeout") {
    console.warn(`[server] Interactive shell env probe timed out: ${shell2}`);
    return null;
  }
  const login = probe(shell2, "-l");
  if (login.type === "Loaded") {
    console.log(`[server] Loaded shell environment with -l (${Object.keys(login.value).length} vars)`);
    return login.value;
  }
  console.warn(`[server] Falling back to app environment: ${shell2}`);
  return null;
}
function getDefaultServerUrl() {
  const value = getStore().get(DEFAULT_SERVER_URL_KEY);
  return typeof value === "string" ? value : null;
}
function setDefaultServerUrl(url) {
  if (url) {
    getStore().set(DEFAULT_SERVER_URL_KEY, url);
    return;
  }
  getStore().delete(DEFAULT_SERVER_URL_KEY);
}
function getWslConfig() {
  const value = getStore().get(WSL_ENABLED_KEY);
  return { enabled: typeof value === "boolean" ? value : false };
}
function setWslConfig(config) {
  getStore().set(WSL_ENABLED_KEY, config.enabled);
}
async function spawnLocalServer(hostname, port, password) {
  prepareServerEnv(password);
  const { Log, Server } = await import("./chunks/node-9cvHhbTI.js");
  await Log.init({ level: "WARN" });
  const listener = await Server.listen({
    port,
    hostname,
    username: "opencode",
    password,
    cors: ["oc://renderer"]
  });
  const wait = (async () => {
    const url = `http://${hostname}:${port}`;
    const ready = async () => {
      while (true) {
        await new Promise((resolve2) => setTimeout(resolve2, 100));
        if (await checkHealth(url, password)) return;
      }
    };
    await ready();
  })();
  return { listener, health: { wait } };
}
function prepareServerEnv(password) {
  const shell2 = process.platform === "win32" ? null : getUserShell();
  const shellEnv = shell2 ? loadShellEnv(shell2) ?? {} : {};
  const env = {
    ...process.env,
    ...shellEnv,
    OPENCODE_EXPERIMENTAL_ICON_DISCOVERY: "true",
    OPENCODE_EXPERIMENTAL_FILEWATCHER: "true",
    OPENCODE_CLIENT: "desktop",
    OPENCODE_SERVER_USERNAME: "opencode",
    OPENCODE_SERVER_PASSWORD: password,
    XDG_STATE_HOME: app.getPath("userData")
  };
  Object.assign(process.env, env);
}
async function checkHealth(url, password) {
  let healthUrl;
  try {
    healthUrl = new URL("/global/health", url);
  } catch {
    return false;
  }
  const headers = new Headers();
  if (password) {
    const auth = Buffer.from(`opencode:${password}`).toString("base64");
    headers.set("authorization", `Basic ${auth}`);
  }
  try {
    const res = await fetch(healthUrl, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(3e3)
    });
    return res.ok;
  } catch {
    return false;
  }
}
contextMenu({ showSaveImageAs: true, showLookUpSelection: false, showSearchWithGoogle: false });
try {
  process.chdir(homedir());
} catch {
}
process.env.OPENCODE_DISABLE_EMBEDDED_WEB_UI = "true";
const APP_NAMES = {
  dev: "Crewup Dev",
  beta: "Crewup Beta",
  prod: "Crewup"
};
const APP_IDS = {
  dev: "com.crewup.desktop.dev",
  beta: "com.crewup.desktop.beta",
  prod: "com.crewup.desktop"
};
const appId = app.isPackaged ? APP_IDS[CHANNEL] : "com.crewup.desktop.dev";
app.setName(app.isPackaged ? APP_NAMES[CHANNEL] : "Crewup Dev");
app.setAppUserModelId(appId);
app.setPath("userData", join(app.getPath("appData"), appId));
const { autoUpdater } = pkg;
const initEmitter = new EventEmitter();
let initStep = { phase: "server_waiting" };
let mainWindow = null;
let server = null;
const loadingComplete = defer();
const pendingDeepLinks = [];
const serverReady = defer();
const logger = initLogging();
logger.log("app starting", {
  version: app.getVersion(),
  packaged: app.isPackaged
});
setupApp();
function setupApp() {
  ensureLoopbackNoProxy();
  app.commandLine.appendSwitch("proxy-bypass-list", "<-loopback>");
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.on("second-instance", (_event, argv) => {
    const urls = argv.filter((arg) => arg.startsWith("opencode://"));
    if (urls.length) {
      logger.log("deep link received via second-instance", { urls });
      emitDeepLinks(urls);
    }
    focusMainWindow();
  });
  app.on("open-url", (event, url) => {
    event.preventDefault();
    logger.log("deep link received via open-url", { url });
    emitDeepLinks([url]);
  });
  app.on("before-quit", () => {
    killSidecar();
  });
  app.on("will-quit", () => {
    killSidecar();
  });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      killSidecar();
      app.exit(0);
    });
  }
  void app.whenReady().then(async () => {
    app.setAsDefaultProtocolClient("opencode");
    registerRendererProtocol();
    setDockIcon();
    await initialize();
  });
}
function emitDeepLinks(urls) {
  if (urls.length === 0) return;
  pendingDeepLinks.push(...urls);
  if (mainWindow) sendDeepLinks(mainWindow, urls);
}
function focusMainWindow() {
  if (!mainWindow) return;
  mainWindow.show();
  mainWindow.focus();
}
function setInitStep(step) {
  initStep = step;
  logger.log("init step", { step });
  initEmitter.emit("step", step);
}
async function initialize() {
  const needsMigration = !sqliteFileExists();
  const sqliteDone = needsMigration ? defer() : void 0;
  let overlay2 = null;
  const port = await getSidecarPort();
  const hostname = "127.0.0.1";
  const url = `http://${hostname}:${port}`;
  const password = randomUUID();
  const loadingTask = (async () => {
    logger.log("sidecar connection started", { url });
    initEmitter.on("sqlite", (progress) => {
      setInitStep({ phase: "sqlite_waiting" });
      if (overlay2) sendSqliteMigrationProgress(overlay2, progress);
      if (mainWindow) sendSqliteMigrationProgress(mainWindow, progress);
      if (progress.type === "Done") sqliteDone?.resolve();
    });
    if (needsMigration) {
      const { Database, JsonMigration } = await import("./chunks/node-9cvHhbTI.js");
      await JsonMigration.run(drizzle({ client: Database.Client().$client }), {
        progress: (event) => {
          const percent = Math.round(event.current / event.total) * 100;
          initEmitter.emit("sqlite", { type: "InProgress", value: percent });
        }
      });
      initEmitter.emit("sqlite", { type: "Done" });
      sqliteDone?.resolve();
    }
    if (needsMigration) {
      await sqliteDone?.promise;
    }
    logger.log("spawning sidecar", { url });
    const { listener, health } = await spawnLocalServer(hostname, port, password);
    server = listener;
    serverReady.resolve({
      url,
      username: "opencode",
      password
    });
    await Promise.race([
      health.wait,
      delay(3e4).then(() => {
        throw new Error("Sidecar health check timed out");
      })
    ]).catch((error) => {
      logger.error("sidecar health check failed", error);
    });
    logger.log("loading task finished");
  })();
  if (needsMigration) {
    const show = await Promise.race([loadingTask.then(() => false), delay(1e3).then(() => true)]);
    if (show) {
      overlay2 = createLoadingWindow();
      await delay(1e3);
    }
  }
  await loadingTask;
  setInitStep({ phase: "done" });
  if (overlay2) {
    await loadingComplete.promise;
  }
  mainWindow = createMainWindow();
  wireMenu();
  overlay2?.close();
}
function wireMenu() {
  if (!mainWindow) return;
  createMenu({
    trigger: (id) => mainWindow && sendMenuCommand(mainWindow, id),
    checkForUpdates: () => {
      void checkForUpdates();
    },
    reload: () => mainWindow?.reload(),
    relaunch: () => {
      killSidecar();
      app.relaunch();
      app.exit(0);
    }
  });
}
registerIpcHandlers({
  killSidecar: () => killSidecar(),
  awaitInitialization: async (sendStep) => {
    sendStep(initStep);
    const listener = (step) => sendStep(step);
    initEmitter.on("step", listener);
    try {
      logger.log("awaiting server ready");
      const res = await serverReady.promise;
      logger.log("server ready", { url: res.url });
      return res;
    } finally {
      initEmitter.off("step", listener);
    }
  },
  getWindowConfig: () => ({ updaterEnabled: UPDATER_ENABLED }),
  consumeInitialDeepLinks: () => pendingDeepLinks.splice(0),
  getDefaultServerUrl: () => getDefaultServerUrl(),
  setDefaultServerUrl: (url) => setDefaultServerUrl(url),
  getWslConfig: () => Promise.resolve(getWslConfig()),
  setWslConfig: (config) => setWslConfig(config),
  getDisplayBackend: async () => null,
  setDisplayBackend: async () => void 0,
  parseMarkdown: async (markdown) => parseMarkdown(markdown),
  checkAppExists: async (appName) => checkAppExists(appName),
  wslPath: async (path, mode) => wslPath(path, mode),
  resolveAppPath: async (appName) => resolveAppPath(appName),
  loadingWindowComplete: () => loadingComplete.resolve(),
  runUpdater: async (alertOnFail) => checkForUpdates(),
  checkUpdate: async () => checkUpdate(),
  installUpdate: async () => installUpdate(),
  setBackgroundColor: (color) => setBackgroundColor(color)
});
function killSidecar() {
  if (!server) return;
  server.stop();
  server = null;
}
function ensureLoopbackNoProxy() {
  const loopback = ["127.0.0.1", "localhost", "::1"];
  const upsert = (key) => {
    const items = (process.env[key] ?? "").split(",").map((value) => value.trim()).filter((value) => Boolean(value));
    for (const host of loopback) {
      if (items.some((value) => value.toLowerCase() === host)) continue;
      items.push(host);
    }
    process.env[key] = items.join(",");
  };
  upsert("NO_PROXY");
  upsert("no_proxy");
}
async function getSidecarPort() {
  const fromEnv = process.env.OPENCODE_PORT;
  if (fromEnv) {
    const parsed = Number.parseInt(fromEnv, 10);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return await new Promise((resolve2, reject) => {
    const server2 = createServer();
    server2.on("error", reject);
    server2.listen(0, "127.0.0.1", () => {
      const address = server2.address();
      if (typeof address !== "object" || !address) {
        server2.close();
        reject(new Error("Failed to get port"));
        return;
      }
      const port = address.port;
      server2.close(() => resolve2(port));
    });
  });
}
function sqliteFileExists() {
  const xdg = process.env.XDG_DATA_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".local", "share");
  return existsSync(join(base, "opencode", "opencode.db"));
}
async function checkUpdate() {
  return { updateAvailable: false };
}
async function installUpdate() {
  {
    logger.log("install update skipped", {
      reason: "no downloaded update ready"
    });
    return;
  }
}
async function checkForUpdates(alertOnFail) {
  return;
}
function delay(ms) {
  return new Promise((resolve2) => setTimeout(resolve2, ms));
}
function defer() {
  let resolve2;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve2 = res;
    reject = rej;
  });
  return { promise, resolve: resolve2, reject };
}
