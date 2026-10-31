/**
 * Workspace File System (RF1)
 *
 * Two backends behind one API:
 *   - 'native' : File System Access API (showDirectoryPicker). Chrome/Edge on PC.
 *                Reads/writes the real folder on disk.
 *   - 'idb'    : Persistent browser workspace (LightningFS over IndexedDB). Used on
 *                iPad Safari, where showDirectoryPicker does not exist. Folders picked
 *                from the Files app (<input webkitdirectory>, iPadOS 18.4+) are imported
 *                here, and Git repositories are cloned/pulled/pushed here (see git-service.js).
 *
 * Paths exposed to the rest of the app are always relative ("src/app.ts").
 */
const SKIP_DIRS = new Set(['.git', 'node_modules', '.DS_Store', '__pycache__', '.venv']);
const LAST_WS_KEY = 'rea-ide-last-workspace';
const MAX_IMPORT_BYTES = 5 * 1024 * 1024; // skip single files larger than 5 MB on import

export class FileSystemManager {
  constructor() {
    this.lfs = new window.LightningFS('rea-ide-workspaces');
    this.pfs = this.lfs.promises;
    this.directoryHandle = null;
    this.currentMode = 'idb'; // 'idb' | 'native'
    this.projectName = 'demo';
  }

  // ───────────────────────────── capabilities ─────────────────────────────
  get supportsNativePicker() {
    return 'showDirectoryPicker' in window;
  }

  get supportsGit() {
    return this.currentMode === 'idb';
  }

  /** Absolute dir of the active idb workspace (used by isomorphic-git). */
  get dir() {
    return `/${this.projectName}`;
  }

  // ───────────────────────────── workspaces ─────────────────────────────
  async init() {
    const last = localStorage.getItem(LAST_WS_KEY);
    const list = await this.listWorkspaces();
    if (!list.includes('demo')) await this._seedDemo();
    this.projectName = last && (await this._exists(`/${last}`)) ? last : 'demo';
    this.currentMode = 'idb';
    return this.projectName;
  }

  async listWorkspaces() {
    try {
      return (await this.pfs.readdir('/')).sort();
    } catch {
      return [];
    }
  }

  async openWorkspace(name) {
    if (!(await this._exists(`/${name}`))) throw new Error(`Workspace inexistente: ${name}`);
    this.directoryHandle = null;
    this.currentMode = 'idb';
    this.projectName = name;
    localStorage.setItem(LAST_WS_KEY, name);
    return name;
  }

  async deleteWorkspace(name) {
    await this._rmrf(`/${name}`);
    if (this.projectName === name && this.currentMode === 'idb') {
      if (name === 'demo') await this.init();
      else await this.openWorkspace('demo').catch(() => this.init());
    }
  }

  sanitizeName(name) {
    return (name || 'workspace').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'workspace';
  }

  async uniqueWorkspaceName(base) {
    const list = await this.listWorkspaces();
    let name = this.sanitizeName(base);
    let i = 2;
    while (list.includes(name)) name = `${this.sanitizeName(base)}-${i++}`;
    return name;
  }

  /** PC (Chrome/Edge): mount a real folder with read/write access. */
  async openNativeDirectory() {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    this.directoryHandle = handle;
    this.currentMode = 'native';
    this.projectName = handle.name;
    return { name: handle.name, mode: 'native' };
  }

  /**
   * iPad Safari (and any browser): import a FileList from <input webkitdirectory>
   * into a new persistent idb workspace. Returns stats.
   */
  async importFileList(fileList, onProgress) {
    const files = Array.from(fileList);
    if (!files.length) throw new Error('No se seleccionó ningún archivo.');
    const hasRelative = !!files[0].webkitRelativePath;
    const rootName = hasRelative ? files[0].webkitRelativePath.split('/')[0] : 'importado';
    const name = await this.uniqueWorkspaceName(rootName);
    await this.pfs.mkdir(`/${name}`);

    let imported = 0;
    let skipped = 0;
    for (const file of files) {
      let rel = file.webkitRelativePath || file.name;
      if (hasRelative) rel = rel.split('/').slice(1).join('/');
      if (!rel || rel.split('/').some((p) => SKIP_DIRS.has(p)) || file.size > MAX_IMPORT_BYTES) {
        skipped++;
        continue;
      }
      const data = new Uint8Array(await file.arrayBuffer());
      await this._writeIdb(`/${name}/${rel}`, data);
      imported++;
      onProgress?.(imported, files.length, rel);
    }
    await this.openWorkspace(name);
    return { name, imported, skipped };
  }

  // ───────────────────────────── file API ─────────────────────────────
  async getFileTree() {
    if (this.currentMode === 'native' && this.directoryHandle) {
      return this._scanNative(this.directoryHandle, '');
    }
    return this._scanIdb(this.dir, '');
  }

  /** Flat list of file paths (used for AI context and terminal). */
  async listAllFiles(limit = 2000) {
    const out = [];
    const walk = (items) => {
      for (const it of items) {
        if (out.length >= limit) return;
        if (it.kind === 'file') out.push(it.path);
        else if (it.children) walk(it.children);
      }
    };
    walk(await this.getFileTree());
    return out;
  }

