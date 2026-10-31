/**
 * REA Terminal (RF4)
 *
 * Two modes:
 *   local  — runs inside the browser on the active workspace:
 *            ls, cat, pwd, open, rm, ws, git clone|pull|status|add .|commit|push|log, ai, models, clear
 *   pc     — forwards each command to api/terminal.php on the PC that hosts XAMPP, so the
 *            iPad can drive real CLIs: git, npm, python, `gemini -p "..."`, `ollama run ...`.
 *            Enter with `pc` (or prefix a single command: `pc git status`), leave with `exit`.
 */
import { Settings } from './settings.js';
import { AIProvider } from './ai-provider.js';

export class VirtualTerminal {
  constructor(containerId, { fs, git, agent, app }) {
    this.container = document.getElementById(containerId);
    this.fs = fs;
    this.git = git;
    this.agent = agent;
    this.app = app;
    this.history = JSON.parse(localStorage.getItem('rea-term-history') || '[]');
    this.historyIndex = this.history.length;
    this.mode = 'local';
    this.pcCwd = '';
    this.running = false;
  }

  init() {
    this.container.innerHTML = `
      <div id="terminal-output"></div>
      <div class="terminal-input-row">
        <span class="terminal-prompt" id="term-prompt"></span>
        <input type="text" id="term-input" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="send" />
      </div>`;
    this.output = this.container.querySelector('#terminal-output');
    this.input = this.container.querySelector('#term-input');
    this.promptEl = this.container.querySelector('#term-prompt');
    this._updatePrompt();
    this.print('REA Terminal — escribe `help`. Modo PC: `pc` (CLIs reales en el PC: git, npm, gemini, ollama…).', '#38bdf8');

    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const cmd = this.input.value;
        this.input.value = '';
        if (cmd.trim()) {
          this.history.push(cmd);
          this.history = this.history.slice(-100);
          localStorage.setItem('rea-term-history', JSON.stringify(this.history));
          this.historyIndex = this.history.length;
        }
        this.execute(cmd);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.historyIndex = Math.max(0, this.historyIndex - 1);
        this.input.value = this.history[this.historyIndex] || '';
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.historyIndex = Math.min(this.history.length, this.historyIndex + 1);
        this.input.value = this.history[this.historyIndex] || '';
      } else if (e.key === 'c' && e.ctrlKey && this.running) {
        this.agent.stop();
      }
    });
    this.container.addEventListener('click', () => {
      if (!window.getSelection()?.toString()) this.input.focus();
    });
  }

  focus() {
    this.input?.focus();
  }

  print(text, color) {
    const line = document.createElement('div');
    line.className = 'terminal-line';
    if (color) line.style.color = color;
    line.textContent = text;
    this.output.appendChild(line);
    this.container.scrollTop = this.container.scrollHeight;
    return line;
  }

  _updatePrompt() {
    this.promptEl.textContent =
      this.mode === 'pc' ? `pc:${this.pcCwd || '~'}>` : `rea@${this.fs.projectName}:~$`;
    this.promptEl.classList.toggle('pc-mode', this.mode === 'pc');
  }

  /** Split a command line honoring "double" and 'single' quotes. */
  static parse(line) {
    const out = [];
    const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
    let m;
    while ((m = re.exec(line))) out.push(m[1] ?? m[2] ?? m[3]);
    return out;
  }

  async execute(cmdLine) {
    const line = cmdLine.trim();
    this.print(`${this.promptEl.textContent} ${line}`, '#94a3b8');
    if (!line) return;
    this.running = true;
    try {
      if (this.mode === 'pc') {
        if (line === 'exit') {
          this.mode = 'local';
          this._updatePrompt();
          return;
        }
        if (line === 'clear') {
          this.output.innerHTML = '';
          return;
        }
        await this._runPc(line);
        return;
      }
      await this._runLocal(line);
    } catch (err) {
      this.print(`error: ${err.message}`, '#ef4444');
    } finally {
      this.running = false;
    }
  }

  // ───────────────────────────── local mode ─────────────────────────────
  async _runLocal(line) {
    const [cmd, ...args] = VirtualTerminal.parse(line);
    switch (cmd.toLowerCase()) {
      case 'help':
        [
          'Workspace (navegador):',
          '  ls [ruta]              listar archivos         cat <archivo>   mostrar archivo',
          '  open <archivo>         abrir en el editor      rm <archivo>    eliminar',
          '  pwd | ws               workspace activo / listar workspaces',
          'Git (isomorphic-git, sobre el workspace del IDE):',
          '  git clone <url|owner/repo> [nombre]   git pull   git status   git log',
          '  git commit -m "mensaje"  (agrega todos los cambios)   git push',
          'IA:',
          '  ai <pregunta>          consulta al modelo seleccionado (mismo que el chat)',
          '  models                 listar modelos disponibles para tu cuenta/API key',
          'PC (puente XAMPP → CLIs reales):',
          '  pc                     entrar al modo PC (salir con `exit`)',
          '  pc <comando>           ejecutar un solo comando en el PC, ej: pc gemini -p "hola"',
          '  clear                  limpiar'
        ].forEach((l) => this.print(l));
        break;

      case 'clear':
        this.output.innerHTML = '';
        break;

      case 'pwd':
        this.print(`${this.fs.currentMode === 'native' ? '[carpeta nativa] ' : '[workspace IDE] '}/${this.fs.projectName}`);
        break;

      case 'ws': {
        const list = await this.fs.listWorkspaces();
        list.forEach((w) => this.print(`  ${w === this.fs.projectName ? '●' : '○'} ${w}`, w === this.fs.projectName ? '#10b981' : undefined));
        break;
      }

      case 'ls': {
        const prefix = (args[0] || '').replace(/^\.?\/?/, '').replace(/\/$/, '');
        const files = await this.fs.listAllFiles(5000);
        const entries = new Set();
        for (const f of files) {
          if (prefix && !f.startsWith(prefix + '/')) continue;
          const rest = prefix ? f.slice(prefix.length + 1) : f;
          const [head, ...tail] = rest.split('/');
          entries.add(tail.length ? `${head}/` : head);
        }
        if (!entries.size) this.print('(vacío)', '#64748b');
        [...entries].sort().forEach((e) => this.print(`  ${e}`, e.endsWith('/') ? '#38bdf8' : undefined));
        break;
      }

      case 'cat':
        if (!args[0]) throw new Error('uso: cat <archivo>');
        this.print(await this.fs.readFile(args[0]), '#cbd5e1');
        break;

      case 'open':
        if (!args[0]) throw new Error('uso: open <archivo>');
        await this.app.openFile(args[0]);
        break;

      case 'rm':
        if (!args[0]) throw new Error('uso: rm <archivo>');
        await this.fs.deleteFile(args[0]);
        await this.app.refreshFileTree();
        this.print(`eliminado ${args[0]}`, '#10b981');
        break;

      case 'git':
        await this._git(args);
        break;

      case 'ai':
      case 'agent': {
        const prompt = args.join(' ');
        if (!prompt) throw new Error('uso: ai <pregunta>');
        const out = this.print('', '#e2e8f0');
        out.style.whiteSpace = 'pre-wrap';
        const ctrl = new AbortController();
        this.agent.abort = ctrl; // allows Ctrl+C
        try {
          await AIProvider.streamChat({
            model: Settings.get('selectedModel'),
            system: 'Eres un asistente de terminal. Responde en español, conciso, en texto plano.',
            messages: [{ role: 'user', text: prompt }],
            signal: ctrl.signal,
            onToken: (t) => {
              out.textContent += t;
              this.container.scrollTop = this.container.scrollHeight;
            }
          });
        } finally {
          this.agent.abort = null;
        }
        break;
      }

      case 'models': {
        const m = await AIProvider.listModels();
        this.print('Gemini:', '#a855f7');
        m.gemini.forEach((x) => this.print(`  ${x.id.replace('gemini:models/', '')}  (${x.label})`));
        this.print('Ollama (PC):', '#a855f7');
        if (!m.ollama.length) this.print('  (no disponible)', '#64748b');
        m.ollama.forEach((x) => this.print(`  ${x.label}`));
        m.errors.forEach((e) => this.print(e, '#f59e0b'));
        break;
      }

      case 'pc':
        if (args.length) {
          await this._runPc(line.replace(/^pc\s+/i, ''));
        } else {
          const ok = await this._pcPing();
          if (ok) {
            this.mode = 'pc';
            this._updatePrompt();
            this.print('Modo PC activo. Los comandos se ejecutan en el PC host. `exit` para volver.', '#10b981');
          }
        }
        break;

      default:
        throw new Error(`comando no reconocido: ${cmd} (¿quisiste decir \`pc ${line}\`?)`);
    }
  }

  async _git(args) {
    const sub = args[0];
    const progress = (label) => {
      const l = this.print(`${label}…`, '#64748b');
      return {
        onProgress: (p) => (l.textContent = `${label}: ${p.phase} ${p.total ? Math.round((p.loaded / p.total) * 100) + '%' : p.loaded}`),
        onMessage: (m) => this.print(`remote: ${m.trim()}`, '#64748b')
      };
    };
    switch (sub) {
      case 'clone': {
        if (!args[1]) throw new Error('uso: git clone <url|owner/repo> [nombre]');
        const name = await this.git.clone(args[1], { name: args[2], ...progress('clonando') });
        this.print(`✓ Clonado en workspace "${name}"`, '#10b981');
        await this.app.onWorkspaceChanged();
        break;
      }
      case 'pull': {
        const ref = await this.git.pull(progress('pull'));
        this.print(`✓ ${ref} actualizado`, '#10b981');
        await this.app.onWorkspaceChanged({ keepTabs: true });
        break;
      }
      case 'status': {
        const branch = await this.git.currentBranch();
        const changes = await this.git.status();
        this.print(`En la rama ${branch}`);
        if (!changes.length) this.print('nada que confirmar, árbol limpio', '#10b981');
        changes.forEach((c) => this.print(`  ${c.status.padEnd(10)} ${c.path}`, c.status === 'eliminado' ? '#ef4444' : '#f59e0b'));
        break;
      }
      case 'add':
        this.print('(git add no es necesario: `git commit -m` incluye todos los cambios)', '#64748b');
        break;
      case 'commit': {
        const i = args.indexOf('-m');
        const msg = i >= 0 ? args[i + 1] : '';
        if (!msg) throw new Error('uso: git commit -m "mensaje"');
        const sha = await this.git.commitAll(msg);
        this.print(sha ? `✓ commit ${sha.slice(0, 7)}` : 'nada que confirmar', '#10b981');
        break;
      }
      case 'push': {
        const ref = await this.git.push(progress('push'));
        this.print(`✓ push a origin/${ref}`, '#10b981');
        break;
      }
      case 'log': {
        for (const c of await this.git.log(10)) {
          this.print(`${c.oid.slice(0, 7)} ${c.commit.message.split('\n')[0]}  — ${c.commit.author.name}`, '#cbd5e1');
        }
        break;
      }
      default:
        throw new Error('subcomandos: clone, pull, status, commit -m, push, log');
    }
  }

  // ───────────────────────────── PC bridge ─────────────────────────────
  async _bridge(body) {
    const token = Settings.get('bridgeToken');
    if (!token) {
      throw new Error('Configura el token del puente en ⚙️ Cuenta → Terminal PC (y bridge_token en api/config.local.php del PC).');
    }
    const r = await fetch(Settings.appUrl('api/terminal.php'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Bridge-Token': token },
      body: JSON.stringify(body)
    });
    const data = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
    if (!r.ok && data.error) throw new Error(data.error);
    return data;
  }

  async _pcPing() {
    const data = await this._bridge({ action: 'ping' });
    this.pcCwd = this.pcCwd || data.cwd;
    this.print(`Conectado al PC (${data.os}). Raíz permitida: ${data.root}`, '#64748b');
    return true;
  }

  async _runPc(command) {
    if (!this.pcCwd) await this._pcPing();
    const pending = this.print('⏳ ejecutando en el PC…', '#64748b');
    const data = await this._bridge({ action: 'exec', command, cwd: this.pcCwd });
    pending.remove();
    if (data.cwd) this.pcCwd = data.cwd;
    if (data.stdout) this.print(data.stdout.replace(/\n$/, ''), '#e2e8f0').style.whiteSpace = 'pre-wrap';
    if (data.stderr) this.print(data.stderr.replace(/\n$/, ''), '#f87171').style.whiteSpace = 'pre-wrap';
    if (data.code) this.print(`[código de salida ${data.code}]`, '#64748b');
    this._updatePrompt();
  }
}
