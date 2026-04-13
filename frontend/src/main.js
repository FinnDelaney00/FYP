/**
 * File purpose:
 * Bootstraps authentication, browser-route navigation, workspace lifecycle,
 * user/company context, and the dedicated settings experience.
 */
import { initAnomaliesData } from "./anomaliesData.js";
import { initInsightsData } from "./insightsData.js";
import { startLiveUpdates } from "./liveUpdates.js";
import {
  authenticate,
  getSessionState,
  getStoredToken,
  logoutSession,
  restoreSession,
  subscribeSession,
  syncSessionFromServer
} from "./services/authService.js";
import { createPreferencesStore } from "./preferences/preferencesManager.js";
import { getPathForPage, getRouteByPageName, resolveRoute } from "./routes.js";
import { createSettingsPage } from "./settings/settingsPage.js";

const loginView = document.getElementById("login-view");
const workspaceView = document.getElementById("workspace-view");
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const authTitle = document.getElementById("auth-title");
const authSubtitle = document.getElementById("auth-subtitle");
const authSubmitBtn = document.getElementById("auth-submit-btn");
const authToggleBtn = document.getElementById("auth-toggle-btn");
const signupNameGroup = document.getElementById("signup-name-group");
const signupInviteGroup = document.getElementById("signup-invite-group");
const displayNameInput = document.getElementById("display-name");
const inviteCodeInput = document.getElementById("invite-code");
const emailInput = document.getElementById("email");
const sidebar = document.getElementById("sidebar");
const sidebarToggle = document.getElementById("sidebar-toggle");
const logoutButton = document.getElementById("logout-btn");
const pageTitle = document.getElementById("page-title");
const pageSubtitle = document.getElementById("page-subtitle");
const liveStatusPill = document.getElementById("live-status-pill");
const liveFeedMeta = document.getElementById("live-feed-meta");
const liveFeedChart = document.getElementById("live-feed-chart");
const workspaceCompanyChip = document.getElementById("workspace-company-chip");
const sidebarUserName = document.getElementById("sidebar-user-name");
const sidebarUserMeta = document.getElementById("sidebar-user-meta");
const settingsPageRoot = document.getElementById("settings-page-root");

const navLinks = Array.from(document.querySelectorAll(".nav-link"));
const pages = Array.from(document.querySelectorAll(".page"));

const preferencesStore = createPreferencesStore();

let isSignupMode = false;
let pendingProtectedPage = null;
let stopLiveUpdates = null;
let stopInsights = null;
let stopAnomalies = null;
let workspaceDataStarted = false;

const settingsPage = createSettingsPage({
  rootElement: settingsPageRoot,
  preferencesStore,
  getSessionState,
  syncSessionFromServer,
  getAuthToken: getStoredToken
});

/**
 * Shows the authenticated workspace shell and hides the login screen.
 */
function openWorkspace() {
  loginView.classList.remove("view-active");
  workspaceView.classList.add("view-active");
}

/**
 * Returns the user to the login view and closes the mobile sidebar.
 */
function openLogin() {
  workspaceView.classList.remove("view-active");
  loginView.classList.add("view-active");
  sidebar.classList.remove("open");
}

/**
 * Stops every active poller or feature controller tied to authenticated data.
 */
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
  workspaceDataStarted = false;
}

/**
 * Starts the dashboard, anomaly, and live-update controllers once per session.
 */
function startWorkspaceData() {
  if (workspaceDataStarted) {
    return;
  }

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
  workspaceDataStarted = true;
}

/**
 * Toggles the login form between sign-in and invite-based signup modes.
 *
 * @param {boolean} signupMode
 */
function setAuthMode(signupMode) {
  isSignupMode = signupMode;
  loginError.textContent = "";
  signupNameGroup.classList.toggle("is-hidden", !signupMode);
  signupInviteGroup.classList.toggle("is-hidden", !signupMode);

  if (signupMode) {
    authTitle.textContent = "Create account";
    authSubtitle.textContent = "Create your SmartStream account with an invite code.";
    authSubmitBtn.textContent = "Create Account";
    authToggleBtn.textContent = "Already have an account? Sign in";
    displayNameInput.setAttribute("required", "required");
    inviteCodeInput.setAttribute("required", "required");
  } else {
    authTitle.textContent = "Sign in";
    authSubtitle.textContent = "Access clear spending and workforce insights in one workspace.";
    authSubmitBtn.textContent = "Sign In";
    authToggleBtn.textContent = "Need an account? Create one";
    displayNameInput.removeAttribute("required");
    displayNameInput.value = "";
    inviteCodeInput.removeAttribute("required");
    inviteCodeInput.value = "";
  }
}

/**
 * Converts backend role identifiers into user-friendly labels.
 *
 * @param {string} role
 * @returns {string}
 */
function humanizeRole(role) {
  const normalized = String(role || "").trim().replaceAll("_", " ");
  return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : "Member";
}

/**
 * Mirrors the current session identity into the sidebar and topbar summary UI.
 *
 * @param {Record<string, any>} sessionState
 */
function updateWorkspaceIdentity(sessionState) {
  if (sessionState.status !== "authenticated") {
    if (workspaceCompanyChip) {
      workspaceCompanyChip.textContent = "Secure workspace";
    }
    if (sidebarUserName) {
      sidebarUserName.textContent = "SmartStream";
    }
    if (sidebarUserMeta) {
      sidebarUserMeta.textContent = "Business Insights";
    }
    return;
  }

  const companyName = sessionState.company?.name || "Company workspace";
  const companyId = sessionState.company?.id || sessionState.user?.companyId || "company";
  const role = humanizeRole(sessionState.user?.role);

  if (workspaceCompanyChip) {
    workspaceCompanyChip.textContent = `${companyName} | ${role}`;
  }
  if (sidebarUserName) {
    sidebarUserName.textContent = sessionState.user?.name || "SmartStream user";
  }
  if (sidebarUserMeta) {
    sidebarUserMeta.textContent = `${sessionState.user?.email || "No email"} | ${companyId}`;
  }
}

