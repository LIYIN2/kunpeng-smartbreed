const { app, BrowserWindow, dialog, Menu, shell, session, ipcMain } = require('electron');
const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const fs = require('fs');
const os = require('os');
const PROJECT_URL = 'https://github.com/LIYIN2/kunpeng-smartbreed';
const PRODUCT_NAME = '鲲鹏智能体';

const PORT = 3080;
const APP_URL = `http://127.0.0.1:${PORT}`;

// The backend is copied out of the app bundle into the user home on first run,
// so the bundle itself stays pristine (and works from read-only mounts).
const RUNTIME_ROOT = path.join(os.homedir(), '.dsh', 'runtime');
const RUNTIME_DSH = path.join(RUNTIME_ROOT, 'dsh');
const BOOTSTRAP_LOG = path.join(RUNTIME_ROOT, 'bootstrap.log');
const VERSION_MARKER = '.desktop-version';
const DEV_DIR = path.join(__dirname, '..', 'dsh');

let serverProcess = null;
let mainWindow = null;
let aboutWindow = null;
let chatWindow = null;
let aizexWindow = null;

// Create a diagnostic trail before Electron finishes booting. If startup
// fails before the server exists, Windows users still get a useful file.
try {
  fs.mkdirSync(RUNTIME_ROOT, { recursive: true });
  fs.appendFileSync(BOOTSTRAP_LOG, `\n=== ${new Date().toISOString()} ${PRODUCT_NAME} ${app.getVersion()} ${process.platform}-${process.arch} ===\n`);
} catch (_) {
  /* A later dialog will surface an unwritable home directory. */
}
process.on('uncaughtException', (error) => {
  log('UNCAUGHT: ' + (error && error.stack ? error.stack : String(error)));
  dialog.showErrorBox(PRODUCT_NAME + '启动失败', '程序发生未处理错误。诊断日志：' + BOOTSTRAP_LOG + '\n\n' + String(error));
  app.quit();
});
process.on('unhandledRejection', (error) => {
  log('UNHANDLED_REJECTION: ' + (error && error.stack ? error.stack : String(error)));
});

const AIZEX_URL = 'https://aizex.net/plusPool';
const AIZEX_ACCOUNT_FILE = path.join(os.homedir(), '.dsh', '.aizex-account.json');
// Aizex 登录走 Authing 托管的 OIDC 登录页(aizex.authing.cn),必须放行这些域名
// 才能在软件窗口内完成登录,而不是跳去系统浏览器。
const AIZEX_ALLOWED_HOSTS = ['aizex.net', 'authing.cn'];
let aizexLoginUrl = null; // 最近一次跳转到的 Authing 登录 URL
let lastAizexForcedAt = 0; // 上次强制停靠登录页的时间戳,防止死循环
let aizexAccountWindow = null;
let musicWindow = null;
let settingsWindow = null;
let controlToken = '';
let workspaceLaunchPromise = null;

function isAllowedAizexHost(url) {
  try {
    const host = new URL(url).hostname;
    return AIZEX_ALLOWED_HOSTS.some((h) => host === h || host.endsWith('.' + h));
  } catch {
    return false;
  }
}

const CREDENTIALS_FILE = path.join(os.homedir(), '.dsh', '.credentials.yaml');
const CUSTOM_PROVIDERS_FILE = path.join(os.homedir(), '.dsh', '.custom-providers.json');
const RESEARCH_RADAR_FILE = path.join(os.homedir(), '.dsh', 'research-radar.json');
const CONTROL_CLIENT_FILE = path.join(os.homedir(), '.dsh', 'control-plane-client.json');
const CONTROL_TOKEN_FILE = path.join(os.homedir(), '.dsh', '.control-plane-token');
const DEFAULT_CONTROL_URL = 'http://127.0.0.1:4789';
const RESEARCH_JOURNALS = [
  { name: 'Aquaculture', issn: '0044-8486' },
  { name: 'Marine Life Science & Technology', issn: '2662-1746' },
  { name: 'Genetics Selection Evolution', issn: '1297-9686' },
];

const CHAT_PROVIDERS = {
  deepseek: {
    label: 'DeepSeek',
    keyEnv: 'DEEPSEEK_API_KEY',
    baseUrl: 'https://api.deepseek.com/chat/completions',
    defaultModel: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-v4-flash'],
  },
  openai: {
    label: 'OpenAI (ChatGPT)',
    keyEnv: 'OPENAI_API_KEY',
    baseUrl: 'https://api.openai.com/v1/chat/completions',
    defaultModel: 'gpt-5',
    models: ['gpt-5', 'gpt-5-mini', 'gpt-4.1', 'gpt-4o'],
  },
  arccodex: {
    label: 'Arc Codex',
    keyEnv: 'ARCCODEX_API_KEY',
    baseUrl: 'https://www.arccodex.com/api/v1/chat/completions',
    defaultModel: 'gpt-5-codex',
    models: ['gpt-5-codex', 'gpt-5-mini-codex', 'claude-sonnet-4-codex', 'claude-opus-4-codex'],
  },
};

function readCustomProviders() {
  try {
    return JSON.parse(fs.readFileSync(CUSTOM_PROVIDERS_FILE, 'utf8')) || [];
  } catch {
    return [];
  }
}

function writeCustomProviders(list) {
  fs.mkdirSync(path.dirname(CUSTOM_PROVIDERS_FILE), { recursive: true });
  fs.writeFileSync(CUSTOM_PROVIDERS_FILE, JSON.stringify(list, null, 2), { mode: 0o600 });
}

function normalizeControlUrl(value) {
  const url = new URL(String(value || DEFAULT_CONTROL_URL).trim());
  const local = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new Error('远程管理中心必须使用 HTTPS');
  return url.origin;
}

function readControlUrl() {
  try { return normalizeControlUrl(JSON.parse(fs.readFileSync(CONTROL_CLIENT_FILE, 'utf8')).baseUrl); }
  catch { return DEFAULT_CONTROL_URL; }
}

function saveControlUrl(baseUrl) {
  const normalized = normalizeControlUrl(baseUrl);
  fs.mkdirSync(path.dirname(CONTROL_CLIENT_FILE), { recursive: true });
  fs.writeFileSync(CONTROL_CLIENT_FILE, JSON.stringify({ baseUrl: normalized }, null, 2), { mode: 0o600 });
  return normalized;
}

function loadControlToken() {
  return controlToken;
}

