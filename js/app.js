import { FileSystemManager } from './fs-manager.js';
import { EditorManager } from './editor-manager.js';
import { AgentOrchestrator } from './agent-orchestrator.js';
import { TouchToolbar } from './touch-toolbar.js';
import { VirtualTerminal } from './terminal.js';
import { GitService } from './git-service.js';
import { AIProvider } from './ai-provider.js';
import { GoogleAuth } from './google-auth.js';
import { Settings } from './settings.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

class AppController {
  constructor() {
    this.fs = new FileSystemManager();
    this.git = new GitService(this.fs);
    this.editor = new EditorManager(
      'monaco-container',
      () => this.renderTabs(),
      (path, content) => this.saveCurrentFile(path, content)
    );
    this.agent = new AgentOrchestrator({
      editor: this.editor,
      fs: this.fs,
      container: $('#agent-messages'),
      onFileWritten: async (path, content) => {
        await this.refreshFileTree();
        if (!this.editor.updateFileIfOpen(path, content.endsWith('\n') ? content : content + '\n')) await this.openFile(path);
        this.renderTabs();
        this.refreshGitPanel();
      },
      onStatus: (busy) => this._setAgentBusy(busy)
    });
    this.touchToolbar = new TouchToolbar('touch-toolbar', this.editor);
    this.terminal = new VirtualTerminal('terminal-body', { fs: this.fs, git: this.git, agent: this.agent, app: this });
  }

  async init() {
    try {
      await this.fs.init();
    } catch (e) {
      this.toast(`No se pudo abrir el almacenamiento local: ${e.message}`, 'error', 0);
    }
    await this.editor.init();
    this.touchToolbar.render();
    this.terminal.init();
    this.setupUIEvents();
    this.setupSettingsModal();

    GoogleAuth.onChange(() => {
      this.updateAccountUI();
      this.populateModels();
    });
    this.updateAccountUI();
    this.populateModels();

    await this.onWorkspaceChanged();

    if ('serviceWorker' in navigator && window.isSecureContext) {
      navigator.serviceWorker.register('./service-worker.js').catch((err) => console.warn('SW:', err));
    }
    this.showWelcome();
  }

  showWelcome() {
    const mode = AIProvider.geminiAuthMode();
    const cred =
      mode === 'gemini-oauth'
        ? `Conectado con la cuenta **${GoogleAuth.session?.email}**.`
        : mode === 'gemini-key'
          ? 'Usando tu **API key de Gemini**.'
          : '⚠️ **Aún no hay credenciales de IA.** Pulsa **⚙️ Cuenta** para pegar una API key de Google AI Studio (gratis) o iniciar sesión con Google.';
    this.agent.showSystemMessage(
      `👋 **REA Agentic IDE** listo.\n\n${cred}\n\n` +
        `- **📁 Abrir Carpeta** → elegir carpeta del dispositivo o **clonar** un repo Git.\n` +
        `- **💾 Guardar** → archivo actual, **Plan** o **Walkthrough** en \`Docs/\`.\n` +
        `- **⌨️ Terminal** → \`help\`; modo PC con \`pc\` para CLIs reales.`
    );
  }

