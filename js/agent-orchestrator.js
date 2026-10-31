/**
 * Agent Orchestrator (RF5) — real multi-turn chat with the selected model.
 *
 * - Streams tokens from Gemini (API key or Google account) or Ollama.
 * - Grounds every turn with workspace context: project tree + active file (+ selection).
 * - Renders Markdown safely (marked + DOMPurify), Mermaid diagrams, and code blocks with
 *   actions: copy, insert into editor, or write to a file when the block declares a path
 *   (```ts path=src/app.ts).
 * - Produces the implementation Plan and Walkthrough used by RF2.
 */
import { AIProvider } from './ai-provider.js';
import { Settings } from './settings.js';

const MAX_FILE_CONTEXT = 24_000;
const MAX_TREE_ENTRIES = 300;
const MAX_HISTORY_TURNS = 30;

const SYSTEM_PROMPT = `Eres "REA Agent", el agente de ingeniería de software integrado en REA Agentic IDE (iPad Pro M2 / PC).
Responde en español, de forma precisa y accionable. Usa Markdown.
Reglas para código:
- Cuando propongas el contenido COMPLETO de un archivo, usa un bloque con la ruta relativa en la info del bloque:
  \`\`\`ts path=src/servicio.ts
  ...contenido completo...
  \`\`\`
  El IDE mostrará un botón para escribirlo en esa ruta.
- Para fragmentos, usa bloques normales sin path.
- Para diagramas usa bloques \`\`\`mermaid (C4, secuencia, ER, flujo).
- No inventes archivos del proyecto: apóyate en el árbol y el archivo activo que se te entregan como contexto.`;

export class AgentOrchestrator {
  constructor({ editor, fs, container, onFileWritten, onStatus }) {
    this.editor = editor;
    this.fs = fs;
    this.container = container;
    this.onFileWritten = onFileWritten;
    this.onStatus = onStatus || (() => {});
    this.history = []; // {role:'user'|'model', text, at}
    this.codeBlocks = new Map();
    this.blockSeq = 0;
    this.abort = null;
    this._setupMarkdown();
    this.container.addEventListener('click', (e) => this._onContainerClick(e));
  }

  get busy() {
    return !!this.abort;
  }

  get currentModel() {
    return Settings.get('selectedModel');
  }

  // ───────────────────────────── public API ─────────────────────────────
  async sendUserPrompt(text, { includeSelection = true } = {}) {
    text = text.trim();
    if (!text || this.busy) return;

    this._appendBubble('user', this._escape(text).replace(/\n/g, '<br>'));
    this.history.push({ role: 'user', text, at: new Date() });

    const bubble = this._appendBubble('agent', '<span class="typing-dots"><i></i><i></i><i></i></span>');
    const meta = document.createElement('div');
    meta.className = 'message-meta';
    meta.textContent = AIProvider.describeActive(this.currentModel);

    this.abort = new AbortController();
    this.onStatus(true);
    let acc = '';
    let raf = 0;
    const paint = () => {
      raf = 0;
      bubble.innerHTML = this._renderMarkdown(acc, { streaming: true });
      bubble.appendChild(meta);
      this._scroll();
    };

    try {
      const system = `${SYSTEM_PROMPT}\n\n${await this._buildContext(includeSelection)}`;
      const messages = this.history.slice(-MAX_HISTORY_TURNS).map(({ role, text: t }) => ({ role, text: t }));
      acc = await AIProvider.streamChat({
        model: this.currentModel,
        system,
        messages,
        signal: this.abort.signal,
        onToken: (t) => {
          acc += t;
          if (!raf) raf = requestAnimationFrame(paint);
        }
      });
      if (!acc.trim()) acc = '_(El modelo no devolvió texto.)_';
      this.history.push({ role: 'model', text: acc, at: new Date() });
      bubble.innerHTML = this._renderMarkdown(acc);
      bubble.appendChild(meta);
      this._renderMermaid(bubble);
    } catch (err) {
      if (raf) cancelAnimationFrame(raf);
      const aborted = err.name === 'AbortError';
      if (aborted && acc) {
        this.history.push({ role: 'model', text: acc + '\n\n_(detenido)_', at: new Date() });
        bubble.innerHTML = this._renderMarkdown(acc + '\n\n_(detenido por el usuario)_');
      } else {
        this.history.pop(); // drop the unanswered user turn so it can be retried cleanly
        bubble.classList.add('message-error');
        bubble.innerHTML = aborted
          ? '⏹️ Solicitud cancelada.'
          : `⚠️ <strong>No se pudo obtener respuesta del modelo.</strong><br>${this._escape(err.message)}` +
            (err.needsSetup ? '<br><button class="btn btn-primary btn-xs" data-open-settings>⚙️ Configurar cuenta / API key</button>' : '');
      }
    } finally {
      this.abort = null;
      this.onStatus(false);
      this._scroll();
    }
  }