  async readFile(path) {
    if (this.currentMode === 'native' && this.directoryHandle) {
      const fh = await this._resolveNative(path, false);
      return await (await fh.getFile()).text();
    }
    return await this.pfs.readFile(`${this.dir}/${path}`, { encoding: 'utf8' });
  }

  async writeFile(path, content) {
    path = path.replace(/^\/+/, '');
    if (this.currentMode === 'native' && this.directoryHandle) {
      const fh = await this._resolveNative(path, true);
      const w = await fh.createWritable();
      await w.write(content);
      await w.close();
      return true;
    }
    await this._writeIdb(`${this.dir}/${path}`, content);
    return true;
  }

  async exists(path) {
    try {
      if (this.currentMode === 'native' && this.directoryHandle) {
        await this._resolveNative(path, false);
        return true;
      }
      return await this._exists(`${this.dir}/${path}`);
    } catch {
      return false;
    }
  }

  async deleteFile(path) {
    if (this.currentMode === 'native' && this.directoryHandle) {
      const parts = path.split('/');
      let cur = this.directoryHandle;
      for (const p of parts.slice(0, -1)) cur = await cur.getDirectoryHandle(p);
      await cur.removeEntry(parts.at(-1), { recursive: true });
      return;
    }
    await this._rmrf(`${this.dir}/${path}`);
  }

  // ───────────────────────────── idb internals ─────────────────────────────
  async _exists(abs) {
    try {
      await this.pfs.stat(abs);
      return true;
    } catch {
      return false;
    }
  }

  async _mkdirp(absDir) {
    const parts = absDir.split('/').filter(Boolean);
    let cur = '';
    for (const p of parts) {
      cur += `/${p}`;
      try {
        await this.pfs.mkdir(cur);
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
      }
    }
  }

  async _writeIdb(abs, data) {
    await this._mkdirp(abs.split('/').slice(0, -1).join('/'));
    await this.pfs.writeFile(abs, data, typeof data === 'string' ? { encoding: 'utf8', mode: 0o644 } : { mode: 0o644 });
  }

  async _rmrf(abs) {
    let st;
    try {
      st = await this.pfs.stat(abs);
    } catch {
      return;
    }
    if (st.isDirectory()) {
      for (const child of await this.pfs.readdir(abs)) await this._rmrf(`${abs}/${child}`);
      await this.pfs.rmdir(abs);
    } else {
      await this.pfs.unlink(abs);
    }
  }

  async _scanIdb(abs, base) {
    let names = [];
    try {
      names = await this.pfs.readdir(abs);
    } catch {
      return [];
    }
    const items = [];
    for (const name of names) {
      if (SKIP_DIRS.has(name)) continue;
      const path = base ? `${base}/${name}` : name;
      const st = await this.pfs.stat(`${abs}/${name}`);
      if (st.isDirectory()) {
        items.push({ name, path, kind: 'directory', children: await this._scanIdb(`${abs}/${name}`, path) });
      } else {
        items.push({ name, path, kind: 'file' });
      }
    }
    return this._sort(items);
  }

  // ───────────────────────────── native internals ─────────────────────────────
  async _scanNative(dirHandle, base) {
    const items = [];
    for await (const entry of dirHandle.values()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const path = base ? `${base}/${entry.name}` : entry.name;
      if (entry.kind === 'directory') {
        items.push({ name: entry.name, path, kind: 'directory', children: await this._scanNative(entry, path) });
      } else {
        items.push({ name: entry.name, path, kind: 'file' });
      }
    }
    return this._sort(items);
  }

  async _resolveNative(path, create) {
    const parts = path.split('/').filter(Boolean);
    let cur = this.directoryHandle;
    for (const p of parts.slice(0, -1)) cur = await cur.getDirectoryHandle(p, { create });
    return await cur.getFileHandle(parts.at(-1), { create });
  }

  _sort(items) {
    return items.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : 1));
  }

  async _seedDemo() {
    const files = {
      'README.md':
        '# Workspace demo — REA Agentic IDE\n\n' +
        'Este workspace vive en el almacenamiento persistente del navegador (IndexedDB).\n\n' +
        '## Primeros pasos\n' +
        '1. **⚙️ Cuenta** → pega tu API key de Google AI Studio o inicia sesión con Google.\n' +
        '2. **📁 Abrir Carpeta** → selecciona una carpeta del iPad/PC o **clona un repositorio Git**.\n' +
        '3. Conversa con el agente: tiene como contexto el archivo abierto y el árbol del proyecto.\n' +
        '4. **💾 Guardar** → guarda el archivo, o genera el *Plan* y el *Walkthrough* en `Docs/`.\n',
      'src/main.py':
        'def execute_task(name: str) -> dict:\n    print(f"[*] Ejecutando tarea: {name}")\n    return {"status": "success"}\n\n\nif __name__ == "__main__":\n    print(execute_task("demo"))\n',
      'src/app.ts':
        'export interface Contract {\n  id: string;\n  name: string;\n  status: "draft" | "active" | "verified";\n}\n\nexport class ContractService {\n  private contracts = new Map<string, Contract>();\n\n  register(contract: Contract): boolean {\n    this.contracts.set(contract.id, contract);\n    return true;\n  }\n}\n',
      'Docs/.keep': ''
    };
    for (const [p, c] of Object.entries(files)) await this._writeIdb(`/demo/${p}`, c);
  }
}
