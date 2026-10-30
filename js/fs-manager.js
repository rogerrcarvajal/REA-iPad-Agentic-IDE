/**
 * File System Manager
 * Supports File System Access API (showDirectoryPicker) for real local disk folders
 * with fallback to Origin Private File System (OPFS) and in-memory sample project.
 */
export class FileSystemManager {
  constructor() {
    this.directoryHandle = null;
    this.virtualFiles = new Map();
    this.currentMode = 'virtual'; // 'native' | 'virtual'
    this.projectName = 'Proyecto Demo';
    this.initDefaultProject();
  }

  initDefaultProject() {
    this.virtualFiles.set('README.md', {
      name: 'README.md',
      path: 'README.md',
      content: '# Bienvenido a REA Agentic IDE para iPad Pro M2\n\nEste entorno de desarrollo ha sido optimizado para la memoria unificada del procesador Apple Silicon M2.\n\n### Características principales:\n- **Monaco Editor:** Resaltado sintáctico, autocompletado y atajos de VS Code.\n- **Modo Agente Antigravity:** Planificación autónoma, llamadas a herramientas y Living Artifacts (Mermaid).\n- **Barra táctil flotante:** Atajos rápidos a caracteres esenciales sin teclado físico.\n- **File System Access:** Pulsa "Abrir Carpeta" para trabajar sobre carpetas reales de tu iPad o PC.\n',
      kind: 'file'
    });

    this.virtualFiles.set('src/main.py', {
      name: 'main.py',
      path: 'src/main.py',
      content: '"""\nServicio de procesamiento de alto rendimiento en iPad Pro M2\n"""\nimport sys\n\ndef execute_task(name: str):\n    print(f"[*] Ejecutando tarea agéntica: {name}")\n    return {"status": "success", "device": "iPad Pro M2", "arch": "ARM64"}\n\nif __name__ == "__main__":\n    result = execute_task("Deconstrucción Clean-Room")\n    print(result)\n',
      kind: 'file'
    });

    this.virtualFiles.set('src/app.ts', {
      name: 'app.ts',
      path: 'src/app.ts',
      content: 'export interface CleanRoomContract {\n  id: string;\n  name: string;\n  status: "draft" | "active" | "verified";\n}\n\nexport class ContractService {\n  private contracts: Map<string, CleanRoomContract> = new Map();\n\n  public register(contract: CleanRoomContract): boolean {\n    this.contracts.set(contract.id, contract);\n    console.log(`[+] Contrato registrado: ${contract.name}`);\n    return true;\n  }\n}\n',
      kind: 'file'
    });
  }

  async openDirectoryPicker() {
    if ('showDirectoryPicker' in window) {
      try {
        this.directoryHandle = await window.showDirectoryPicker({
          mode: 'readwrite'
        });
        this.currentMode = 'native';
        this.projectName = this.directoryHandle.name;
        return { success: true, name: this.projectName };
      } catch (err) {
        if (err.name === 'AbortError') {
          return { success: false, aborted: true };
        }
        console.warn('File System Access API error, using virtual fallback:', err);
      }
    }
    // Fallback: notify that virtual workspace is active
    return { success: true, name: this.projectName, fallback: true };
  }

  async getFileTree() {
    if (this.currentMode === 'native' && this.directoryHandle) {
      return await this._scanNativeDirectory(this.directoryHandle, '');
    } else {
      return this._buildVirtualTree();
    }
  }

  async _scanNativeDirectory(dirHandle, basePath) {
    const items = [];
    for await (const entry of dirHandle.values()) {
      const itemPath = basePath ? `${basePath}/${entry.name}` : entry.name;
      if (entry.kind === 'directory') {
        if (entry.name === '.git' || entry.name === 'node_modules') continue;
        const children = await this._scanNativeDirectory(entry, itemPath);
        items.push({
          name: entry.name,
          path: itemPath,
          kind: 'directory',
          handle: entry,
          children
        });
      } else {
        items.push({
          name: entry.name,
          path: itemPath,
          kind: 'file',
          handle: entry
        });
      }
    }
    return items.sort((a, b) => {
      if (a.kind === b.kind) return a.name.localeCompare(b.name);
      return a.kind === 'directory' ? -1 : 1;
    });
  }

  _buildVirtualTree() {
    const root = [];
    const dirMap = new Map();

    for (const [path, file] of this.virtualFiles.entries()) {
      const parts = path.split('/');
      if (parts.length === 1) {
        root.push({ name: file.name, path: file.path, kind: 'file' });
      } else {
        let currentLevel = root;
        let accumulatedPath = '';
        for (let i = 0; i < parts.length - 1; i++) {
          const dirName = parts[i];
          accumulatedPath = accumulatedPath ? `${accumulatedPath}/${dirName}` : dirName;
          if (!dirMap.has(accumulatedPath)) {
            const newDir = { name: dirName, path: accumulatedPath, kind: 'directory', children: [] };
            dirMap.set(accumulatedPath, newDir);
            currentLevel.push(newDir);
          }
          currentLevel = dirMap.get(accumulatedPath).children;
        }
        currentLevel.push({ name: file.name, path: file.path, kind: 'file' });
      }
    }
    return root;
  }

  async readFile(path) {
    if (this.currentMode === 'native' && this.directoryHandle) {
      const fileHandle = await this._resolveNativePath(path);
      if (!fileHandle) throw new Error(`Archivo no encontrado: ${path}`);
      const file = await fileHandle.getFile();
      return await file.text();
    } else {
      const item = this.virtualFiles.get(path);
      if (!item) throw new Error(`Archivo virtual no encontrado: ${path}`);
      return item.content;
    }
  }

  async writeFile(path, content) {
    if (this.currentMode === 'native' && this.directoryHandle) {
      const fileHandle = await this._resolveNativePath(path, true);
      const writable = await fileHandle.createWritable();
      await writable.write(content);
      await writable.close();
      return true;
    } else {
      const name = path.split('/').pop();
      this.virtualFiles.set(path, { name, path, content, kind: 'file' });
      return true;
    }
  }

  async _resolveNativePath(path, create = false) {
    const parts = path.split('/');
    let current = this.directoryHandle;
    for (let i = 0; i < parts.length - 1; i++) {
      current = await current.getDirectoryHandle(parts[i], { create });
    }
    return await current.getFileHandle(parts[parts.length - 1], { create });
  }
}