  stop() {
    this.abort?.abort();
  }

  clear() {
    this.history = [];
    this.codeBlocks.clear();
    this.container.innerHTML = '';
  }

  showSystemMessage(markdown) {
    const b = this._appendBubble('agent', this._renderMarkdown(markdown));
    b.classList.add('message-system');
    return b;
  }

  /**
   * RF2 — produce a Markdown document from the conversation.
   * kind: 'plan' | 'walkthrough'
   */
  async generateDocument(kind, { onToken } = {}) {
    const transcript = this.transcriptMarkdown();
    if (!this.history.length) {
      throw new Error('La conversación está vacía. Conversa con el agente primero (define el objetivo/cambios) y luego guarda el Plan o el Walkthrough.');
    }
    const instructions =
      kind === 'plan'
        ? `Redacta un PLAN DE IMPLEMENTACIÓN en Markdown basado en la conversación y el contexto del proyecto.
Estructura obligatoria:
# Plan de implementación — <título>
## Objetivo
## Contexto y supuestos
## Cambios propuestos (agrupados por componente, con rutas de archivo)
## Pasos de ejecución (lista numerada, verificable)
## Plan de verificación (pruebas / criterios de aceptación)
## Riesgos y preguntas abiertas`
        : `Redacta un WALKTHROUGH en Markdown que documente lo realizado en la conversación.
Estructura obligatoria:
# Walkthrough — <título>
## Resumen
## Cambios realizados (archivo → qué y por qué)
## Cómo probarlo
## Resultados de verificación
## Próximos pasos`;

    const system = `${SYSTEM_PROMPT}\n\n${await this._buildContext(false)}`;
    try {
      const text = await AIProvider.streamChat({
        model: this.currentModel,
        system,
        messages: [{ role: 'user', text: `${instructions}\n\nConversación:\n\n${transcript}\n\nDevuelve SOLO el documento Markdown.` }],
        onToken
      });
      return this._stripOuterFence(text);
    } catch (err) {
      if (!err.needsSetup) throw err;
      // Without AI credentials we still persist a faithful, structured record.
      const title = kind === 'plan' ? 'Plan de implementación' : 'Walkthrough';
      return `# ${title} — ${this.fs.projectName}\n\n> Generado sin modelo de IA (no hay credenciales configuradas). Contiene la conversación literal.\n\n${transcript}`;
    }
  }

  transcriptMarkdown() {
    return this.history
      .map((m) => `### ${m.role === 'user' ? '🧑 Usuario' : '🤖 Agente'} · ${m.at.toLocaleString()}\n\n${m.text}\n`)
      .join('\n');
  }

  // ───────────────────────────── context ─────────────────────────────
  async _buildContext(includeSelection) {
    const parts = [`# Contexto del workspace\nProyecto: ${this.fs.projectName} (modo ${this.fs.currentMode === 'native' ? 'carpeta nativa' : 'workspace del IDE'})`];
    try {
      const files = await this.fs.listAllFiles(MAX_TREE_ENTRIES);
      parts.push(`## Archivos (${files.length}${files.length >= MAX_TREE_ENTRIES ? '+' : ''})\n${files.join('\n')}`);
    } catch {
      /* tree is best-effort */
    }
    const active = this.editor.activeTab;
    if (active) {
      let content = this.editor.getValue();
      const truncated = content.length > MAX_FILE_CONTEXT;
      if (truncated) content = content.slice(0, MAX_FILE_CONTEXT);
      parts.push(`## Archivo activo: ${active}${truncated ? ' (truncado)' : ''}\n\`\`\`\n${content}\n\`\`\``);
      const sel = includeSelection ? this.editor.getSelectionText() : '';
      if (sel) parts.push(`## Selección actual en el editor\n\`\`\`\n${sel}\n\`\`\``);
    }
    return parts.join('\n\n');
  }