function saveControlToken(token) {
  // Ad-hoc signed lab builds do not have a stable macOS Keychain identity.
  // Keep the 12-hour bearer session in process memory so startup never blocks
  // on a Keychain approval dialog; passwords and session tokens are not saved.
  controlToken = token;
  try { fs.unlinkSync(CONTROL_TOKEN_FILE); } catch (_) { /* no legacy saved session */ }
}

function clearControlToken() {
  controlToken = '';
  try { fs.unlinkSync(CONTROL_TOKEN_FILE); } catch (_) { /* no saved session */ }
}

async function controlRequest(route, options = {}) {
  const token = options.auth === false ? '' : loadControlToken();
  const headers = { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) };
  const response = await fetch(readControlUrl() + route, { ...options, headers, signal: AbortSignal.timeout(8000) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.error || `HTTP ${response.status}`), { status: response.status });
  return payload;
}

function readResearchRadar() {
  try { return JSON.parse(fs.readFileSync(RESEARCH_RADAR_FILE, 'utf8')); }
  catch (_) { return { updatedAt: null, articles: [], error: null }; }
}

function crossrefDate(item) {
  const parts = (item['published-online'] || item.published || item.issued || {})['date-parts'];
  if (!Array.isArray(parts) || !Array.isArray(parts[0])) return null;
  const [year, month = 1, day = 1] = parts[0];
  return [year, String(month).padStart(2, '0'), String(day).padStart(2, '0')].join('-');
}

async function refreshResearchRadar() {
  const articles = [];
  const since = new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10);
  for (const journal of RESEARCH_JOURNALS) {
    const endpoint = new URL(`https://api.crossref.org/journals/${journal.issn}/works`);
    endpoint.searchParams.set('filter', `from-online-pub-date:${since},type:journal-article`);
    endpoint.searchParams.set('sort', 'published-online'); endpoint.searchParams.set('order', 'desc'); endpoint.searchParams.set('rows', '8');
    endpoint.searchParams.set('select', 'DOI,title,author,published,published-online,issued,URL,abstract');
    const response = await fetch(endpoint, { headers: { 'User-Agent': `KunpengResearchAgent/${app.getVersion()} (mailto:liyin59375@gmail.com)` } });
    if (!response.ok) throw new Error(`${journal.name}: Crossref HTTP ${response.status}`);
    const payload = await response.json();
    for (const item of payload.message.items || []) {
      const authors = (item.author || []).map((author) => [author.given, author.family].filter(Boolean).join(' ')).filter(Boolean);
      const abstract = String(item.abstract || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      articles.push({ journal: journal.name, title: item.title && item.title[0] || 'Untitled', doi: item.DOI || '', url: item.URL || (item.DOI ? `https://doi.org/${item.DOI}` : ''), date: crossrefDate(item), authors, abstract });
    }
  }
  const unique = [...new Map(articles.map(article => [article.doi || `${article.journal}:${article.title}`, article])).values()]
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const result = { updatedAt: new Date().toISOString(), source: 'Crossref metadata', evidenceLevel: '仅基于题录/摘要', articles: unique, error: null };
  fs.mkdirSync(path.dirname(RESEARCH_RADAR_FILE), { recursive: true }); fs.writeFileSync(RESEARCH_RADAR_FILE, JSON.stringify(result, null, 2));
  return result;
}

function allChatProviders() {
  const out = {};
  for (const [id, p] of Object.entries(CHAT_PROVIDERS)) out[id] = p;
  for (const c of readCustomProviders()) {
    if (c && c.id && c.baseUrl) {
      out[c.id] = {
        label: c.label || c.id,
        keyEnv: 'CUSTOM_KEY_' + c.id,
        baseUrl: c.baseUrl,
        defaultModel: c.defaultModel || (c.models && c.models[0]) || '',
        models: c.models && c.models.length ? c.models : [],
        custom: true,
      };
    }
  }
  return out;
}

function isValidCheckout(dir) {
  return dir && fs.existsSync(path.join(dir, 'apps', 'cli', 'src', 'bin.ts'));
}

// macOS privacy (TCC) protects Desktop/Documents/Downloads. When an app is
// launched from Finder, getcwd() on a working directory inside those folders
// can hang forever, so the backend must never run from there. It is copied to
// the user home (~/.dsh/runtime) instead.
function isTccProtected(dir) {
  const home = os.homedir();
  return ['Desktop', 'Documents', 'Downloads'].some((name) => {
    const root = path.join(home, name);
    return dir === root || dir.startsWith(root + path.sep);
  });
}

function bundledDshDir() {
  return path.join(process.resourcesPath || '', 'dsh');
}

function bundledNodeRoot() {
  return path.join(process.resourcesPath || '', 'node');
}

function bundledNodeBin() {
  const root = bundledNodeRoot();
  return process.platform === 'win32'
    ? path.join(root, 'node.exe')
    : path.join(root, 'bin', 'node');
}

function bundledNpxCli() {
  const root = bundledNodeRoot();
  return process.platform === 'win32'
    ? path.join(root, 'node_modules', 'npm', 'bin', 'npx-cli.js')
    : path.join(root, 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js');
}

function loadConfig() {
  const cfgPath = path.join(process.resourcesPath || '', 'dsh.config.json');
  if (fs.existsSync(cfgPath)) {
    try {
      return JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    } catch (_) {
      /* ignore malformed config */
    }
  }
  return null;
}

function resolveDshDir() {
  const cfg = loadConfig();
  if (process.env.DSH_DIR && isValidCheckout(process.env.DSH_DIR)) return process.env.DSH_DIR;
  if (cfg && isValidCheckout(cfg.dshDir)) return cfg.dshDir;
  // A packaged build must compare its own version marker with the runtime
  // cache before selecting that cache. Otherwise an older ~/.dsh/runtime copy
  // wins forever and a newly installed UI/preset is never synchronized.
  if (isValidCheckout(bundledDshDir())) return bundledDshDir();
  if (fs.existsSync(RUNTIME_DSH)) return RUNTIME_DSH;
  if (isValidCheckout(DEV_DIR)) return DEV_DIR;
  return null;
}

function findNode() {
  const b = bundledNodeBin();
  if (fs.existsSync(b)) return b;
  const cfg = loadConfig();
  const candidates = [
    cfg && cfg.nodeBin,
    process.env.DSH_NODE,
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
    '/usr/bin/node',
    'node',
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return 'node';
}

function envWithNodePath() {
  const binDir = path.dirname(findNode());
  return {
    ...process.env,
    PATH: [binDir, process.env.PATH].filter(Boolean).join(path.delimiter),
  };
}

function portOpen(port, host = '127.0.0.1', timeout = 600) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    const done = (ok) => {
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeout);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
    sock.connect(port, host);
  });
}

