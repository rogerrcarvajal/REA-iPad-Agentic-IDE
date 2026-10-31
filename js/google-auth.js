/**
 * Google Sign-In (RF3) using Google Identity Services (OAuth 2.0 token model).
 *
 * The returned access token is used to call the Gemini API (Generative Language API)
 * on behalf of the signed-in user, billed/quota'd to the user's own Google Cloud project
 * (`googleProjectId`, sent as x-goog-user-project).
 *
 * Requirements (Google policy, not a limitation of this IDE):
 *   - An OAuth 2.0 "Web application" Client ID created in the user's Google Cloud project,
 *     with this IDE's origin registered as an Authorized JavaScript origin.
 *   - The page must be a secure context: https://… or http://localhost.
 */
import { Settings } from './settings.js';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/generative-language.retriever'
].join(' ');
const SESSION_KEY = 'rea-ide-google-session';

let gisPromise = null;
const listeners = new Set();

function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (!gisPromise) {
    gisPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = GIS_SRC;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('No se pudo cargar Google Identity Services (¿sin conexión?).'));
      document.head.appendChild(s);
    });
  }
  return gisPromise;
}

function readSession() {
  try {
    const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    if (s && s.expiresAt > Date.now() + 60_000) return s;
  } catch {
    /* ignore */
  }
  return null;
}

export const GoogleAuth = {
  session: readSession(),

  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  _emit() {
    listeners.forEach((fn) => fn(this.session));
  },

  isSignedIn() {
    if (this.session && this.session.expiresAt <= Date.now() + 60_000) {
      this.session = null;
      sessionStorage.removeItem(SESSION_KEY);
      this._emit();
    }
    return !!this.session;
  },

  accessToken() {
    return this.isSignedIn() ? this.session.accessToken : null;
  },

  /** Returns a human-readable reason why sign-in cannot work here, or null if it can. */
  preflightProblem() {
    if (!window.isSecureContext) {
      return `Google solo permite iniciar sesión desde un origen seguro (https:// o http://localhost). ` +
        `Estás en ${location.origin}. Sirve el IDE por HTTPS (ver Docs/05-Guia-Despliegue-iPadOS.md) ` +
        `o usa una API key de Google AI Studio.`;
    }
    if (!Settings.get('googleClientId')) {
      return 'Falta el OAuth Client ID (Google Cloud Console → APIs y servicios → Credenciales → ID de cliente OAuth, tipo "Aplicación web").';
    }
    if (!Settings.get('googleProjectId')) {
      return 'Falta el ID del proyecto de Google Cloud (para cuota/facturación de la API de Gemini).';
    }
    return null;
  },

  async signIn() {
    const problem = this.preflightProblem();
    if (problem) throw new Error(problem);
    await loadGis();

    const tokenResponse = await new Promise((resolve, reject) => {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: Settings.get('googleClientId'),
        scope: SCOPES,
        prompt: '',
        callback: (resp) => (resp.error ? reject(new Error(resp.error_description || resp.error)) : resolve(resp)),
        error_callback: (err) => reject(new Error(err?.message || err?.type || 'Inicio de sesión cancelado'))
      });
      client.requestAccessToken();
    });

    let profile = {};
    try {
      const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${tokenResponse.access_token}` }
      });
      if (r.ok) profile = await r.json();
    } catch {
      /* profile is optional */
    }

    this.session = {
      accessToken: tokenResponse.access_token,
      expiresAt: Date.now() + Number(tokenResponse.expires_in || 3600) * 1000,
      email: profile.email || '',
      name: profile.name || profile.email || 'Cuenta Google',
      picture: profile.picture || ''
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(this.session));
    this._emit();
    return this.session;
  },

  signOut() {
    const token = this.session?.accessToken;
    this.session = null;
    sessionStorage.removeItem(SESSION_KEY);
    if (token && window.google?.accounts?.oauth2) {
      window.google.accounts.oauth2.revoke(token, () => {});
    }
    this._emit();
  }
};
