/**
 * Git service (RF1) — isomorphic-git running 100% in the browser over the idb workspace.
 * Network traffic goes through the same-origin PHP proxy (api/git-proxy.php) because
 * GitHub's git endpoints do not send CORS headers.
 */
import { Settings } from './settings.js';

export class GitService {
  constructor(fsManager) {
    this.fsm = fsManager;
  }

  get git() {
    return window.git;
  }

  get http() {
    return window.GitHttp;
  }

  get corsProxy() {
    return Settings.appUrl('api/git-proxy.php');
  }

  _onAuth() {
    const token = Settings.get('githubToken');
    return token ? { username: token, password: 'x-oauth-basic' } : undefined;
  }

  _author() {
    const name = Settings.get('gitAuthorName');
    const email = Settings.get('gitAuthorEmail');
    if (!name || !email) {
      throw new Error('Configura tu nombre y email de Git en ⚙️ Cuenta → Git antes de hacer commit/pull.');
    }
    return { name, email };
  }

  _assertIdb() {
    if (!this.fsm.supportsGit) {
      throw new Error(
        'Git en el navegador solo opera sobre workspaces del IDE (clonados o importados). ' +
          'Para una carpeta nativa del PC usa la terminal en modo PC: `pc git pull`.'
      );
    }
  }

  _common(extra = {}) {
    return { fs: this.fsm.lfs, http: this.http, dir: this.fsm.dir, corsProxy: this.corsProxy, onAuth: () => this._onAuth(), ...extra };
  }

  static repoNameFromUrl(url) {
    return (url.split('/').pop() || 'repo').replace(/\.git$/, '');
  }

  static normalizeUrl(url) {
    url = url.trim();
    if (/^[\w.-]+\/[\w.-]+$/.test(url)) url = `https://github.com/${url}`; // "owner/repo"
    if (!/^https:\/\//.test(url)) throw new Error('Usa una URL HTTPS (ej. https://github.com/owner/repo.git o owner/repo).');
    return url;
  }

  async isRepo() {
    if (!this.fsm.supportsGit) return false;
    try {
      await this.fsm.pfs.stat(`${this.fsm.dir}/.git`);
      return true;
    } catch {
      return false;
    }
  }

  async clone(rawUrl, { name, ref, onProgress, onMessage } = {}) {
    const url = GitService.normalizeUrl(rawUrl);
    const wsName = await this.fsm.uniqueWorkspaceName(name || GitService.repoNameFromUrl(url));
    await this.fsm.pfs.mkdir(`/${wsName}`);
    try {
      await this.git.clone({
        fs: this.fsm.lfs,
        http: this.http,
        dir: `/${wsName}`,
        corsProxy: this.corsProxy,
        url,
        ref: ref || undefined,
        singleBranch: true,
        depth: 50,
        onAuth: () => this._onAuth(),
        onAuthFailure: () => {
          throw new Error('Autenticación rechazada. Para repos privados agrega un GitHub token en ⚙️ Cuenta → Git.');
        },
        onProgress,
        onMessage
      });
    } catch (e) {
      await this.fsm.deleteWorkspace(wsName).catch(() => {});
      throw e;
    }
    await this.fsm.openWorkspace(wsName);
    return wsName;
  }

  async currentBranch() {
    return (await this.git.currentBranch({ fs: this.fsm.lfs, dir: this.fsm.dir, fullname: false })) || 'HEAD';
  }

  async remoteUrl() {
    const remotes = await this.git.listRemotes({ fs: this.fsm.lfs, dir: this.fsm.dir });
    return remotes.find((r) => r.remote === 'origin')?.url || remotes[0]?.url || '';
  }

  async pull({ onProgress, onMessage } = {}) {
    this._assertIdb();
    const ref = await this.currentBranch();
    await this.git.pull(
      this._common({ ref, singleBranch: true, fastForward: true, author: this._author(), onProgress, onMessage })
    );
    return ref;
  }

  /** @returns {Promise<{path:string,status:string}[]>} */
  async status() {
    this._assertIdb();
    const matrix = await this.git.statusMatrix({ fs: this.fsm.lfs, dir: this.fsm.dir });
    const out = [];
    for (const [path, head, workdir, stage] of matrix) {
      if (head === 1 && workdir === 1 && stage === 1) continue;
      let status = 'modificado';
      if (head === 0 && workdir === 2) status = 'nuevo';
      else if (workdir === 0) status = 'eliminado';
      out.push({ path, status, head, workdir, stage });
    }
    return out;
  }

  async commitAll(message) {
    this._assertIdb();
    if (!message?.trim()) throw new Error('El mensaje de commit es obligatorio.');
    const changes = await this.status();
    if (!changes.length) return null;
    for (const c of changes) {
      if (c.workdir === 0) await this.git.remove({ fs: this.fsm.lfs, dir: this.fsm.dir, filepath: c.path });
      else await this.git.add({ fs: this.fsm.lfs, dir: this.fsm.dir, filepath: c.path });
    }
    return await this.git.commit({ fs: this.fsm.lfs, dir: this.fsm.dir, message: message.trim(), author: this._author() });
  }

  async push({ onProgress, onMessage } = {}) {
    this._assertIdb();
    if (!Settings.get('githubToken')) throw new Error('Push requiere un GitHub token (⚙️ Cuenta → Git).');
    const ref = await this.currentBranch();
    const res = await this.git.push(this._common({ ref, remote: 'origin', onProgress, onMessage }));
    if (res && res.ok === false) throw new Error(res.error || 'Push rechazado');
    return ref;
  }

  async log(depth = 10) {
    this._assertIdb();
    return await this.git.log({ fs: this.fsm.lfs, dir: this.fsm.dir, depth });
  }
}
