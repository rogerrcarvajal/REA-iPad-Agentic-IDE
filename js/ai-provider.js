/**
 * AI provider layer (RF3 / RF5).
 *
 *  - gemini-key   : Gemini API with a Google AI Studio API key (free tier or paid).
 *  - gemini-oauth : Gemini API with the signed-in Google account (OAuth access token).
 *  - ollama       : Local models on the PC, reached through api/ollama-proxy.php.
 *
 * Model ids used across the app:  "gemini:models/gemini-2.5-flash"  |  "ollama:llama3.1:8b"
 */
import { Settings } from './settings.js';
import { GoogleAuth } from './google-auth.js';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const FALLBACK_GEMINI_MODELS = [
  { id: 'gemini:models/gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { id: 'gemini:models/gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { id: 'gemini:models/gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite' }
];

export class AIError extends Error {
  constructor(message, { needsSetup = false } = {}) {
    super(message);
    this.needsSetup = needsSetup;
  }
}

export const AIProvider = {
  /** Which Gemini credential is active right now: 'gemini-oauth' | 'gemini-key' | null */
  geminiAuthMode() {
    const pref = Settings.get('aiProvider');
    const hasOAuth = GoogleAuth.isSignedIn() && !!Settings.get('googleProjectId');
    const hasKey = !!Settings.get('geminiApiKey');
    if (pref === 'gemini-oauth') return hasOAuth ? 'gemini-oauth' : null;
    if (pref === 'gemini-key') return hasKey ? 'gemini-key' : null;
    if (hasOAuth) return 'gemini-oauth';
    if (hasKey) return 'gemini-key';
    return null;
  },

  describeActive(modelId = Settings.get('selectedModel')) {
    if (modelId?.startsWith('ollama:')) return `Ollama (PC) · ${modelId.slice(7)}`;
    const mode = this.geminiAuthMode();
    const name = modelId?.replace('gemini:models/', '') || '';
    if (mode === 'gemini-oauth') return `${name} · cuenta ${GoogleAuth.session?.email || 'Google'}`;
    if (mode === 'gemini-key') return `${name} · API key`;
    return `${name} · sin credenciales`;
  },

  _geminiHeaders() {
    const mode = this.geminiAuthMode();
    if (mode === 'gemini-oauth') {
      return {
        Authorization: `Bearer ${GoogleAuth.accessToken()}`,
        'x-goog-user-project': Settings.get('googleProjectId')
      };
    }
    if (mode === 'gemini-key') return { 'x-goog-api-key': Settings.get('geminiApiKey') };
    throw new AIError(
      'No hay credenciales de Gemini. Abre ⚙️ Cuenta y pega tu API key de Google AI Studio o inicia sesión con Google.',
      { needsSetup: true }
    );
  },

  async listModels() {
    const result = { gemini: [], ollama: [], errors: [] };

    if (this.geminiAuthMode()) {
      try {
        const r = await fetch(`${GEMINI_BASE}/models?pageSize=200`, { headers: this._geminiHeaders() });
        if (!r.ok) throw new Error(await this._errorText(r));
        const data = await r.json();
        result.gemini = (data.models || [])
          .filter((m) => m.name.includes('gemini') && (m.supportedGenerationMethods || []).includes('generateContent'))
          .filter((m) => !/embedding|aqa|tts|image|live|native-audio/i.test(m.name))
          .map((m) => ({ id: `gemini:${m.name}`, label: m.displayName || m.name.replace('models/', '') }))
          .sort((a, b) => b.label.localeCompare(a.label, undefined, { numeric: true }));
      } catch (e) {
        result.errors.push(`Gemini: ${e.message}`);
      }
    }
    if (!result.gemini.length) result.gemini = FALLBACK_GEMINI_MODELS;

    try {
      const r = await fetch(Settings.appUrl('api/ollama-proxy.php/api/tags'), { signal: AbortSignal.timeout(4000) });
      if (r.ok) {
        const data = await r.json();
        result.ollama = (data.models || []).map((m) => ({ id: `ollama:${m.name}`, label: m.name }));
      }
    } catch {
      /* Ollama is optional */
    }
    return result;
  },

  /**
   * Streams a chat completion.
   * @param {{model:string, system:string, messages:{role:'user'|'model', text:string}[],
   *          onToken:(t:string)=>void, signal?:AbortSignal}} opts
   * @returns {Promise<string>} full text
   */
  async streamChat(opts) {
    if (opts.model.startsWith('ollama:')) return this._streamOllama(opts);
    return this._streamGemini(opts);
  },

  async _streamGemini({ model, system, messages, onToken, signal }) {
    const modelPath = model.replace(/^gemini:/, '');
    const body = {
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      contents: messages.map((m) => ({ role: m.role === 'model' ? 'model' : 'user', parts: [{ text: m.text }] })),
      generationConfig: { temperature: Number(Settings.get('temperature')) || 0.4 }
    };
    const r = await fetch(`${GEMINI_BASE}/${modelPath}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this._geminiHeaders() },
      body: JSON.stringify(body),
      signal
    });
    if (!r.ok) throw new AIError(await this._errorText(r));

    let full = '';
    await this._readLines(r, (line) => {
      if (!line.startsWith('data:')) return;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') return;
      let json;
      try {
        json = JSON.parse(payload);
      } catch {
        return;
      }
      if (json.error) throw new AIError(json.error.message);
      const cand = json.candidates?.[0];
      for (const part of cand?.content?.parts || []) {
        if (part.text && !part.thought) {
          full += part.text;
          onToken?.(part.text);
        }
      }
      if (cand?.finishReason === 'SAFETY') {
        const t = '\n\n> ⚠️ Respuesta detenida por filtros de seguridad del modelo.';
        full += t;
        onToken?.(t);
      }
    });
    return full;
  },

  async _streamOllama({ model, system, messages, onToken, signal }) {
    const r = await fetch(Settings.appUrl('api/ollama-proxy.php/api/chat'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model.slice('ollama:'.length),
        stream: true,
        options: { temperature: Number(Settings.get('temperature')) || 0.4 },
        messages: [
          ...(system ? [{ role: 'system', content: system }] : []),
          ...messages.map((m) => ({ role: m.role === 'model' ? 'assistant' : 'user', content: m.text }))
        ]
      }),
      signal
    });
    if (!r.ok) throw new AIError(await this._errorText(r));
    let full = '';
    await this._readLines(r, (line) => {
      if (!line.trim()) return;
      const json = JSON.parse(line);
      if (json.error) throw new AIError(json.error);
      const t = json.message?.content || '';
      if (t) {
        full += t;
        onToken?.(t);
      }
    });
    return full;
  },

  async _readLines(response, onLine) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).replace(/\r$/, '');
        buffer = buffer.slice(idx + 1);
        onLine(line);
      }
    }
    if (buffer.trim()) onLine(buffer.trim());
  },

  async _errorText(r) {
    let msg = `HTTP ${r.status}`;
    try {
      const j = await r.json();
      msg = j.error?.message || j.error || msg;
    } catch {
      /* not JSON */
    }
    if (r.status === 401 || r.status === 403) {
      msg += ' — revisa la API key / permisos de la cuenta (¿API "Generative Language" habilitada en el proyecto?).';
    }
    if (r.status === 429) msg += ' — cuota agotada para este plan/modelo. Prueba un modelo Flash o espera.';
    return msg;
  }
};