  // ═══════════════════════════════ UI wiring ═══════════════════════════════
  setupUIEvents() {
    // Dropdowns
    $$('.dropdown > .btn').forEach((btn) =>
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const dd = btn.parentElement;
        const wasOpen = dd.classList.contains('open');
        $$('.dropdown.open').forEach((d) => d.classList.remove('open'));
        if (!wasOpen) {
          dd.classList.add('open');
          if (btn.id === 'btn-open-folder') this.renderWorkspaceMenu();
        }
      })
    );
    document.addEventListener('click', () => $$('.dropdown.open').forEach((d) => d.classList.remove('open')));

    // RF1 — folder menu
    $('#menu-folder').addEventListener('click', (e) => {
      const action = e.target.closest('[data-folder-action]')?.dataset.folderAction;
      if (action) this.handleFolderAction(action);
    });
    $('#folder-input').addEventListener('change', (e) => this.importPickedFolder(e.target));

    // RF2 — save menu + doc chips
    $$('[data-save-action]').forEach((el) =>
      el.addEventListener('click', () => this.handleSaveAction(el.dataset.saveAction))
    );
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        this.handleSaveAction('file');
      }
    });

    // Panels
    $('#btn-toggle-agent').addEventListener('click', () => this._togglePanel('#agent-panel'));
    $('#btn-toggle-terminal').addEventListener('click', () => {
      this._togglePanel('#terminal-panel');
      if (!$('#terminal-panel').classList.contains('collapsed')) this.terminal.focus();
    });
    $('#btn-terminal-close').addEventListener('click', () => this._togglePanel('#terminal-panel', true));
    $('#btn-terminal-clear').addEventListener('click', () => this.terminal.execute('clear'));

    // Activity bar / sidebar views
    $$('#activity-bar [data-view]').forEach((icon) =>
      icon.addEventListener('click', () => {
        const view = icon.dataset.view;
        const sidebar = $('#sidebar-panel');
        if (icon.classList.contains('active') && !sidebar.classList.contains('collapsed')) {
          sidebar.classList.add('collapsed');
        } else {
          sidebar.classList.remove('collapsed');
          $$('#activity-bar [data-view]').forEach((i) => i.classList.toggle('active', i === icon));
          $$('.sidebar-view').forEach((v) => v.classList.toggle('hidden', v.dataset.view !== view));
          if (view === 'git') this.refreshGitPanel();
        }
        this.editor.editor?.layout();
      })
    );
    $('#btn-activity-settings').addEventListener('click', () => this.openSettings());
    $('#btn-account').addEventListener('click', () => this.openSettings());
    document.addEventListener('rea:open-settings', () => this.openSettings());

    // Explorer
    $('#btn-refresh-tree').addEventListener('click', () => this.refreshFileTree());
    $('#btn-new-file').addEventListener('click', () => this.createNewFile());

    // Git panel
    $('#btn-git-refresh').addEventListener('click', () => this.refreshGitPanel());
    $('#btn-git-pull').addEventListener('click', () => this.handleFolderAction('pull'));
    $('#btn-git-push').addEventListener('click', () => this.gitPush());
    $('#btn-git-commit').addEventListener('click', () => this.gitCommit($('#git-commit-msg').value));

    // Models
    $('#model-select').addEventListener('change', (e) => {
      Settings.set({ selectedModel: e.target.value });
      this.toast(`Modelo: ${AIProvider.describeActive(e.target.value)}`);
    });
    $('#btn-refresh-models').addEventListener('click', () => this.populateModels(true));

    // RF5 — chat
    const input = $('#agent-prompt-input');
    const send = () => {
      const text = input.value;
      if (!text.trim()) return;
      input.value = '';
      this.agent.sendUserPrompt(text);
    };
    $('#btn-send-agent').addEventListener('click', send);
    $('#btn-stop-agent').addEventListener('click', () => this.agent.stop());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        send();
      }
    });
    $('#btn-agent-clear').addEventListener('click', () => {
      if (this.agent.history.length && !confirm('¿Iniciar una nueva conversación? (exporta antes con 💾 si la necesitas)')) return;
      this.agent.clear();
      this.showWelcome();
    });
    $$('.chip[data-action]').forEach((chip) =>
      chip.addEventListener('click', () => this.agent.sendUserPrompt(chip.dataset.action))
    );

    // Generic modal close
    $$('[data-close-modal]').forEach((b) => b.addEventListener('click', () => b.closest('.modal-backdrop').classList.add('hidden')));
  }

  _togglePanel(sel, forceCollapse) {
    const el = $(sel);
    if (forceCollapse) el.classList.add('collapsed');
    else el.classList.toggle('collapsed');
    setTimeout(() => this.editor.editor?.layout(), 220);
  }

  _setAgentBusy(busy) {
    $('#btn-send-agent').classList.toggle('hidden', busy);
    $('#btn-stop-agent').classList.toggle('hidden', !busy);
    const badge = $('#agent-status-badge');
    badge.textContent = busy ? 'pensando…' : 'listo';
    badge.classList.toggle('busy', busy);
  }

  // ═══════════════════════════════ RF1 — folders & git ═══════════════════════════════
  async handleFolderAction(action) {
    $$('.dropdown.open').forEach((d) => d.classList.remove('open'));
    try {
      if (action === 'pick') await this.pickFolder();
      else if (action === 'clone') await this.cloneRepo();
      else if (action === 'pull') await this.gitPull();
      else if (action === 'commit-push') {
        const v = await this.ask('Commit & Push', [{ name: 'msg', label: 'Mensaje de commit', placeholder: 'feat: …' }]);
        if (v?.msg) {
          await this.gitCommit(v.msg, { silentEmpty: true });
          await this.gitPush();
        }
      }
    } catch (e) {
      this.toast(e.message, 'error', 8000);
    }
  }

  async pickFolder() {
    if (this.fs.supportsNativePicker) {
      try {
        const res = await this.fs.openNativeDirectory();
        this.toast(`📂 Carpeta nativa montada: ${res.name} (lectura/escritura en disco)`, 'success');
        await this.onWorkspaceChanged();
      } catch (e) {
        if (e.name !== 'AbortError') throw e;
      }
      return;
    }
    // iPad Safari: system document picker via <input webkitdirectory>
    const input = $('#folder-input');
    input.value = '';
    input.click();
  }

  async importPickedFolder(input) {
    if (!input.files?.length) return;
    const t = this.toast('Importando carpeta…', 'info', 0);
    try {
      const res = await this.fs.importFileList(input.files, (n, total, rel) => {
        t.textContent = `Importando ${n}/${total}: ${rel}`;
      });
      t.remove();
      this.toast(
        `✓ "${res.name}" importada (${res.imported} archivos${res.skipped ? `, ${res.skipped} omitidos` : ''}). ` +
          'Es una copia de trabajo en el IDE: sincroniza con Git (clonar/pull/push).',
        'success',
        7000
      );
      await this.onWorkspaceChanged();
    } catch (e) {
      t.remove();
      this.toast(`Error importando: ${e.message}`, 'error', 8000);
    }
  }

  async cloneRepo() {
    const v = await this.ask('Clonar repositorio Git', [
      { name: 'url', label: 'URL HTTPS o owner/repo', placeholder: 'https://github.com/owner/repo.git' },
      { name: 'name', label: 'Nombre del workspace (opcional)', placeholder: 'repo' },
      { name: 'ref', label: 'Rama (opcional)', placeholder: 'main' }
    ]);
    if (!v?.url) return;
    const t = this.toast('Clonando…', 'info', 0);
    try {
      const name = await this.git.clone(v.url, {
        name: v.name,
        ref: v.ref,
        onProgress: (p) => (t.textContent = `Clonando · ${p.phase} ${p.total ? Math.round((p.loaded / p.total) * 100) + '%' : p.loaded}`)
      });
      t.remove();
      this.toast(`✓ Repositorio clonado en "${name}"`, 'success');
      await this.onWorkspaceChanged();
    } catch (e) {
      t.remove();
      throw new Error(`Clonación fallida: ${e.message}`);
    }
  }

  async gitPull() {
    if (!(await this.git.isRepo())) throw new Error(this.fs.supportsGit ? 'Este workspace no es un repositorio Git. Usa "Clonar repositorio".' : 'Carpeta nativa: usa la terminal `pc git pull`.');
    const dirty = $$('.tab').some((t) => t.textContent.includes('•'));
    if (dirty && !confirm('Hay archivos sin guardar. ¿Continuar con el pull?')) return;
    const t = this.toast('git pull…', 'info', 0);
    try {
      const ref = await this.git.pull({ onProgress: (p) => (t.textContent = `pull · ${p.phase}`) });
      t.remove();
      this.toast(`✓ ${ref} actualizado desde origin`, 'success');
      await this.onWorkspaceChanged({ keepTabs: true });
    } catch (e) {
      t.remove();
      throw new Error(`Pull fallido: ${e.message}`);
    }
  }

  async gitCommit(message, { silentEmpty = false } = {}) {
    try {
      const sha = await this.git.commitAll(message);
      if (sha) {
        this.toast(`✓ Commit ${sha.slice(0, 7)}`, 'success');
        $('#git-commit-msg').value = '';
      } else if (!silentEmpty) this.toast('No hay cambios para confirmar.');
      this.refreshGitPanel();
    } catch (e) {
      this.toast(e.message, 'error', 8000);
      throw e;
    }
  }

  async gitPush() {
    const t = this.toast('git push…', 'info', 0);
    try {
      const ref = await this.git.push({ onProgress: (p) => (t.textContent = `push · ${p.phase}`) });
      t.remove();
      this.toast(`✓ Push a origin/${ref}`, 'success');
      this.refreshGitPanel();
    } catch (e) {
      t.remove();
      this.toast(`Push fallido: ${e.message}`, 'error', 8000);
    }
  }

  async renderWorkspaceMenu() {
    const box = $('#menu-workspaces');
    const list = await this.fs.listWorkspaces();
    box.innerHTML = list
      .map(
        (w) => `<div class="ws-row ${this.fs.currentMode === 'idb' && w === this.fs.projectName ? 'active' : ''}">
          <button data-ws-open="${esc(w)}">🗂️ ${esc(w)}</button>
          <button class="ws-del" data-ws-del="${esc(w)}" title="Eliminar workspace">✕</button></div>`
      )
      .join('') || '<div class="menu-label">(ninguno)</div>';
    box.onclick = async (e) => {
      const open = e.target.closest('[data-ws-open]')?.dataset.wsOpen;
      const del = e.target.closest('[data-ws-del]')?.dataset.wsDel;
      e.stopPropagation();
      if (open) {
        $$('.dropdown.open').forEach((d) => d.classList.remove('open'));
        await this.fs.openWorkspace(open);
        await this.onWorkspaceChanged();
      } else if (del && confirm(`¿Eliminar el workspace "${del}" del navegador? (no afecta al repositorio remoto)`)) {
        await this.fs.deleteWorkspace(del);
        await this.onWorkspaceChanged();
        this.renderWorkspaceMenu();
      }
    };
  }

  async onWorkspaceChanged({ keepTabs = false } = {}) {
    const label = `${this.fs.currentMode === 'native' ? '💻 ' : ''}${this.fs.projectName}`;
    $('#workspace-badge').textContent = label;
    $('#project-title').textContent = this.fs.projectName.toUpperCase();
    if (keepTabs) {
      for (const path of Array.from(this.editor.tabs.keys())) {
        try {
          this.editor.updateFileIfOpen(path, await this.fs.readFile(path));
        } catch {
          this.editor.closeTab(path);
        }
      }
    } else {
      this.editor.closeAll();
    }
    await this.refreshFileTree();
    if (!keepTabs && (await this.fs.exists('README.md'))) await this.openFile('README.md');
    this.renderTabs();
    this.refreshGitPanel();
    this.terminal._updatePrompt();
  }

  async refreshGitPanel() {
    const info = $('#git-info');
    const changesBox = $('#git-changes');
    const buttons = ['#btn-git-pull', '#btn-git-push', '#btn-git-commit'].map((s) => $(s));
    const setEnabled = (on) => buttons.forEach((b) => (b.disabled = !on));
    changesBox.innerHTML = '';
    if (!this.fs.supportsGit) {
      info.innerHTML = '💻 Carpeta nativa del PC. Usa la terminal en modo PC: <code>pc git status</code>, <code>pc git pull</code>.';
      return setEnabled(false);
    }
    if (!(await this.git.isRepo())) {
      info.innerHTML = 'Este workspace no es un repositorio Git.<br>Usa <strong>📁 Abrir Carpeta → Clonar repositorio</strong>.';
      return setEnabled(false);
    }
    setEnabled(true);
    try {
      const [branch, remote, changes] = await Promise.all([this.git.currentBranch(), this.git.remoteUrl(), this.git.status()]);
      info.innerHTML = `🌿 <strong>${esc(branch)}</strong><br><span class="hint">${esc(remote)}</span>`;
      changesBox.innerHTML = changes.length
        ? changes.map((c) => `<div class="tree-item git-change" data-path="${esc(c.path)}"><span class="badge-${c.status}">${c.status[0].toUpperCase()}</span> ${esc(c.path)}</div>`).join('')
        : '<div class="hint" style="padding:6px 0">Sin cambios</div>';
      changesBox.onclick = (e) => {
        const p = e.target.closest('[data-path]')?.dataset.path;
        if (p) this.openFile(p);
      };
    } catch (e) {
      info.textContent = `Error leyendo Git: ${e.message}`;
    }
  }

  // ═══════════════════════════════ RF2 — save ═══════════════════════════════
  async handleSaveAction(action) {
    $$('.dropdown.open').forEach((d) => d.classList.remove('open'));
    try {
      if (action === 'file') {
        if (!this.editor.activeTab) return this.toast('No hay archivo abierto.');
        return await this.saveCurrentFile(this.editor.activeTab, this.editor.getValue());
      }
      const stamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '');
      if (action === 'chat') {
        if (!this.agent.history.length) return this.toast('La conversación está vacía.');
        const path = `Docs/CHAT-${stamp}.md`;
        await this._writeDoc(path, `# Conversación — ${this.fs.projectName}\n\n${this.agent.transcriptMarkdown()}`);
        return;
      }
      if (this.agent.busy) return this.toast('Espera a que el agente termine.');
      const kind = action === 'plan' ? 'plan' : 'walkthrough';
      const label = kind === 'plan' ? 'Plan' : 'Walkthrough';
      const t = this.toast(`Generando ${label} con ${AIProvider.describeActive()}…`, 'info', 0);
      let chars = 0;
      try {
        const md = await this.agent.generateDocument(kind, {
          onToken: (tok) => {
            chars += tok.length;
            t.textContent = `Generando ${label}… ${chars} caracteres`;
          }
        });
        t.remove();
        const path = `Docs/${kind === 'plan' ? 'PLAN' : 'WALKTHROUGH'}-${stamp}.md`;
        await this._writeDoc(path, md);
        this.agent.showSystemMessage(`✅ **${label} guardado** en \`${path}\` (abierto en el editor).`);
      } catch (e) {
        t.remove();
        throw e;
      }
    } catch (e) {
      this.toast(e.message, 'error', 8000);
    }
  }

  async _writeDoc(path, content) {
    await this.fs.writeFile(path, content);
    await this.refreshFileTree();
    await this.openFile(path);
    this.refreshGitPanel();
    this.toast(`✓ Guardado ${path}${this.fs.supportsGit ? ' (haz commit/push para sincronizar)' : ''}`, 'success', 5000);
  }

  async saveCurrentFile(path, content) {
    try {
      await this.fs.writeFile(path, content);
      this.editor.markSaved(path);
      this.renderTabs();
      this.refreshGitPanel();
      this.toast(`✓ Guardado: ${path}`, 'success', 2000);
    } catch (err) {
      this.toast(`Error guardando ${path}: ${err.message}`, 'error', 8000);
    }
  }

  async createNewFile() {
    const v = await this.ask('Nuevo archivo', [{ name: 'path', label: 'Ruta relativa', placeholder: 'src/nuevo.ts' }]);
    if (!v?.path) return;
    const path = v.path.replace(/^\/+/, '');
    if (await this.fs.exists(path)) return this.openFile(path);
    await this.fs.writeFile(path, '');
    await this.refreshFileTree();
    await this.openFile(path);
  }

  // ═══════════════════════════════ explorer & tabs ═══════════════════════════════
  async refreshFileTree() {
    const container = $('#file-tree-container');
    let items = [];
    try {
      items = await this.fs.getFileTree();
    } catch (e) {
      container.innerHTML = `<div class="hint" style="padding:12px">Error leyendo carpeta: ${esc(e.message)}</div>`;
      return;
    }
    this._collapsed = this._collapsed || new Set();
    container.innerHTML = '';
    const render = (list, depth) => {
      for (const item of list) {
        const row = document.createElement('div');
        row.className = 'tree-item';
        if (item.path === this.editor.activeTab) row.classList.add('active');
        row.style.paddingLeft = `${10 + depth * 12}px`;
        const isCollapsed = this._collapsed.has(item.path);
        row.innerHTML = `<span class="tree-item-icon">${item.kind === 'directory' ? (isCollapsed ? '▸📁' : '▾📂') : this._getFileIcon(item.name)}</span><span>${esc(item.name)}</span>`;
        row.addEventListener('click', () => {
          if (item.kind === 'file') return this.openFile(item.path);
          if (isCollapsed) this._collapsed.delete(item.path);
          else this._collapsed.add(item.path);
          this.refreshFileTree();
        });
        container.appendChild(row);
        if (item.kind === 'directory' && !isCollapsed && item.children) render(item.children, depth + 1);
      }
    };
    render(items, 0);
    if (!items.length) container.innerHTML = '<div class="hint" style="padding:12px">Carpeta vacía</div>';
  }

  async openFile(path) {
    try {
      const content = await this.fs.readFile(path);
      this.editor.openFile(path, content);
      this.renderTabs();
      $$('#file-tree-container .tree-item').forEach((r) => r.classList.remove('active'));
    } catch (err) {
      this.toast(`No se pudo abrir ${path}: ${err.message}`, 'error');
    }
  }

  renderTabs() {
    const container = $('#tabs-bar');
    container.innerHTML = '';
    for (const [path, tab] of this.editor.tabs.entries()) {
      const tabEl = document.createElement('div');
      tabEl.className = `tab ${this.editor.activeTab === path ? 'active' : ''}`;
      tabEl.title = path;
      tabEl.innerHTML = `<span>${esc(tab.name)}${tab.isDirty ? ' •' : ''}</span><span class="tab-close">✕</span>`;
      tabEl.querySelector('.tab-close').addEventListener('click', (e) => {
        e.stopPropagation();
        if (tab.isDirty && !confirm(`${tab.name} tiene cambios sin guardar. ¿Cerrar?`)) return;
        this.editor.closeTab(path);
        this.renderTabs();
      });
      tabEl.addEventListener('click', () => {
        this.editor.switchTab(path);
        this.renderTabs();
      });
      container.appendChild(tabEl);
    }
  }

  // ═══════════════════════════════ RF3 — account & models ═══════════════════════════════
  async populateModels(force = false) {
    const select = $('#model-select');
    const current = Settings.get('selectedModel');
    if (force) select.innerHTML = '<option>Cargando…</option>';
    const { gemini, ollama, errors } = await AIProvider.listModels();
    const group = (label, list) =>
      list.length ? `<optgroup label="${esc(label)}">${list.map((m) => `<option value="${esc(m.id)}">${esc(m.label)}</option>`).join('')}</optgroup>` : '';
    const geminiLabel = AIProvider.geminiAuthMode() ? 'Gemini (tu cuenta / API key)' : 'Gemini (configura ⚙️ Cuenta)';
    select.innerHTML = group(geminiLabel, gemini) + group('Ollama local (PC)', ollama);
    const ids = [...gemini, ...ollama].map((m) => m.id);
    select.value = ids.includes(current) ? current : ids[0];
    if (select.value !== current) Settings.set({ selectedModel: select.value });
    if (force) {
      if (errors.length) this.toast(errors.join(' · '), 'error', 8000);
      else this.toast(`${gemini.length + ollama.length} modelos disponibles`, 'success');
    }
  }

  updateAccountUI() {
    const avatar = $('#account-avatar');
    const label = $('#account-label');
    const s = GoogleAuth.isSignedIn() ? GoogleAuth.session : null;
    if (s) {
      avatar.innerHTML = s.picture ? `<img src="${esc(s.picture)}" alt="" referrerpolicy="no-referrer">` : '👤';
      label.textContent = s.name.split(' ')[0];
    } else if (Settings.get('geminiApiKey')) {
      avatar.textContent = '🔑';
      label.textContent = 'API key';
    } else {
      avatar.textContent = '⚙️';
      label.textContent = 'Iniciar sesión';
    }
    const box = $('#google-account-box');
    if (box) {
      box.innerHTML = s
        ? `${s.picture ? `<img src="${esc(s.picture)}" referrerpolicy="no-referrer">` : '👤'} <div><strong>${esc(s.name)}</strong><br><span class="hint">${esc(s.email)}</span></div>`
        : `<span class="hint">${esc(GoogleAuth.preflightProblem() || 'Sin sesión.')}</span>`;
    }
  }

  setupSettingsModal() {
    const fields = ['googleClientId', 'googleProjectId', 'geminiApiKey', 'aiProvider', 'temperature', 'gitAuthorName', 'gitAuthorEmail', 'githubToken', 'bridgeToken'];
    const collect = () => Object.fromEntries(fields.map((f) => [f, $(`#set-${f}`).value.trim()]));
    this._fillSettings = () => fields.forEach((f) => ($(`#set-${f}`).value = Settings.get(f) ?? ''));

    $('#btn-settings-save').addEventListener('click', () => {
      Settings.set(collect());
      $('#settings-modal').classList.add('hidden');
      this.updateAccountUI();
      this.populateModels(true);
    });
    $('#btn-google-signin').addEventListener('click', async () => {
      Settings.set(collect());
      try {
        await GoogleAuth.signIn();
        this.toast(`✓ Sesión iniciada: ${GoogleAuth.session.email}`, 'success');
      } catch (e) {
        this.toast(e.message, 'error', 10000);
      }
      this.updateAccountUI();
    });
    $('#btn-google-signout').addEventListener('click', () => GoogleAuth.signOut());
    $('#btn-test-ai').addEventListener('click', async () => {
      Settings.set(collect());
      const out = $('#test-ai-result');
      out.textContent = 'Probando…';
      try {
        const txt = await AIProvider.streamChat({
          model: Settings.get('selectedModel'),
          system: '',
          messages: [{ role: 'user', text: 'Responde únicamente: OK' }]
        });
        out.textContent = `✓ ${AIProvider.describeActive()} → "${txt.trim().slice(0, 40)}"`;
        this.updateAccountUI();
      } catch (e) {
        out.textContent = `✗ ${e.message}`;
      }
    });
  }

  openSettings() {
    this._fillSettings();
    this.updateAccountUI();
    $('#settings-modal').classList.remove('hidden');
  }

  // ═══════════════════════════════ helpers ═══════════════════════════════
  ask(title, fields) {
    return new Promise((resolve) => {
      const modal = $('#prompt-modal');
      $('#prompt-title').textContent = title;
      $('#prompt-body').innerHTML = fields
        .map((f) => `<label>${esc(f.label)}<input type="text" name="${esc(f.name)}" placeholder="${esc(f.placeholder || '')}" value="${esc(f.value || '')}" autocapitalize="off" autocorrect="off" spellcheck="false"></label>`)
        .join('');
      modal.classList.remove('hidden');
      const first = $('input', modal);
      setTimeout(() => first?.focus(), 50);
      const done = (val) => {
        modal.classList.add('hidden');
        ok.removeEventListener('click', onOk);
        modal.removeEventListener('keydown', onKey);
        $$('[data-close-modal]', modal).forEach((b) => b.removeEventListener('click', onCancel));
        resolve(val);
      };
      const onOk = () => done(Object.fromEntries($$('input', modal).map((i) => [i.name, i.value.trim()])));
      const onCancel = () => done(null);
      const onKey = (e) => e.key === 'Enter' && onOk();
      const ok = $('#prompt-ok');
      ok.addEventListener('click', onOk);
      modal.addEventListener('keydown', onKey);
      $$('[data-close-modal]', modal).forEach((b) => b.addEventListener('click', onCancel));
    });
  }

  toast(message, type = 'info', timeout = 3500) {
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = message;
    el.addEventListener('click', () => el.remove());
    $('#toast-container').appendChild(el);
    if (timeout) setTimeout(() => el.remove(), timeout);
    return el;
  }

  _getFileIcon(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const map = { ts: '🟦', tsx: '⚛️', js: '🟨', jsx: '⚛️', py: '🐍', html: '🌐', css: '🎨', json: '📦', md: '📝', sql: '🗄️', php: '🐘', rs: '🦀', go: '🐹', sh: '🐚', yml: '⚙️', yaml: '⚙️' };
    return map[ext] || '📄';
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const app = new AppController();
  window.reaApp = app; // handy for debugging from Safari Web Inspector
  app.init().catch((e) => {
    console.error(e);
    document.body.insertAdjacentHTML('beforeend', `<div class="fatal-error">Error iniciando el IDE: ${esc(e.message)}</div>`);
  });
});