  // ───────────────────────────── rendering ─────────────────────────────
  _setupMarkdown() {
    const self = this;
    this.md = new window.marked.Marked({
      gfm: true,
      breaks: true,
      renderer: {
        code(token) {
          const info = (token.lang || '').trim();
          const lang = info.split(/[\s:]/)[0].toLowerCase();
          const pathMatch = info.match(/(?:path|file)=["']?([^\s"']+)/) || info.match(/^[\w+-]+:([^\s]+)$/);
          const path = pathMatch ? pathMatch[1] : '';
          const id = `cb${++self.blockSeq}`;
          self.codeBlocks.set(id, { code: token.text, lang, path });
          if (lang === 'mermaid') {
            return `<div class="agent-artifact-box"><div class="artifact-title">💎 Diagrama Mermaid</div><div class="mermaid" data-mermaid="${id}">${self._escape(token.text)}</div>
<div class="code-actions"><button class="btn btn-xs" data-cb-action="copy" data-cb="${id}">Copiar</button></div></div>`;
          }
          const header = path ? `📄 ${self._escape(path)}` : self._escape(lang || 'código');
          return `<div class="code-block"><div class="code-header"><span>${header}</span></div><pre><code>${self._escape(token.text)}</code></pre>
<div class="code-actions">
<button class="btn btn-xs" data-cb-action="copy" data-cb="${id}">Copiar</button>
<button class="btn btn-xs" data-cb-action="insert" data-cb="${id}">Insertar en editor</button>
${path ? `<button class="btn btn-xs btn-primary" data-cb-action="write" data-cb="${id}">⚡ Escribir ${self._escape(path)}</button>` : ''}
</div></div>`;
        }
      }
    });
  }

  _renderMarkdown(text, { streaming = false } = {}) {
    // While streaming, close an unterminated fence so the partial block renders as code.
    let src = text;
    if (streaming && (src.match(/```/g) || []).length % 2 === 1) src += '\n```';
    const html = this.md.parse(src);
    return window.DOMPurify.sanitize(html, { ADD_ATTR: ['data-cb', 'data-cb-action', 'data-mermaid', 'data-open-settings'] });
  }

  _renderMermaid(root) {
    const nodes = root.querySelectorAll('.mermaid');
    if (nodes.length && window.mermaid) {
      window.mermaid.run({ nodes }).catch((e) => console.warn('Mermaid:', e));
    }
  }

  _appendBubble(role, html) {
    const bubble = document.createElement('div');
    bubble.className = `message-bubble ${role === 'user' ? 'message-user' : 'message-agent'}`;
    bubble.innerHTML = html;
    this.container.appendChild(bubble);
    this._scroll();
    return bubble;
  }

  _scroll() {
    this.container.scrollTop = this.container.scrollHeight;
  }

  async _onContainerClick(e) {
    if (e.target.closest('[data-open-settings]')) {
      document.dispatchEvent(new CustomEvent('rea:open-settings'));
      return;
    }
    const btn = e.target.closest('[data-cb-action]');
    if (!btn) return;
    const block = this.codeBlocks.get(btn.dataset.cb);
    if (!block) return;
    const action = btn.dataset.cbAction;
    try {
      if (action === 'copy') {
        await navigator.clipboard.writeText(block.code);
        btn.textContent = '✓ Copiado';
      } else if (action === 'insert') {
        if (!this.editor.activeTab) throw new Error('No hay un archivo abierto en el editor.');
        this.editor.insertText(block.code);
        btn.textContent = '✓ Insertado';
      } else if (action === 'write') {
        const exists = await this.fs.exists(block.path);
        if (exists && !confirm(`¿Sobrescribir ${block.path}?`)) return;
        await this.fs.writeFile(block.path, block.code.endsWith('\n') ? block.code : block.code + '\n');
        btn.textContent = `✓ ${exists ? 'Actualizado' : 'Creado'} ${block.path}`;
        btn.disabled = true;
        this.onFileWritten?.(block.path, block.code);
      }
    } catch (err) {
      btn.textContent = `⚠️ ${err.message}`;
    }
  }

  _stripOuterFence(text) {
    const m = text.trim().match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/);
    return (m ? m[1] : text.trim()) + '\n';
  }

  _escape(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }
}