function log(line) {
  try {
    fs.appendFileSync(BOOTSTRAP_LOG, line + '\n');
  } catch (_) {
    /* ignore */
  }
}

function setStatus(text) {
  log('STATUS: ' + text);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.executeJavaScript(
      `document.getElementById('status').textContent = ${JSON.stringify(text)}`,
    ).catch(() => {});
  }
}

function runStep(name, args) {
  log('--- ' + name + ': ' + args.join(' '));
  return new Promise((resolve) => {
    const child = spawn(findNode(), args, {
      cwd: RUNTIME_DSH,
      env: envWithNodePath(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d;
    });
    child.stderr.on('data', (d) => {
      out += d;
    });
    child.on('close', (code) => {
      log(out.slice(-4000));
      resolve(code === 0);
    });
  });
}

async function bootstrapDsh() {
  setStatus('正在安装依赖(首次运行,需要联网)…');
  let ok = await runStep('pnpm install', [bundledNpxCli(), 'pnpm@11.7.0', 'install']);
  if (!ok) return false;
  setStatus('正在构建,请稍候…');
  ok = await runStep('pnpm build', [bundledNpxCli(), 'pnpm@11.7.0', 'run', 'build']);
  return ok;
}

async function ensureServer() {
  log(`resources=${process.resourcesPath} home=${os.homedir()} node=${findNode()}`);
  if (await portOpen(PORT)) return; // an instance is already serving

  let dshDir = resolveDshDir();
  if (!dshDir) {
    dialog.showErrorBox(
      PRODUCT_NAME + '运行组件未找到',
      '找不到底层 Harness 运行组件。请确认安装包完整，或通过 dsh.config.json 指定源码位置。',
    );
    throw new Error('DSH checkout not found');
  }

  // First run from the bundled copy: move it into ~/.dsh/runtime so the app
  // bundle stays pristine and dependencies can be installed.
  // Bundled or TCC-protected sources always run from the home runtime copy,
  // so the bundle stays pristine and macOS privacy rules cannot stall boot.
  const runFromRuntime =
    dshDir === bundledDshDir() || (isTccProtected(dshDir) && dshDir !== DEV_DIR);
  // Version marker: the bundle carries its desktop version so a newer
  // installation re-syncs the runtime copy (picking up new presets/skills).
  const bundleVersion = path.join(bundledDshDir(), VERSION_MARKER);
  const runtimeVersion = path.join(RUNTIME_DSH, VERSION_MARKER);
  const readMarker = (p) => {
    try { return fs.readFileSync(p, 'utf8').trim(); } catch (_) { return null; }
  };
  const needSync =
    !fs.existsSync(RUNTIME_DSH) ||
    (runFromRuntime && readMarker(bundleVersion) !== readMarker(runtimeVersion) && readMarker(bundleVersion) !== null);
  if (runFromRuntime && needSync) {
    setStatus('正在准备鲲鹏智能体运行环境…');
    log('copying ' + dshDir + ' -> ' + RUNTIME_DSH);
    fs.mkdirSync(RUNTIME_ROOT, { recursive: true });
    try {
      // Replace the previous runtime copy so new presets/skills take effect.
      if (fs.existsSync(RUNTIME_DSH)) fs.rmSync(RUNTIME_DSH, { recursive: true, force: true });
      fs.cpSync(dshDir, RUNTIME_DSH, { recursive: true });
    } catch (err) {
      dialog.showErrorBox(
        '无法访问源码目录',
        '无法将 Harness 运行组件复制到运行目录(~/.dsh/runtime)。\n请把源码移出「桌面/文稿/下载」等受保护目录，或在系统设置的「隐私与安全性」中为本应用授予相应访问权限。\n\n' + err.message,
      );
      throw err;
    }
    dshDir = RUNTIME_DSH;
  } else if (runFromRuntime) {
    dshDir = RUNTIME_DSH;
  }

  if (!fs.existsSync(path.join(dshDir, 'node_modules'))) {
    const ok = await bootstrapDsh();
    if (!ok) {
      dialog.showErrorBox(
        '初始化失败',
        '依赖安装或构建失败,请查看日志: ' + BOOTSTRAP_LOG,
      );
      throw new Error('bootstrap failed');
    }
  }

  const compiledCli = [
    path.join(dshDir, 'lib', 'bin.js'),
    path.join(dshDir, 'apps', 'cli', 'lib', 'bin.js'),
  ].find(candidate => fs.existsSync(candidate));
  const sourceCli = path.join(dshDir, 'apps', 'cli', 'src', 'bin.ts');
  const serverArgs = compiledCli
    ? [compiledCli, 'web']
    : ['--import', 'tsx/esm', sourceCli, 'web'];
  log('starting server: ' + findNode() + ' ' + serverArgs.join(' '));
  serverProcess = spawn(
    findNode(),
    serverArgs,
    {
      cwd: dshDir,
      env: envWithNodePath(),
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  serverProcess.stdout.on('data', (data) => { log('SERVER: ' + String(data).trimEnd()); });
  serverProcess.stderr.on('data', (data) => { log('SERVER_ERR: ' + String(data).trimEnd()); });
  serverProcess.on('error', (error) => { log('SERVER_SPAWN_ERROR: ' + error.stack); });
  serverProcess.on('exit', (code, signal) => {
    log(`SERVER_EXIT: code=${code} signal=${signal}`);
    serverProcess = null;
  });

  // Wait up to 120s for the web server to come up.
  for (let i = 0; i < 240; i += 1) {
    if (await portOpen(PORT)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('DSH web server did not start in time');
}

async function launchWorkspace() {
  if (workspaceLaunchPromise) return workspaceLaunchPromise;
  workspaceLaunchPromise = (async () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadFile(path.join(__dirname, 'loading.html'));
    await ensureServer();
    if (mainWindow && !mainWindow.isDestroyed()) await mainWindow.loadURL(APP_URL);
  })().finally(() => { workspaceLaunchPromise = null; });
  return workspaceLaunchPromise;
}

async function showLoginOrWorkspace() {
  try {
    await controlRequest('/api/health', { auth: false });
    if (loadControlToken()) {
      try { await controlRequest('/api/me'); await launchWorkspace(); return; }
      catch (error) { if (error.status === 401) clearControlToken(); else throw error; }
    }
  } catch (error) {
    log('CONTROL_PLANE_STATUS: ' + String(error.message || error));
  }
  if (mainWindow && !mainWindow.isDestroyed()) await mainWindow.loadFile(path.join(__dirname, 'login.html'));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: PRODUCT_NAME,
    backgroundColor: '#061723',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'loading.html'));
  return win;
}

function showAboutWindow() {
  if (aboutWindow && !aboutWindow.isDestroyed()) {
    aboutWindow.focus();
    return;
  }
  aboutWindow = new BrowserWindow({
    width: 400,
    height: 320,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: '关于鲲鹏智能体',
    backgroundColor: '#0b0b0f',
    webPreferences: {
      sandbox: true,
    },
  });
  aboutWindow.setMenuBarVisibility(false);
  aboutWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('mailto:')) shell.openExternal(url);
    return { action: 'deny' };
  });
  aboutWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('mailto:')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
  aboutWindow.loadFile(path.join(__dirname, 'about.html'));
  aboutWindow.on('closed', () => {
    aboutWindow = null;
  });
}

