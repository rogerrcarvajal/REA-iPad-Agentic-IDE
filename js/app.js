import { FileSystemManager } from './fs-manager.js';
import { EditorManager } from './editor-manager.js';
import { AgentOrchestrator } from './agent-orchestrator.js';
import { TouchToolbar } from './touch-toolbar.js';
import { VirtualTerminal } from './terminal.js';

class AppController {
  constructor() {
    this.fs = new FileSystemManager();
    this.editor = new EditorManager(
      'monaco-container',
      (path, tab) => this.renderTabs(),
      (path, content) => this.saveCurrentFile(path, content)
    );
    this.agent = new AgentOrchestrator(this.editor, this.fs);
    this.touchToolbar = new TouchToolbar('touch-toolbar', this.editor);
    this.terminal = new VirtualTerminal('terminal-body', this.fs, this.agent);
  }

  async init() {
    console.log('[+] Inicializando REA Agentic IDE para iPad Pro M2...');

    // 1. Init editor
    await this.editor.init();

    // 2. Init touch toolbar
    this.touchToolbar.render();

    // 3. Init terminal
    this.terminal.init();

    // 4. Setup Agent listener
    this.agent.onMessage((msg) => this.renderAgentMessage(msg));

    // 5. Setup UI Event Listeners
    this.setupUIEvents();

    // 6. Load initial file tree & default file
    await this.refreshFileTree();
    await this.openFile('README.md');

    // 7. Register Service Worker for PWA
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./service-worker.js').catch((err) => {
        console.warn('Service worker registration failed:', err);
      });
    }

    // 8. Welcome message from agent
    this.agent._notify({
      role: 'agent',
      content: `👋 **¡Bienvenido a REA Agentic IDE para iPad Pro M2!**\n\nEstoy listo para asistirte en la deconstrucción y reconstrucción de tus proyectos utilizando **Clean-Room Design**, contratos **OpenAPI 3.1**, modelos **DER** y diagramas **C4**.\n\nPulsa en **"Abrir Carpeta"** para cargar cualquier repositorio local de tu iPad o PC.`
    });
  }

  setupUIEvents() {
    // Open Directory button
    document.getElementById('btn-open-folder').addEventListener('click', async () => {
      const res = await this.fs.openDirectoryPicker();
      if (res.success) {
        document.getElementById('project-title').textContent = res.name;
        await this.refreshFileTree();
        this.terminal.print(`[+] Carpeta montada: ${res.name}`, '#10b981');
      }
    });

    // Save button
    document.getElementById('btn-save').addEventListener('click', async () => {
      if (this.editor.activeTab) {
        await this.saveCurrentFile(this.editor.activeTab, this.editor.getValue());
      }
    });

    // Toggle Sidebar
    document.getElementById('btn-toggle-sidebar').addEventListener('click', () => {
      document.getElementById('sidebar-panel').classList.toggle('collapsed');
      if (this.editor.editor) this.editor.editor.layout();
    });

    // Toggle Agent Panel
    document.getElementById('btn-toggle-agent').addEventListener('click', () => {
      document.getElementById('agent-panel').classList.toggle('collapsed');
      if (this.editor.editor) this.editor.editor.layout();
    });

    // Toggle Terminal
    document.getElementById('btn-toggle-terminal').addEventListener('click', () => {
      document.getElementById('terminal-panel').classList.toggle('collapsed');
      if (this.editor.editor) this.editor.editor.layout();
    });

    // Model Selector
    document.getElementById('model-select').addEventListener('change', (e) => {
      this.agent.setModel(e.target.value);
      this.terminal.print(`[*] Modelo de IA cambiado a: ${e.target.value}`, '#a855f7');
    });

    // Agent Prompt input
    const promptInput = document.getElementById('agent-prompt-input');
    const sendBtn = document.getElementById('btn-send-agent');

    const handleSend = async () => {
      const text = promptInput.value.trim();
      if (!text) return;
      promptInput.value = '';
      await this.agent.sendUserPrompt(text);
    };

    sendBtn.addEventListener('click', handleSend);
    promptInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });

    // Quick Action Chips
    document.querySelectorAll('.chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const actionText = chip.getAttribute('data-action');
        if (actionText) this.agent.sendUserPrompt(actionText);
      });
    });
  }

  async refreshFileTree() {
    const container = document.getElementById('file-tree-container');
    container.innerHTML = '';
    const items = await this.fs.getFileTree();

    const renderLevel = (list, parentEl) => {
      list.forEach((item) => {
        const row = document.createElement('div');
        row.className = 'tree-item';
        row.style.paddingLeft = `${12 + (item.path.split('/').length - 1) * 12}px`;

        const icon = document.createElement('span');
        icon.className = 'tree-item-icon';
        icon.textContent = item.kind === 'directory' ? '📁' : this._getFileIcon(item.name);

        const name = document.createElement('span');
        name.textContent = item.name;

        row.appendChild(icon);
        row.appendChild(name);

        if (item.kind === 'file') {
          row.addEventListener('click', () => this.openFile(item.path));
        }

        parentEl.appendChild(row);

        if (item.kind === 'directory' && item.children) {
          renderLevel(item.children, parentEl);
        }
      });
    };

    renderLevel(items, container);
  }

  async openFile(path) {
    try {
      const content = await this.fs.readFile(path);
      this.editor.openFile(path, content);
      this.renderTabs();
    } catch (err) {
      console.error('Error abriendo archivo:', err);
    }
  }

  async saveCurrentFile(path, content) {
    try {
      await this.fs.writeFile(path, content);
      const tab = this.editor.tabs.get(path);
      if (tab) tab.isDirty = false;
      this.renderTabs();
      this.terminal.print(`[✓] Guardado: ${path}`, '#10b981');
    } catch (err) {
      this.terminal.print(`[!] Error guardando: ${err.message}`, '#ef4444');
    }
  }

  renderTabs() {
    const container = document.getElementById('tabs-bar');
    container.innerHTML = '';

    for (const [path, tab] of this.editor.tabs.entries()) {
      const tabEl = document.createElement('div');
      tabEl.className = `tab ${this.editor.activeTab === path ? 'active' : ''}`;

      const title = document.createElement('span');
      title.textContent = `${tab.name}${tab.isDirty ? ' •' : ''}`;
      tabEl.appendChild(title);

      const close = document.createElement('span');
      close.className = 'tab-close';
      close.textContent = '✕';
      close.addEventListener('click', (e) => {
        e.stopPropagation();
        this.editor.closeTab(path);
        this.renderTabs();
      });
      tabEl.appendChild(close);

      tabEl.addEventListener('click', () => {
        this.editor.switchTab(path);
        this.renderTabs();
      });

      container.appendChild(tabEl);
    }
  }

  renderAgentMessage(msg) {
    const container = document.getElementById('agent-messages');

    if (msg.isThinking) {
      const thinkBox = document.createElement('div');
      thinkBox.className = 'agent-thinking';
      thinkBox.innerHTML = `<div>⚡ <strong>Planificando...</strong></div><pre style="margin-top: 4px; white-space: pre-wrap;">${msg.thinkingText}</pre>`;
      container.appendChild(thinkBox);
      container.scrollTop = container.scrollHeight;
      return;
    }

    const bubble = document.createElement('div');
    bubble.className = `message-bubble ${msg.role === 'user' ? 'message-user' : 'message-agent'}`;

    // Markdown-like bold and line breaks
    let formatted = msg.content
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br/>');

    bubble.innerHTML = formatted;

    // Artifact rendering
    if (msg.artifact) {
      const artBox = document.createElement('div');
      artBox.className = 'agent-artifact-box';

      const artTitle = document.createElement('div');
      artTitle.className = 'artifact-title';
      artTitle.innerHTML = `💎 <span>${msg.artifact.title}</span>`;
      artBox.appendChild(artTitle);

      if (msg.artifact.type === 'mermaid') {
        const mermaidPre = document.createElement('div');
        mermaidPre.className = 'mermaid';
        mermaidPre.textContent = msg.artifact.code;
        artBox.appendChild(mermaidPre);

        // Render with mermaid if loaded
        if (window.mermaid) {
          setTimeout(() => window.mermaid.run({ nodes: [mermaidPre] }), 50);
        }
      } else {
        const codePre = document.createElement('pre');
        codePre.style.cssText = 'background: #05070a; padding: 8px; border-radius: 6px; font-family: var(--font-mono); font-size: 11px; overflow-x: auto; color: #38bdf8;';
        codePre.textContent = msg.artifact.code;
        artBox.appendChild(codePre);
      }

      bubble.appendChild(artBox);
    }

    // Apply code button if available
    if (msg.canApply && msg.newCode) {
      const applyBtn = document.createElement('button');
      applyBtn.className = 'btn btn-primary';
      applyBtn.style.cssText = 'margin-top: 8px; font-size: 11px; padding: 4px 10px;';
      applyBtn.innerHTML = '⚡ Aplicar al Editor Monaco';
      applyBtn.addEventListener('click', () => {
        this.editor.setValue(msg.newCode);
        applyBtn.textContent = '✓ Aplicado exitosamente';
        applyBtn.disabled = true;
      });
      bubble.appendChild(applyBtn);
    }

    container.appendChild(bubble);
    container.scrollTop = container.scrollHeight;
  }

  _getFileIcon(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const map = {
      ts: '🟦',
      tsx: '⚛️',
      js: '🟨',
      py: '🐍',
      html: '🌐',
      css: '🎨',
      json: '📦',
      md: '📝',
      sql: '🗄️',
      c: '🇨',
      cpp: '🇨',
      rs: '🦀'
    };
    return map[ext] || '📄';
  }
}

// Bootstrap on DOM loaded
window.addEventListener('DOMContentLoaded', () => {
  const app = new AppController();
  app.init();
});
