/**
 * Virtual POSIX Terminal for iPad Pro M2
 */
export class VirtualTerminal {
  constructor(containerId, fsManager, agentOrchestrator) {
    this.container = document.getElementById(containerId);
    this.fsManager = fsManager;
    this.agentOrchestrator = agentOrchestrator;
    this.history = [];
    this.historyIndex = 0;
  }

  init() {
    this.container.innerHTML = `
      <div class="terminal-line"><span style="color: #38bdf8; font-weight: bold;">REA Agentic Terminal [iPad Pro M2 - ARM64 Virtual POSIX]</span></div>
      <div class="terminal-line" style="color: #64748b;">Escribe 'help' para ver la lista de comandos disponibles.</div>
      <div id="terminal-output"></div>
      <div class="terminal-input-row" style="display: flex; align-items: center; margin-top: 4px;">
        <span class="terminal-prompt">rea@ipad-m2:~$</span>
        <input type="text" id="term-input" style="flex: 1; background: transparent; border: none; color: #fff; font-family: inherit; font-size: 12px; outline: none;" />
      </div>
    `;

    this.output = document.getElementById('terminal-output');
    this.input = document.getElementById('term-input');

    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const cmd = this.input.value.trim();
        if (cmd) {
          this.execute(cmd);
          this.history.push(cmd);
          this.historyIndex = this.history.length;
          this.input.value = '';
        }
      }
    });
  }

  print(text, color = '#f8fafc') {
    const line = document.createElement('div');
    line.className = 'terminal-line';
    line.style.color = color;
    line.textContent = text;
    this.output.appendChild(line);
    this.container.scrollTop = this.container.scrollHeight;
  }

  async execute(cmdLine) {
    this.print(`rea@ipad-m2:~$ ${cmdLine}`, '#94a3b8');
    const [cmd, ...args] = cmdLine.split(' ');

    switch (cmd.toLowerCase()) {
      case 'help':
        this.print('Comandos disponibles:');
        this.print('  ls            - Listar archivos del proyecto actual');
        this.print('  cat <archivo> - Mostrar contenido de un archivo');
        this.print('  agent <msg>   - Enviar prompt directo al agente Antigravity');
        this.print('  info          - Ver especificaciones del entorno y hardware');
        this.print('  clear         - Limpiar pantalla de la terminal');
        break;

      case 'ls':
        const tree = await this.fsManager.getFileTree();
        tree.forEach((item) => {
          const prefix = item.kind === 'directory' ? '📁 ' : '📄 ';
          this.print(`  ${prefix}${item.name}`, item.kind === 'directory' ? '#38bdf8' : '#f8fafc');
        });
        break;

      case 'cat':
        if (!args[0]) {
          this.print('Uso: cat <nombre_archivo>', '#ef4444');
          return;
        }
        try {
          const content = await this.fsManager.readFile(args[0]);
          this.print(content, '#94a3b8');
        } catch (err) {
          this.print(`Error: ${err.message}`, '#ef4444');
        }
        break;

      case 'agent':
        const prompt = args.join(' ');
        if (!prompt) {
          this.print('Uso: agent <mensaje>', '#ef4444');
          return;
        }
        this.print('[*] Enviando instrucción al Agente Antigravity...', '#a855f7');
        await this.agentOrchestrator.sendUserPrompt(prompt);
        break;

      case 'info':
        this.print('Hardware: Apple Silicon M2 (ARM64)');
        this.print('Memoria: Unified Memory Architecture (16GB)');
        this.print('Pantalla: Liquid Retina XDR (ProMotion 120Hz)');
        this.print(`Proyecto activo: ${this.fsManager.projectName} (Modo: ${this.fsManager.currentMode})`);
        this.print(`Modelo IA activo: ${this.agentOrchestrator.currentModel}`);
        break;

      case 'clear':
        this.output.innerHTML = '';
        break;

      default:
        this.print(`Comando no reconocido: ${cmd}. Escribe 'help' para ayuda.`, '#ef4444');
    }
  }
}
