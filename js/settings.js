/**
 * Settings store (localStorage). Secrets never leave the device except to the
 * service they belong to (Gemini API, GitHub via the same-origin git proxy, PC bridge).
 */
const KEY = 'rea-ide-settings-v1';

const DEFAULTS = {
  // AI (RF3 / RF5)
  aiProvider: 'auto', // 'auto' | 'gemini-key' | 'gemini-oauth' | 'ollama'
  geminiApiKey: '',
  googleClientId: '',
  googleProjectId: '',
  selectedModel: 'gemini:models/gemini-2.5-flash',
  temperature: 0.4,
  // Git (RF1)
  gitAuthorName: '',
  gitAuthorEmail: '',
  githubToken: '',
  // PC bridge (RF4)
  bridgeToken: ''
};

const listeners = new Set();
let cache = null;

function load() {
  if (cache) return cache;
  try {
    cache = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

export const Settings = {
  get(name) {
    return load()[name];
  },
  all() {
    return { ...load() };
  },
  set(patch) {
    cache = { ...load(), ...patch };
    localStorage.setItem(KEY, JSON.stringify(cache));
    listeners.forEach((fn) => fn(cache, patch));
  },
  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  /** Absolute URL to a file inside this app (works under any sub-path, e.g. /REA/REA-iPad-Agentic-IDE/). */
  appUrl(relative) {
    return new URL(relative, document.baseURI).href;
  }
};
