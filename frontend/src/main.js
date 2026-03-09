/**
 * File purpose:
 * Bootstraps frontend display behavior: authentication flow, view/page navigation,
 * session restoration, and startup/cleanup of live data and insights rendering modules.
 */
import { startLiveUpdates } from "./liveUpdates";
import { initInsightsData } from "./insightsData";
import { initAnomaliesData } from "./anomaliesData";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
const AUTH_TOKEN_KEY = "smartstream_auth_token";

const loginView = document.getElementById("login-view");
const workspaceView = document.getElementById("workspace-view");
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const authTitle = document.getElementById("auth-title");
const authSubtitle = document.getElementById("auth-subtitle");
const authSubmitBtn = document.getElementById("auth-submit-btn");
const authToggleBtn = document.getElementById("auth-toggle-btn");
const signupNameGroup = document.getElementById("signup-name-group");
const displayNameInput = document.getElementById("display-name");
const sidebar = document.getElementById("sidebar");
const sidebarToggle = document.getElementById("sidebar-toggle");
const logoutButton = document.getElementById("logout-btn");

const pageTitle = document.getElementById("page-title");
const pageSubtitle = document.getElementById("page-subtitle");
const navLinks = Array.from(document.querySelectorAll(".nav-link"));
const pages = Array.from(document.querySelectorAll(".page"));
const liveStatusPill = document.getElementById("live-status-pill");
const liveFeedMeta = document.getElementById("live-feed-meta");
const liveFeedChart = document.getElementById("live-feed-chart");
const emailInput = document.getElementById("email");

let isSignupMode = false;
let stopLiveUpdates = null;
let stopInsights = null;
let stopAnomalies = null;

const pageMeta = {
  dashboard: {
    title: "Spending Overview",
    subtitle: "A plain-English view of company spend, hiring, and team mix"
  },
  "create-graph": {
    title: "Custom Charts",
    subtitle: "Build a simple view of the business metric you want to track"
  },
  query: {
    title: "Explore Data",
    subtitle: "Look deeper into the raw company data when you need detail"
  },
  anomalies: {
    title: "Alerts",
    subtitle: "Review unusual cost patterns and other items that need attention"
  },
  forecasts: {
    title: "Forecasts",
    subtitle: "Business-ready outlook for future spend, hiring, and planning risk"
  }
};

function openWorkspace() {
  loginView.classList.remove("view-active");
  workspaceView.classList.add("view-active");
}

function openLogin() {
  workspaceView.classList.remove("view-active");
  loginView.classList.add("view-active");
  sidebar.classList.remove("open");
}

function getStoredToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY) || "";
}

function setStoredToken(token) {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
}

function clearStoredToken() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
}

function getAuthHeaders() {
  const token = getStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiRequest(path, options = {}) {
  if (!API_BASE_URL) {
    throw new Error("VITE_API_BASE_URL is not configured.");
  }

  const headers = {
    ...(options.headers || {}),
    ...getAuthHeaders()
  };

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.message || `HTTP ${response.status}`);
  }
  return payload;
}

function stopWorkspaceData() {
  if (typeof stopLiveUpdates === "function") {
    stopLiveUpdates();
    stopLiveUpdates = null;
  }
  if (typeof stopInsights === "function") {
    stopInsights();
    stopInsights = null;
  }
  if (typeof stopAnomalies === "function") {
    stopAnomalies();
    stopAnomalies = null;
  }
}

function startWorkspaceData() {
  stopWorkspaceData();
  stopLiveUpdates = startLiveUpdates({
    chartElement: liveFeedChart,
    metaElement: liveFeedMeta,
    statusElement: liveStatusPill,
    pollIntervalMs: 60000,
    getAuthToken: getStoredToken
  });
  stopInsights = initInsightsData({
    getAuthToken: getStoredToken
  });
  stopAnomalies = initAnomaliesData({
    getAuthToken: getStoredToken
  });
}

function setAuthMode(signupMode) {
  isSignupMode = signupMode;
  loginError.textContent = "";
  signupNameGroup.classList.toggle("is-hidden", !signupMode);

  if (signupMode) {
    authTitle.textContent = "Create account";
    authSubtitle.textContent = "Create your SmartStream account to access live analytics.";
    authSubmitBtn.textContent = "Create Account";
    authToggleBtn.textContent = "Already have an account? Sign in";
    displayNameInput.setAttribute("required", "required");
  } else {
    authTitle.textContent = "Sign in";
    authSubtitle.textContent = "Access clear spending and workforce insights in one workspace.";
    authSubmitBtn.textContent = "Sign In";
    authToggleBtn.textContent = "Need an account? Create one";
    displayNameInput.removeAttribute("required");
    displayNameInput.value = "";
  }
}

async function verifyStoredSession() {
  const token = getStoredToken();
  if (!token) {
    return false;
  }

  try {
    await apiRequest("/auth/me");
    return true;
  } catch {
    clearStoredToken();
    return false;
  }
}

function setActivePage(pageName) {
  navLinks.forEach((link) => {
    const isSelected = link.dataset.pageTarget === pageName;
    link.classList.toggle("is-active", isSelected);
  });

  pages.forEach((page) => {
    const isSelected = page.dataset.page === pageName;
    page.classList.toggle("page-active", isSelected);
  });

  const meta = pageMeta[pageName];
  if (meta) {
    pageTitle.textContent = meta.title;
    pageSubtitle.textContent = meta.subtitle;
  }

  if (window.innerWidth <= 980) {
    sidebar.classList.remove("open");
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(loginForm);
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "").trim();
  const displayName = String(formData.get("display_name") || "").trim();

  if (!email || !password) {
    loginError.textContent = "Please enter both email and password.";
    return;
  }

  if (isSignupMode && !displayName) {
    loginError.textContent = "Please provide a display name.";
    return;
  }

  try {
    loginError.textContent = "";
    authSubmitBtn.disabled = true;
    const payload = await apiRequest(isSignupMode ? "/auth/signup" : "/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email,
        password,
        display_name: displayName
      })
    });

    if (!payload?.token) {
      throw new Error("Authentication succeeded but no token was returned.");
    }

    setStoredToken(payload.token);
    openWorkspace();
    setActivePage("dashboard");
    startWorkspaceData();
  } catch (error) {
    loginError.textContent = error.message;
  } finally {
    authSubmitBtn.disabled = false;
  }
});

navLinks.forEach((link) => {
  link.addEventListener("click", () => {
    const pageName = link.dataset.pageTarget;
    if (pageName) {
      setActivePage(pageName);
    }
  });
});

logoutButton.addEventListener("click", () => {
  stopWorkspaceData();
  clearStoredToken();
  loginForm.reset();
  openLogin();
  setAuthMode(false);
});

sidebarToggle.addEventListener("click", () => {
  sidebar.classList.toggle("open");
});

window.addEventListener("resize", () => {
  if (window.innerWidth > 980) {
    sidebar.classList.remove("open");
  }
});

authToggleBtn.addEventListener("click", () => {
  setAuthMode(!isSignupMode);
});

setAuthMode(false);

verifyStoredSession().then((isValid) => {
  if (isValid) {
    openWorkspace();
    setActivePage("dashboard");
    startWorkspaceData();
    return;
  }

  openLogin();
  emailInput.focus();
});
