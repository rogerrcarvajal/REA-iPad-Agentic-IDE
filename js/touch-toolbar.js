/**
 * Touch Modifier Toolbar for iPad Pro M2
 * Provides rapid touch access to essential programming keys without virtual keyboard lag.
 */
export class TouchToolbar {
  constructor(containerId, editorManager) {
    this.container = document.getElementById(containerId);
    this.editorManager = editorManager;
    this.keys = [
      { label: 'Esc', action: () => this.editorManager.insertText('') },
      { label: 'Tab', text: '  ' },
      { label: '{', text: '{' },
      { label: '}', text: '}' },
      { label: '(', text: '(' },
      { label: ')', text: ')' },
      { label: '[', text: '[' },
      { label: ']', text: ']' },
      { label: '<', text: '<' },
      { label: '>', text: '>' },
      { label: '=>', text: ' => ' },
      { label: ';', text: ';' },
      { label: ':', text: ':' },
      { label: '=', text: ' = ' },
      { label: '"', text: '"' },
      { label: "'", text: "'" },
      { label: '`', text: '`' },
      { label: '|', text: '|' },
      { label: '/', text: '/' },
      { label: '\\', text: '\\' },
      { label: '~', text: '~' },
      { label: '!', text: '!' },
      { label: '←', action: () => this.editorManager.moveCursor('left') },
      { label: '→', action: () => this.editorManager.moveCursor('right') },
      { label: '↑', action: () => this.editorManager.moveCursor('up') },
      { label: '↓', action: () => this.editorManager.moveCursor('down') }
    ];
  }

  render() {
    this.container.innerHTML = '';
    this.keys.forEach((k) => {
      const btn = document.createElement('div');
      btn.className = 'touch-key';
      btn.textContent = k.label;
      if (['Esc', 'Tab', '←', '→', '↑', '↓'].includes(k.label)) {
        btn.classList.add('mod-key');
      }

      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (navigator.vibrate) navigator.vibrate(10);
        // If a text field (terminal / chat prompt) has focus, type there instead of Monaco.
        const field = document.activeElement;
        const isField = field && (field.tagName === 'INPUT' || field.tagName === 'TEXTAREA') && !field.closest('#monaco-container');
        if (isField && k.text) {
          const { selectionStart: s, selectionEnd: en, value } = field;
          const text = k.label === 'Tab' ? '\t' : k.text.trim() || k.text;
          field.value = value.slice(0, s) + text + value.slice(en);
          field.selectionStart = field.selectionEnd = s + text.length;
          return;
        }
        if (k.action) {
          k.action();
        } else if (k.text) {
          this.editorManager.insertText(k.text);
        }
      });

      this.container.appendChild(btn);
    });
  }
}