/**
 * Activates the requested page, updates nav state, and syncs route copy.
 *
 * @param {string} pageName
 */
function setActivePage(pageName) {
  const route = getRouteByPageName(pageName);

  navLinks.forEach((link) => {
    const isSelected = link.dataset.pageTarget === pageName;
    link.classList.toggle("is-active", isSelected);
    link.setAttribute("aria-current", isSelected ? "page" : "false");
  });

  pages.forEach((page) => {
    const isSelected = page.dataset.page === pageName;
    page.classList.toggle("page-active", isSelected);
  });

  if (pageTitle) {
    pageTitle.textContent = route.title;
  }
  if (pageSubtitle) {
    pageSubtitle.textContent = route.subtitle;
  }

  if (pageName === "settings") {
    settingsPage.render();
    settingsPage.syncPageContext();
  }

  if (window.innerWidth <= 980) {
    sidebar.classList.remove("open");
  }
}

/**
 * Pushes or replaces history state for a named page, then re-syncs the shell.
 *
 * @param {string} pageName
 * @param {{ replace?: boolean }} [options={}]
 */
function navigateToPage(pageName, { replace = false } = {}) {
  const path = getPathForPage(pageName);
  const method = replace ? "replaceState" : "pushState";
  window.history[method]({}, "", path);
  syncViewToRoute();
}

/**
 * Convenience wrapper for navigating to the public login route.
 *
 * @param {{ replace?: boolean }} [options={}]
 */
function navigateToLogin({ replace = false } = {}) {
  navigateToPage("login", { replace });
}

/**
 * Decides which route an authenticated user should actually land on.
 *
 * @param {ReturnType<typeof resolveRoute>} route
 * @returns {string}
 */
function resolveAuthenticatedLanding(route) {
  if (route.pageName === "login") {
    return pendingProtectedPage || preferencesStore.getState().landingPage || "dashboard";
  }
  if (route.isRootAlias) {
    return preferencesStore.getState().landingPage || "dashboard";
  }
  return route.pageName;
}

/**
 * Aligns the visible shell state with both browser navigation and auth state.
 */
function syncViewToRoute() {
  const route = resolveRoute(window.location.pathname);
  const sessionState = getSessionState();
  const isAuthenticated = sessionState.status === "authenticated";

  if (!isAuthenticated) {
    if (route.authRequired) {
      pendingProtectedPage = route.pageName;
      const loginPath = getPathForPage("login");
      if (window.location.pathname !== loginPath) {
        window.history.replaceState({}, "", loginPath);
      }
    }
    openLogin();
    return;
  }

  openWorkspace();

  if (route.isUnknown) {
    window.history.replaceState({}, "", getPathForPage("dashboard"));
    setActivePage("dashboard");
    return;
  }

  const nextPage = resolveAuthenticatedLanding(route);
  pendingProtectedPage = null;

  if (nextPage !== route.pageName || route.isRootAlias) {
    const nextPath = getPathForPage(nextPage);
    if (window.location.pathname !== nextPath) {
      window.history.replaceState({}, "", nextPath);
    }
  }

  setActivePage(nextPage);
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(loginForm);
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "").trim();
  const displayName = String(formData.get("display_name") || "").trim();
  const inviteCode = String(formData.get("invite_code") || "").trim();

  if (!email || !password) {
    loginError.textContent = "Please enter both email and password.";
    return;
  }
  if (isSignupMode && !displayName) {
    loginError.textContent = "Please provide a display name.";
    return;
  }
  if (isSignupMode && !inviteCode) {
    loginError.textContent = "Please provide your invite code.";
    return;
  }

  try {
    loginError.textContent = "";
    authSubmitBtn.disabled = true;
    await authenticate({
      signupMode: isSignupMode,
      email,
      password,
      displayName,
      inviteCode
    });
    startWorkspaceData();
    navigateToPage(pendingProtectedPage || preferencesStore.getState().landingPage || "dashboard", {
      replace: true
    });
  } catch (error) {
    loginError.textContent = error.message || "Authentication failed.";
  } finally {
    authSubmitBtn.disabled = false;
  }
});

navLinks.forEach((link) => {
  link.addEventListener("click", () => {
    const pageName = link.dataset.pageTarget;
    if (pageName) {
      navigateToPage(pageName);
    }
  });
});

logoutButton.addEventListener("click", () => {
  stopWorkspaceData();
  logoutSession();
  loginForm.reset();
  setAuthMode(false);
  navigateToLogin({ replace: true });
});

sidebarToggle.addEventListener("click", () => {
  sidebar.classList.toggle("open");
});

window.addEventListener("resize", () => {
  if (window.innerWidth > 980) {
    sidebar.classList.remove("open");
  }
});

window.addEventListener("popstate", () => {
  syncViewToRoute();
});

authToggleBtn.addEventListener("click", () => {
  setAuthMode(!isSignupMode);
});

subscribeSession((sessionState) => {
  updateWorkspaceIdentity(sessionState);
  if (sessionState.status === "authenticated") {
    settingsPage.render();
    settingsPage.syncPageContext();
  }
});

setAuthMode(false);

restoreSession().then((sessionState) => {
  if (sessionState.status === "authenticated") {
    startWorkspaceData();
    syncViewToRoute();
    return;
  }

  openLogin();
  emailInput.focus();
  syncViewToRoute();
});