function readCredentials() {
  const out = {};
  try {
    const text = fs.readFileSync(CREDENTIALS_FILE, 'utf8');
    for (const line of text.split('\n')) {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
      if (m) out[m[1]] = m[2].trim();
    }
  } catch (_) {
    /* file not present yet */
  }
  return out;
}

function writeCredential(key, value) {
  const creds = readCredentials();
  creds[key] = value;
  fs.mkdirSync(path.dirname(CREDENTIALS_FILE), { recursive: true });
  const body = Object.entries(creds)
    .map(([k, v]) => k + ': ' + v)
    .join('\n') + '\n';
  fs.writeFileSync(CREDENTIALS_FILE, body, { mode: 0o600 });
}

function readAizexAccount() {
  try {
    const text = fs.readFileSync(AIZEX_ACCOUNT_FILE, 'utf8');
    const j = JSON.parse(text);
    return { email: j.email || '', password: j.password || '' };
  } catch {
    return { email: '', password: '' };
  }
}

function writeAizexAccount(email, password) {
  fs.mkdirSync(path.dirname(AIZEX_ACCOUNT_FILE), { recursive: true });
  fs.writeFileSync(AIZEX_ACCOUNT_FILE, JSON.stringify({ email, password }), { mode: 0o600 });
}

function registerChatIpc() {
  registerMusicIpc();
  ipcMain.on('launcher:open', (_event, kind) => {
    if (kind === 'aizex') openAizexWindow();
    else if (kind === 'music') openMusicWindow();
    else if (kind === 'github') shell.openExternal(PROJECT_URL);
    else openChatWindow();
  });
  ipcMain.handle('aizex-account:get', () => readAizexAccount());
  ipcMain.handle('aizex-account:save', (_event, email, password) => {
    writeAizexAccount(String(email || '').trim(), String(password || ''));
    return true;
  });

  ipcMain.handle('chat:get-config', () => {
    const creds = readCredentials();
    const providers = allChatProviders();
    return {
      providers: Object.entries(providers).map(([id, p]) => ({
        id,
        label: p.label,
        baseUrl: p.baseUrl,
        defaultModel: p.defaultModel,
        models: p.models,
        hasKey: Boolean(creds[p.keyEnv]),
        custom: Boolean(p.custom),
      })),
    };
  });

  ipcMain.handle('chat:save-key', (_event, providerId, key) => {
    const p = allChatProviders()[providerId];
    if (!p) throw new Error('unknown provider');
    writeCredential(p.keyEnv, key.trim());
    return true;
  });

  ipcMain.handle('chat:custom-providers:get', () => readCustomProviders());
  ipcMain.handle('chat:custom-providers:save', (_event, list) => {
    const clean = (Array.isArray(list) ? list : [])
      .filter((c) => c && c.baseUrl && String(c.baseUrl).startsWith('http'))
      .map((c) => ({
        id: String(c.id || '').trim() || 'custom' + Date.now(),
        label: String(c.label || '').trim() || '自定义 API',
        baseUrl: String(c.baseUrl).trim(),
        defaultModel: String(c.defaultModel || '').trim(),
        models: (Array.isArray(c.models) ? c.models : String(c.models || '').split(/[,\n]/))
          .map((m) => String(m).trim())
          .filter(Boolean),
      }));
    writeCustomProviders(clean);
    return true;
  });
  ipcMain.handle('research-radar:get', () => readResearchRadar());
  ipcMain.handle('research-radar:refresh', async () => {
    try { return await refreshResearchRadar(); }
    catch (error) {
      const previous = readResearchRadar();
      const result = { ...previous, error: String(error), failedAt: new Date().toISOString() };
      fs.mkdirSync(path.dirname(RESEARCH_RADAR_FILE), { recursive: true }); fs.writeFileSync(RESEARCH_RADAR_FILE, JSON.stringify(result, null, 2));
      return result;
    }
  });
  ipcMain.handle('control:status', async () => {
    try {
      const health = await controlRequest('/api/health', { auth: false });
      let user = null;
      if (loadControlToken()) {
        try { user = (await controlRequest('/api/me')).user; }
        catch (error) { if (error.status === 401) clearControlToken(); }
      }
      return { ok: true, baseUrl: readControlUrl(), ownerConfigured: health.ownerConfigured, user };
    } catch (error) { return { ok: false, baseUrl: readControlUrl(), error: String(error.message || error) }; }
  });
  ipcMain.handle('control:login', async (_event, payload) => {
    const baseUrl = saveControlUrl(payload.baseUrl);
    const result = await controlRequest('/api/auth/login', { auth: false, method: 'POST', body: JSON.stringify({ email: payload.email, password: payload.password }) });
    saveControlToken(result.token);
    if (!result.user.mustChangePassword) setImmediate(() => { void launchWorkspace().catch(error => { log('WORKSPACE_LAUNCH_ERROR: ' + error.stack); dialog.showErrorBox('启动失败', String(error.message || error)); }); });
    return { baseUrl, user: result.user, expiresAt: result.expiresAt };
  });
  ipcMain.handle('control:change-password', async (_event, payload) => {
    await controlRequest('/api/me/password', { method: 'POST', body: JSON.stringify({ currentPassword: payload.currentPassword, newPassword: payload.newPassword }) });
    setImmediate(() => { void launchWorkspace().catch(error => { log('WORKSPACE_LAUNCH_ERROR: ' + error.stack); dialog.showErrorBox('启动失败', String(error.message || error)); }); });
    return true;
  });
  ipcMain.handle('control:logout', async () => {
    try { await controlRequest('/api/auth/logout', { method: 'POST' }); } catch (_) { /* local logout still proceeds */ }
    clearControlToken();
    if (mainWindow && !mainWindow.isDestroyed()) await mainWindow.loadFile(path.join(__dirname, 'login.html'));
    return true;
  });
  ipcMain.handle('control:open-admin', () => { shell.openExternal(readControlUrl()); return true; });
  ipcMain.handle('control:knowledge-submit', async (_event, payload) => {
    return await controlRequest('/api/knowledge', { method: 'POST', body: JSON.stringify(payload) });
  });
  ipcMain.handle('control:feedback-submit', async (_event, payload) => {
    return await controlRequest('/api/feedback', { method: 'POST', body: JSON.stringify(payload) });
  });

  const handleChatSend = async (event, payload) => {
    const p = allChatProviders()[payload.provider];
    const creds = readCredentials();
    const apiKey = p ? creds[p.keyEnv] : '';
    const requestId = payload.requestId;
    if (!p || !apiKey) {
      event.sender.send('chat:done', { requestId, ok: false, error: '未配置 API Key' });
      return;
    }
    try {
      const body = {
        model: payload.model,
        messages: payload.messages,
        stream: true,
      };
      // 推理强度:Codex 风格参数(reasoning_effort),部分服务也接受 thinking/reasoning。
      if (payload.reasoningEffort) body.reasoning_effort = payload.reasoningEffort;
      const res = await fetch(p.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + apiKey,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        let detail = '';
        try {
          const j = await res.json();
          detail = (j.error && j.error.message) || JSON.stringify(j);
        } catch (_) {
          detail = await res.text();
        }
        event.sender.send('chat:done', {
          requestId,
          ok: false,
          error: 'HTTP ' + res.status + ': ' + detail,
        });
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let chunkCount = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunkCount += 1;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          const t = line.trim();
          if (!t.startsWith('data:')) continue;
          const data = t.slice(5).trim();
          if (data === '[DONE]') continue;
          try {
            const j = JSON.parse(data);
            const delta = j.choices && j.choices[0] && j.choices[0].delta
              ? j.choices[0].delta.content
              : '';
            if (delta) event.sender.send('chat:chunk', { requestId, text: delta });
          } catch (_) {
            /* ignore malformed SSE frame */
          }
        }
      }
      event.sender.send('chat:done', { requestId, ok: true });
    } catch (err) {
      event.sender.send('chat:done', {
        requestId,
        ok: false,
        error: String((err && err.message) || err),
      });
    }
  };
  ipcMain.on('chat:send', (event, payload) => {
    void handleChatSend(event, payload);
  });
}

