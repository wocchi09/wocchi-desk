"use strict";

(() => {
  const SESSION_KEY = "wocchi-cloud-session-v1";
  const config = window.WOCCHI_CONFIG || {};
  let session = readSession();

  function isConfigured() {
    return /^https:\/\/.+\.supabase\.co\/?$/.test(config.supabaseUrl || "") && Boolean(config.supabaseAnonKey);
  }

  function readSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; }
  }

  function saveSession(value) {
    session = value;
    if (value) localStorage.setItem(SESSION_KEY, JSON.stringify(value)); else localStorage.removeItem(SESSION_KEY);
  }

  function consumeAuthRedirect() {
    const params = new URLSearchParams(location.hash.slice(1));
    const accessToken = params.get("access_token");
    if (!accessToken) return false;
    saveSession({ accessToken, refreshToken: params.get("refresh_token"), expiresAt: Date.now() + Number(params.get("expires_in") || 3600) * 1000 });
    history.replaceState(null, "", `${location.pathname}${location.search}`);
    return true;
  }

  async function request(path, options = {}) {
    if (!isConfigured()) throw new Error("クラウド同期がまだ設定されていません。");
    if (!path.startsWith("/auth/v1/") && session?.refreshToken && session.expiresAt < Date.now() + 60000) await refreshSession();
    const headers = { apikey: config.supabaseAnonKey, "Content-Type": "application/json", ...options.headers };
    if (session?.accessToken) headers.Authorization = `Bearer ${session.accessToken}`;
    const response = await fetch(`${config.supabaseUrl.replace(/\/$/, "")}${path}`, { ...options, headers });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      throw new Error(detail.msg || detail.message || detail.error_description || `通信に失敗しました（${response.status}）`);
    }
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  async function sendMagicLink(email) {
    const redirect = encodeURIComponent(`${location.origin}${location.pathname}`);
    return request(`/auth/v1/otp?redirect_to=${redirect}`, { method: "POST", body: JSON.stringify({ email, create_user: true }) });
  }

  async function refreshSession() {
    const response = await fetch(`${config.supabaseUrl.replace(/\/$/, "")}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: config.supabaseAnonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: session.refreshToken })
    });
    if (!response.ok) { saveSession(null); throw new Error("ログインの有効期限が切れました。もう一度ログインしてください。"); }
    const data = await response.json();
    saveSession({ accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000 });
  }

  async function getUser() {
    if (!session?.accessToken) return null;
    try { return await request("/auth/v1/user"); } catch { saveSession(null); return null; }
  }

  async function sync(localData) {
    const user = await getUser();
    if (!user) throw new Error("クラウドへログインしてください。");
    const rows = await request(`/rest/v1/wocchi_data?user_id=eq.${encodeURIComponent(user.id)}&select=payload,updated_at`, { method: "GET" });
    const remote = rows?.[0];
    const localTime = Date.parse(localData.updatedAt || 0) || 0;
    const remoteTime = Date.parse(remote?.updated_at || 0) || 0;
    if (remote?.payload && remoteTime > localTime) return { direction: "download", data: remote.payload, user };
    const updatedAt = localData.updatedAt || new Date().toISOString();
    await request("/rest/v1/wocchi_data?on_conflict=user_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ user_id: user.id, payload: { ...localData, updatedAt }, updated_at: updatedAt })
    });
    return { direction: "upload", data: { ...localData, updatedAt }, user };
  }

  async function signOut() {
    if (session?.accessToken) await request("/auth/v1/logout", { method: "POST" }).catch(() => null);
    saveSession(null);
  }

  consumeAuthRedirect();
  window.WocchiCloud = Object.freeze({ isConfigured, sendMagicLink, getUser, sync, signOut });
})();
