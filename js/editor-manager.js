/**
 * Editor Manager - Monaco Editor integration for iPad Pro M2
 */
export class EditorManager {
  constructor(containerId, onContentChange, onSave) {
    this.container = document.getElementById(containerId);
    this.editor = null;
    this.tabs = new Map(); // path -> { model, state, language, isDirty }
    this.activeTab = null;
    this.onContentChange = onContentChange;
    this.onSave = onSave;
  }

  async init() {
    return new Promise((resolve) => {
      if (window.monaco) {
        this._setupMonaco();
        resolve(this.editor);
      } else {
        // Load Monaco via AMD loader
        window.require.config({
          paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' }
        });
        window.require(['vs/editor/editor.main'], () => {
          this._setupMonaco();
          resolve(this.editor);
        });
      }
    });
  }

  _setupMonaco() {
    monaco.editor.defineTheme('rea-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '64748b', fontStyle: 'italic' },
        { token: 'keyword', foreground: '38bdf8', fontStyle: 'bold' },
        { token: 'string', foreground: '10b981' },
        { token: 'number', foreground: 'f59e0b' },
        { token: 'type', foreground: 'a855f7' }
      ],
      colors: {
        'editor.background': '#0a0d14',
        'editor.foreground': '#f8fafc',
        'editorCursor.foreground': '#38bdf8',
        'editor.lineHighlightBackground': '#141a29',
        'editorLineNumber.foreground': '#334155',
        'editorLineNumber.activeForeground': '#38bdf8',
        'editor.selectionBackground': '#2563eb44'
      }
    });

    this.editor = monaco.editor.create(this.container, {
      theme: 'rea-dark',
      fontSize: 13.5,
      fontFamily: '"SF Mono", "JetBrains Mono", Menlo, Consolas, monospace',
      automaticLayout: true,
      minimap: { enabled: window.innerWidth > 900 },
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      renderWhitespace: 'selection',
      tabSize: 2,
      wordWrap: 'on',
      cursorBlinking: 'smooth',
      cursorSmoothCaretAnimation: 'on'
    });

    // Save shortcut: Cmd+S / Ctrl+S
    this.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      if (this.onSave && this.activeTab) {
        this.onSave(this.activeTab, this.editor.getValue());
      }
    });

    this.editor.onDidChangeModelContent(() => {
      if (this.activeTab && this.tabs.has(this.activeTab)) {
        const tab = this.tabs.get(this.activeTab);
        tab.isDirty = true;
        if (this.onContentChange) this.onContentChange(this.activeTab, tab);
      }
    });
  }

  openFile(path, content) {
    if (!this.tabs.has(path)) {
      const language = this._detectLanguage(path);
      const model = monaco.editor.createModel(content, language);
      this.tabs.set(path, {
        path,
        name: path.split('/').pop(),
        model,
        language,
        isDirty: false
      });
    }

    this.switchTab(path);
    return this.tabs.get(path);
  }

  switchTab(path) {
    if (!this.tabs.has(path)) return;
    const tab = this.tabs.get(path);
    this.editor.setModel(tab.model);
    this.activeTab = path;
  }

  closeTab(path) {
    if (!this.tabs.has(path)) return;
    const tab = this.tabs.get(path);
    tab.model.dispose();
    this.tabs.delete(path);

    if (this.activeTab === path) {
      const remaining = Array.from(this.tabs.keys());
      if (remaining.length > 0) {
        this.switchTab(remaining[remaining.length - 1]);
      } else {
        this.activeTab = null;
        this.editor.setModel(null);
      }
    }
  }

  insertText(text) {
    if (!this.editor) return;
    const selection = this.editor.getSelection();
    const op = { range: selection, text: text, forceMoveMarkers: true };
    this.editor.executeEdits('touch-toolbar', [op]);
    this.editor.focus();
  }

  moveCursor(direction) {
    if (!this.editor) return;
    const pos = this.editor.getPosition();
    if (!pos) return;
    let newPos = { ...pos };
    if (direction === 'left') newPos.column = Math.max(1, pos.column - 1);
    if (direction === 'right') newPos.column = pos.column + 1;
    if (direction === 'up') newPos.lineNumber = Math.max(1, pos.lineNumber - 1);
    if (direction === 'down') newPos.lineNumber = pos.lineNumber + 1;
    this.editor.setPosition(newPos);
    this.editor.revealPosition(newPos);
    this.editor.focus();
  }

  getValue() {
    return this.editor ? this.editor.getValue() : '';
  }

  getSelectionText() {
    if (!this.editor) return '';
    const sel = this.editor.getSelection();
    return sel && !sel.isEmpty() ? this.editor.getModel().getValueInRange(sel) : '';
  }

  /** Refresh an open tab after the file was written by the agent/git (keeps undo stack). */
  updateFileIfOpen(path, content) {
    const tab = this.tabs.get(path);
    if (!tab) return false;
    if (tab.model.getValue() !== content) {
      tab.model.pushEditOperations([], [{ range: tab.model.getFullModelRange(), text: content }], () => null);
    }
    tab.isDirty = false;
    return true;
  }

  closeAll() {
    for (const path of Array.from(this.tabs.keys())) this.closeTab(path);
  }

  markSaved(path) {
    const tab = this.tabs.get(path);
    if (tab) tab.isDirty = false;
  }

  setValue(val) {
    if (this.editor) this.editor.setValue(val);
  }

  _detectLanguage(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const map = {
      js: 'javascript',
      mjs: 'javascript',
      ts: 'typescript',
      tsx: 'typescript',
      py: 'python',
      html: 'html',
      css: 'css',
      json: 'json',
      md: 'markdown',
      yaml: 'yaml',
      yml: 'yaml',
      sql: 'sql',
      rs: 'rust',
      go: 'go',
      cpp: 'cpp',
      c: 'c',
      sh: 'shell'
    };
    return map[ext] || 'plaintext';
  }
}