function openChatWindow() {
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.focus();
    return;
  }
  chatWindow = new BrowserWindow({
    width: 920,
    height: 720,
    minWidth: 640,
    minHeight: 480,
    title: '鲲鹏智能体 · 多模型对话',
    backgroundColor: '#0b0b0f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  chatWindow.setMenuBarVisibility(false);
  chatWindow.loadFile(path.join(__dirname, 'chat.html'));
  chatWindow.on('closed', () => {
    chatWindow = null;
  });
}

function openAizexAccountWindow() {
  if (aizexAccountWindow && !aizexAccountWindow.isDestroyed()) {
    aizexAccountWindow.focus();
    return;
  }
  aizexAccountWindow = new BrowserWindow({
    width: 460,
    height: 360,
    resizable: false,
    title: 'Aizex 账号',
    backgroundColor: '#0b0b0f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  aizexAccountWindow.setMenuBarVisibility(false);
  aizexAccountWindow.loadFile(path.join(__dirname, 'aizex-account.html'));
  aizexAccountWindow.on('closed', () => {
    aizexAccountWindow = null;
  });
}

function openMusicWindow() {
  if (musicWindow && !musicWindow.isDestroyed()) {
    if (!musicWindow.isVisible()) musicWindow.show();
    musicWindow.focus();
    return;
  }
  musicWindow = new BrowserWindow({
    width: 520,
    height: 108,
    minWidth: 520,
    minHeight: 108,
    maxWidth: 520,
    maxHeight: 108,
    resizable: false,
    maximizable: false,
    title: '音乐',
    backgroundColor: '#0d0e14',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  musicWindow.setContentSize(520, 108);
  musicWindow.setMenuBarVisibility(false);
  musicWindow.loadFile(path.join(__dirname, 'music.html'));
  musicWindow.on('closed', () => {
    musicWindow = null;
  });
}

function registerMusicIpc() {
  ipcMain.on('music:minimize', () => {
    if (musicWindow && !musicWindow.isDestroyed()) musicWindow.minimize();
  });
  ipcMain.on('music:hide', () => {
    if (musicWindow && !musicWindow.isDestroyed()) musicWindow.hide();
  });
  ipcMain.on('music:expand', () => {
    if (musicWindow && !musicWindow.isDestroyed()) {
      musicWindow.setResizable(true);
      musicWindow.setMinimumSize(860, 580);
      musicWindow.setContentSize(1100, 720);
    }
  });
  ipcMain.on('music:compact', () => {
    if (musicWindow && !musicWindow.isDestroyed()) {
      musicWindow.setContentSize(520, 108);
      musicWindow.setMinimumSize(520, 108);
      musicWindow.setResizable(false);
    }
  });
}

function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 480,
    height: 560,
    resizable: false,
    title: '配置',
    backgroundColor: '#0b0b0f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  settingsWindow.setMenuBarVisibility(false);
  settingsWindow.loadFile(path.join(__dirname, 'settings.html'));
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

function ensureAizexCookieFix() {
  // Aizex 登录的 OIDC 交互 cookie(interaction-oidc-idp)是在跨域 fetch 的 302 响应里
  // 下发的,Chromium 出于安全策略不会保存跨域 fetch 的 Set-Cookie,导致 Authing 丢失
  // 交互会话(登录成功后跳转 /interaction/oidc/{id}/login 返回 404,且浏览器被弹开)。
  // 因此由主进程拦截响应,手动补写该 cookie。只注册一次。
  if (ensureAizexCookieFix.done) return;
  ensureAizexCookieFix.done = true;
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (details.url.includes('authing.cn')) {
      const sc = details.responseHeaders && details.responseHeaders['set-cookie'];
      if (Array.isArray(sc)) {
        for (const line of sc) {
          if (line.includes('interaction-oidc-idp=')) {
            const m = line.match(/interaction-oidc-idp=([^;]+)/);
            if (m) {
              // 本文件顶部曾定义常量 URL(后端地址)会覆盖全局构造函数,已改名 APP_URL,
              // 这里仍用 global.URL 确保万无一失。
              const url = new global.URL(details.url);
              session.defaultSession.cookies
                .set({
                  url: url.origin + '/',
                  name: 'interaction-oidc-idp',
                  value: m[1],
                  expirationDate: Math.floor(Date.now() / 1000) + 3600,
                  secure: true,
                  httpOnly: true,
                  sameSite: 'no_restriction',
                  path: '/',
                })
                .catch(() => {});
            }
          }
        }
      }
    }
    callback({ responseHeaders: details.responseHeaders });
  });
}

function openAizexWindow() {
  if (aizexWindow && !aizexWindow.isDestroyed()) {
    aizexWindow.focus();
    return;
  }
  ensureAizexCookieFix();
  aizexWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 800,
    minHeight: 600,
    title: 'Aizex 聊天',
    backgroundColor: '#0b0b0f',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  aizexWindow.setMenuBarVisibility(false);
  // 第三方站点:伪装成普通 Chrome,避免被识别为 Electron 而拒绝服务。
  aizexWindow.webContents.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  );
  aizexWindow.webContents.setWindowOpenHandler(({ url }) => {
    // 登录流程(认证弹窗/OIDC 回调)属于 aizex.net / authing.cn 域,必须在窗口内完成,
    // 否则会被丢去系统浏览器,导致 OIDC 会话中断和 404。只有真正的站外链接才走系统浏览器。
    if (url.startsWith('http') && !isAllowedAizexHost(url)) shell.openExternal(url);
    else if (url.startsWith('http')) aizexWindow.loadURL(url);
    return { action: 'deny' };
  });
  aizexWindow.webContents.on('will-navigate', (event, url) => {
    // 记录登录页 URL,供强制停靠使用。
    const isLoginPage = url.includes('authing.cn/login');
    if (isLoginPage) aizexLoginUrl = url;
    // Aizex 的登录按钮跳转会先经过 /oidc/auth 302 → /login 的中间链,该链在
    // Electron 中会导致登录页被 SPA 弹回而无法渲染。因此直接拦截原始导航,
    // 改为直接加载 login 页 URL,绕开中间跳转。
    if (isLoginPage) {
      event.preventDefault();
      const now = Date.now();
      if (now - lastAizexForcedAt > 1500) {
        lastAizexForcedAt = now;
        console.log('AIZEX DIRECT LOAD LOGIN: ' + aizexLoginUrl.slice(0, 140));
        aizexWindow.loadURL(aizexLoginUrl);
      }
      return;
    }
    // 登录成功回调(带 /be/auth/ 或 /interaction/)正常放行,否则从 authing 弹回 aizex 的
    // 异常导航一律阻止,并强制重新加载 Authing 登录页,保证登录能在窗口内完成。
    const isLoginCallback = url.includes('/be/auth/') || url.includes('/interaction/');
    const bouncedFromLogin =
      aizexLoginUrl &&
      aizexLoginUrl.includes('authing.cn') &&
      url.startsWith('https://aizex.net') &&
      !isLoginCallback;
    if (bouncedFromLogin) {
      event.preventDefault();
      const now = Date.now();
      if (aizexLoginUrl && now - lastAizexForcedAt > 3000) {
        lastAizexForcedAt = now;
        console.log('AIZEX FORCE LOGIN PAGE: ' + aizexLoginUrl.slice(0, 120));
        aizexWindow.loadURL(aizexLoginUrl);
      }
      return;
    }
    // 真正的站外链接才走系统浏览器。
    if (url.startsWith('http') && !isAllowedAizexHost(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
  aizexWindow.loadURL(AIZEX_URL);
  // 登录页加载完成后,自动填入已保存的 Aizex 账号密码。
  aizexWindow.webContents.on('did-finish-load', () => {
    const url = aizexWindow.webContents.getURL();
    if (!url.includes('authing.cn/login')) return;
    const account = readAizexAccount();
    if (!account.email) return;
    const emailJson = JSON.stringify(account.email);
    const pwdJson = JSON.stringify(account.password);
    // Authing 登录页是 JS 动态渲染的,输入框要等一会才出现,轮询最多 8 秒。
    let attempts = 0;
    const tryFill = () => {
      if (aizexWindow && !aizexWindow.isDestroyed() && attempts < 16) {
        attempts += 1;
        aizexWindow.webContents
          .executeJavaScript(
            '(' +
              (function (email, pwd) {
                const emailInput = Array.from(document.querySelectorAll('input')).find(
                  (i) => (i.type === 'text' || i.type === 'email') && (i.placeholder || '').includes('邮箱'),
                );
                const pwdInput = Array.from(document.querySelectorAll('input')).find((i) => i.type === 'password');
                if (!emailInput || !pwdInput) return 'NO INPUTS';
                const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                setter.call(emailInput, email);
                emailInput.dispatchEvent(new Event('input', { bubbles: true }));
                setter.call(pwdInput, pwd);
                pwdInput.dispatchEvent(new Event('input', { bubbles: true }));
                return 'FILLED';
              }) +
              ')(' +
              emailJson +
              ',' +
              pwdJson +
              ')',
          )
          .then((res) => {
            if (res === 'FILLED') {
              console.log('AIZEX AUTOFILL: FILLED');
            } else {
              setTimeout(tryFill, 500);
            }
          })
          .catch(() => setTimeout(tryFill, 500));
      }
    };
    setTimeout(tryFill, 800);
  });
  aizexWindow.on('closed', () => {
    aizexWindow = null;
  });
}

function buildMenu() {
  const aboutItem = {
    label: '关于鲲鹏智能体',
    click: showAboutWindow,
  };
  const chatItem = {
    label: '聊天',
    accelerator: 'CmdOrCtrl+J',
    click: openChatWindow,
  };
  const aizexItem = {
    label: 'Aizex 聊天',
    click: openAizexWindow,
  };
  const settingsItem = {
    label: '配置',
    accelerator: 'CmdOrCtrl+,',
    click: openSettingsWindow,
  };
  const musicItem = {
    label: '音乐',
    accelerator: 'CmdOrCtrl+M',
    click: openMusicWindow,
  };
  const githubItem = {
    label: 'GitHub 项目主页',
    click: () => shell.openExternal(PROJECT_URL),
  };
  const diagnosticsItem = {
    label: '打开启动诊断日志',
    click: () => {
      fs.mkdirSync(RUNTIME_ROOT, { recursive: true });
      if (!fs.existsSync(BOOTSTRAP_LOG)) fs.writeFileSync(BOOTSTRAP_LOG, 'No startup events recorded yet.\n');
      shell.showItemInFolder(BOOTSTRAP_LOG);
    },
  };
  const adminCenterItem = {
    label: '鲲鹏管理中心',
    click: () => shell.openExternal(readControlUrl()),
  };
  const logoutItem = {
    label: '退出当前账号',
    click: async () => {
      try { await controlRequest('/api/auth/logout', { method: 'POST' }); } catch (_) { /* local logout still proceeds */ }
      clearControlToken();
      if (mainWindow && !mainWindow.isDestroyed()) await mainWindow.loadFile(path.join(__dirname, 'login.html'));
    },
  };
  const editMenu = {
    label: '编辑',
    submenu: [
      { role: 'undo', label: '撤销' },
      { role: 'redo', label: '重做' },
      { type: 'separator' },
      { role: 'cut', label: '剪切' },
      { role: 'copy', label: '复制' },
      { role: 'paste', label: '粘贴' },
      { role: 'selectAll', label: '全选' },
    ],
  };
  const template = [];
  if (process.platform === 'darwin') {
    template.push({
      label: app.name,
      submenu: [
        aboutItem,
        chatItem,
        aizexItem,
        musicItem,
        settingsItem,
        adminCenterItem,
        logoutItem,
        diagnosticsItem,
        githubItem,
        { type: 'separator' },
        { role: 'quit', label: '退出鲲鹏智能体' },
      ],
    });
    template.push(editMenu);
  } else {
    template.push({
      label: '聊天',
      submenu: [chatItem, aizexItem, musicItem],
    });
    template.push({
      label: '配置',
      submenu: [settingsItem, adminCenterItem, logoutItem],
    });
    template.push({
      label: '文件',
      submenu: [{ role: 'quit', label: '退出' }],
    });
    template.push(editMenu);
    template.push({
      label: '帮助',
      submenu: [aboutItem, diagnosticsItem, githubItem],
    });
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

const gotLock = app.requestSingleInstanceLock();
console.log('GOT LOCK: ' + gotLock);
if (!gotLock) {
  app.quit();
} else {
  // 自检模式:打印应用菜单中的角色快捷键后退出(用于打包后验证粘贴等快捷键)。
  if (process.env.DSH_MENU_SELF_TEST === '1') {
    app.whenReady().then(() => {
      // 本地可信页面:显式放行剪贴板读写权限,确保复制/粘贴功能可用。
      session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        callback(true);
      });
      buildMenu();
      const menu = Menu.getApplicationMenu();
      const roles = [];
      for (const item of menu ? menu.items : []) {
        if (item.submenu) {
          for (const sub of item.submenu.items) {
            if (sub.role) roles.push(sub.role);
          }
        }
      }
      console.log('MENU ROLES: ' + JSON.stringify(roles));
      app.quit();
    });
  } else if (process.env.DSH_CONTROL_SELF_TEST === '1') {
    app.whenReady().then(() => {
      registerChatIpc();
      mainWindow = createWindow();
      mainWindow.webContents.on('did-finish-load', async () => {
        if (!mainWindow.webContents.getURL().endsWith('/login.html')) return;
        try {
          const result = await mainWindow.webContents.executeJavaScript(`(async () => ({ hasBridge: !!window.dshControl, status: await window.dshControl.status(), title: document.title }))()`);
          console.log('CONTROL TEST: ' + JSON.stringify(result));
        } catch (error) { console.log('CONTROL TEST ERROR: ' + String(error.message || error)); }
        app.quit();
      });
      mainWindow.loadFile(path.join(__dirname, 'login.html'));
    });
  } else if (process.env.DSH_CHAT_SELF_TEST === '1') {
    app.whenReady().then(async () => {
      // 本地可信页面:显式放行剪贴板读写权限,确保复制/粘贴功能可用。
      session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        callback(true);
      });
      registerChatIpc();
      buildMenu();
      openChatWindow();
      setTimeout(async () => {
        try {
          const res = await chatWindow.webContents.executeJavaScript(
            `(async () => {
              const out = { hasApi: !!window.dshChat, providers: [], reasoningOptions: 0, done: null };
              if (!window.dshChat) return JSON.stringify(out);
              const cfg = await window.dshChat.getConfig();
              out.providers = cfg.providers.map(p => p.id + ':' + p.label);
              out.reasoningOptions = document.querySelectorAll('#reasoning option').length;
              // 验证自定义 provider 保存
              await window.dshChat.saveCustomProviders([{ id: 'testprov', label: 'Test API', baseUrl: 'https://example.com/v1/chat/completions', defaultModel: 'm1', models: ['m1', 'm2'] }]);
              const cfg2 = await window.dshChat.getConfig();
              out.hasCustom = cfg2.providers.some(p => p.id === 'testprov');
              // 测试一次真实请求(带 reasoningEffort),deepseek key 已配置则能通
              await new Promise((resolve) => {
                const timer = setTimeout(() => { out.done = { ok: false, timeout: true }; resolve(); }, 15000);
                const off = window.dshChat.onDone((d) => {
                  if (d.requestId !== 't1') return;
                  out.done = d;
                  off(); clearTimeout(timer); resolve();
                });
                window.dshChat.send({ requestId: 't1', provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high', messages: [{ role: 'user', content: 'hi' }] });
              });
              return JSON.stringify(out);
            })()`,
          );
          console.log('CHAT TEST: ' + JSON.stringify(res));
        } catch (err) {
          console.log('CHAT TEST ERROR: ' + String((err && err.message) || err));
        }
        app.quit();
      }, 4000);
    });
  } else if (process.env.DSH_AIZEX_SELF_TEST === '1') {
    app.whenReady().then(async () => {
      session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        callback(true);
      });
      buildMenu();
      openAizexWindow();
      const win = aizexWindow;
      const timer = setTimeout(() => {
        console.log('AIZEX TEST TIMEOUT');
        app.quit();
      }, 60000);
      win.webContents.on('did-finish-load', async () => {
        try {
          const url = win.webContents.getURL();
          // 已登录则直接进入,否则自动走登录流程(自动填充账号密码)
          if (!url.includes('authing.cn')) {
            await new Promise((r) => setTimeout(r, 1500));
            await win.webContents.executeJavaScript(
              `(() => { const btn = Array.from(document.querySelectorAll('button')).find(b => (b.innerText||'').includes('Login')); if (!btn) return 'NO BUTTON'; btn.click(); return 'CLICKED'; })()`,
            );
            console.log('AIZEX CLICKED LOGIN');
          }
          // 等待自动填充并提交
          let filled = false;
          for (let i = 0; i < 24 && !filled; i++) {
            await new Promise((r) => setTimeout(r, 500));
            filled = await win.webContents.executeJavaScript(
              `(() => { const p = Array.from(document.querySelectorAll('input')).find(i => i.type === 'password'); return !!(p && p.value); })()`,
            );
          }
          console.log('AIZEX AUTOFILL READY: ' + filled);
          if (filled) {
            await new Promise((r) => setTimeout(r, 500));
            const submitRes = await win.webContents.executeJavaScript(
              `(() => {
                const loginBtn = Array.from(document.querySelectorAll('button')).find(b => (b.innerText||'').trim() === '登 录' || (b.innerText||'').trim() === '登录');
                if (!loginBtn) return 'NO LOGIN BTN';
                loginBtn.click();
                return 'SUBMITTED';
              })()`,
            );
            console.log('AIZEX SUBMIT: ' + submitRes);
          }
          // 等待登录与页面稳定
          await new Promise((r) => setTimeout(r, 25000));
          try {
            const cur = await win.webContents.executeJavaScript(
              `JSON.stringify({ url: location.href, title: document.title, body: document.body ? document.body.innerText.slice(0, 200) : '' })`,
            );
            console.log('AIZEX CURRENT: ' + cur);
          } catch (e) {
            console.log('AIZEX CURRENT ERR: ' + String((e && e.message) || e));
          }
          clearTimeout(timer);
          app.quit();
        } catch (err) {
          console.log('AIZEX EVAL ERROR: ' + String((err && err.message) || err));
          clearTimeout(timer);
          app.quit();
        }
      });
      win.webContents.on('did-fail-load', (event, code, desc, url) => {
        console.log('AIZEX FAIL: ' + code + ' ' + desc + ' ' + (url || '').slice(0, 120));
      });
    });
  } else if (process.env.DSH_MUSIC_SELF_TEST === '1') {
    app.whenReady().then(async () => {
      session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        callback(true);
      });
      buildMenu();
      openMusicWindow();
      const win = musicWindow;
      const timer = setTimeout(() => {
        console.log('MUSIC TEST TIMEOUT');
        app.quit();
      }, 30000);
      win.webContents.on('did-finish-load', async () => {
        try {
          const info = await win.webContents.executeJavaScript(
            `(async () => {
              let fetchResult = 'not-run';
              try {
                const res = await fetch('https://raw.githubusercontent.com/LIYIN2/deepseek-harness-desktop/main/assets/music/playlist.json', { cache: 'no-store' });
                fetchResult = 'status=' + res.status;
                if (res.ok) {
                  const j = await res.json();
                  fetchResult += ' tracks=' + (j.tracks || []).length;
                }
              } catch (e) {
                fetchResult = 'FETCH ERR: ' + String((e && e.message) || e);
              }
              return JSON.stringify({
                fetchResult: fetchResult,
                trackCount: document.querySelectorAll('.track').length,
                syncText: (document.getElementById('sync-text') || {}).textContent,
                syncIcon: (document.getElementById('sync-icon') || {}).className,
              });
            })()`,
          );
          console.log('MUSIC LOADED: ' + info);
          clearTimeout(timer);
          app.quit();
        } catch (err) {
          console.log('MUSIC EVAL ERROR: ' + String((err && err.message) || err));
          clearTimeout(timer);
          app.quit();
        }
      });
      win.webContents.on('did-fail-load', (event, code, desc, url) => {
        console.log('MUSIC FAIL: ' + code + ' ' + desc + ' ' + url);
      });
    });
  } else if (process.env.DSH_SETTINGS_SELF_TEST === '1') {
    app.whenReady().then(async () => {
      session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        callback(true);
      });
      registerChatIpc();
      buildMenu();
      openSettingsWindow();
      const win = settingsWindow;
      const timer = setTimeout(() => {
        console.log('SETTINGS TEST TIMEOUT');
        app.quit();
      }, 15000);
      win.webContents.on('did-finish-load', async () => {
        try {
          const res = await win.webContents.executeJavaScript(
            `(async () => {
              const hasAizex = !!window.dshAizex;
              const a = await window.dshAizex.getAccount();
              // 模拟真实用户:填写输入框并点击"保存 Aizex"按钮
              const emailInput = document.getElementById('aizex-email');
              const pwdInput = document.getElementById('aizex-password');
              const saveBtn = document.getElementById('save-aizex');
              emailInput.value = 'click.test@example.com';
              pwdInput.value = 'ClickPwd9';
              saveBtn.click();
              await new Promise(r => setTimeout(r, 800));
              const statusText = document.getElementById('status-aizex').textContent;
              const a2 = await window.dshAizex.getAccount();
              return JSON.stringify({ hasAizex, btnBound: !!saveBtn.onclick, read: [a.email], saved: [a2.email], statusText });
            })()`,
          );
          console.log('SETTINGS TEST: ' + res);
          clearTimeout(timer);
          app.quit();
        } catch (err) {
          console.log('SETTINGS ERROR: ' + String((err && err.message) || err));
          clearTimeout(timer);
          app.quit();
        }
      });
    });
  } else {
  app.on('second-instance', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
      void showLoginOrWorkspace();
    } else if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    // 本地可信页面:显式放行剪贴板读写权限,确保复制/粘贴功能可用。
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
      callback(true);
    });
    registerChatIpc();
    buildMenu();
    mainWindow = createWindow();
    await showLoginOrWorkspace();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createWindow();
        void showLoginOrWorkspace();
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('will-quit', () => {
    if (serverProcess && serverProcess.exitCode === null) {
      serverProcess.kill();
    }
  });
  }
}
