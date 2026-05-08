"use strict";
const electron = require("electron");
const api = {
  killSidecar: () => electron.ipcRenderer.invoke("kill-sidecar"),
  installCli: () => electron.ipcRenderer.invoke("install-cli"),
  awaitInitialization: (onStep) => {
    const handler = (_, step) => onStep(step);
    electron.ipcRenderer.on("init-step", handler);
    return electron.ipcRenderer.invoke("await-initialization").finally(() => {
      electron.ipcRenderer.removeListener("init-step", handler);
    });
  },
  getWindowConfig: () => electron.ipcRenderer.invoke("get-window-config"),
  consumeInitialDeepLinks: () => electron.ipcRenderer.invoke("consume-initial-deep-links"),
  getDefaultServerUrl: () => electron.ipcRenderer.invoke("get-default-server-url"),
  setDefaultServerUrl: (url) => electron.ipcRenderer.invoke("set-default-server-url", url),
  getWslConfig: () => electron.ipcRenderer.invoke("get-wsl-config"),
  setWslConfig: (config) => electron.ipcRenderer.invoke("set-wsl-config", config),
  getDisplayBackend: () => electron.ipcRenderer.invoke("get-display-backend"),
  setDisplayBackend: (backend) => electron.ipcRenderer.invoke("set-display-backend", backend),
  parseMarkdownCommand: (markdown) => electron.ipcRenderer.invoke("parse-markdown", markdown),
  checkAppExists: (appName) => electron.ipcRenderer.invoke("check-app-exists", appName),
  wslPath: (path, mode) => electron.ipcRenderer.invoke("wsl-path", path, mode),
  resolveAppPath: (appName) => electron.ipcRenderer.invoke("resolve-app-path", appName),
  storeGet: (name, key) => electron.ipcRenderer.invoke("store-get", name, key),
  storeSet: (name, key, value) => electron.ipcRenderer.invoke("store-set", name, key, value),
  storeDelete: (name, key) => electron.ipcRenderer.invoke("store-delete", name, key),
  storeClear: (name) => electron.ipcRenderer.invoke("store-clear", name),
  storeKeys: (name) => electron.ipcRenderer.invoke("store-keys", name),
  storeLength: (name) => electron.ipcRenderer.invoke("store-length", name),
  getWindowCount: () => electron.ipcRenderer.invoke("get-window-count"),
  onSqliteMigrationProgress: (cb) => {
    const handler = (_, progress) => cb(progress);
    electron.ipcRenderer.on("sqlite-migration-progress", handler);
    return () => electron.ipcRenderer.removeListener("sqlite-migration-progress", handler);
  },
  onMenuCommand: (cb) => {
    const handler = (_, id) => cb(id);
    electron.ipcRenderer.on("menu-command", handler);
    return () => electron.ipcRenderer.removeListener("menu-command", handler);
  },
  onDeepLink: (cb) => {
    const handler = (_, urls) => cb(urls);
    electron.ipcRenderer.on("deep-link", handler);
    return () => electron.ipcRenderer.removeListener("deep-link", handler);
  },
  openDirectoryPicker: (opts) => electron.ipcRenderer.invoke("open-directory-picker", opts),
  openFilePicker: (opts) => electron.ipcRenderer.invoke("open-file-picker", opts),
  saveFilePicker: (opts) => electron.ipcRenderer.invoke("save-file-picker", opts),
  openLink: (url) => electron.ipcRenderer.send("open-link", url),
  openPath: (path, app) => electron.ipcRenderer.invoke("open-path", path, app),
  readClipboardImage: () => electron.ipcRenderer.invoke("read-clipboard-image"),
  showNotification: (title, body) => electron.ipcRenderer.send("show-notification", title, body),
  getWindowFocused: () => electron.ipcRenderer.invoke("get-window-focused"),
  setWindowFocus: () => electron.ipcRenderer.invoke("set-window-focus"),
  showWindow: () => electron.ipcRenderer.invoke("show-window"),
  relaunch: () => electron.ipcRenderer.send("relaunch"),
  getZoomFactor: () => electron.ipcRenderer.invoke("get-zoom-factor"),
  setZoomFactor: (factor) => electron.ipcRenderer.invoke("set-zoom-factor", factor),
  setTitlebar: (theme) => electron.ipcRenderer.invoke("set-titlebar", theme),
  loadingWindowComplete: () => electron.ipcRenderer.send("loading-window-complete"),
  runUpdater: (alertOnFail) => electron.ipcRenderer.invoke("run-updater", alertOnFail),
  checkUpdate: () => electron.ipcRenderer.invoke("check-update"),
  installUpdate: () => electron.ipcRenderer.invoke("install-update"),
  setBackgroundColor: (color) => electron.ipcRenderer.invoke("set-background-color", color)
};
electron.contextBridge.exposeInMainWorld("api", api);
