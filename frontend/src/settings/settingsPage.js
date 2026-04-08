import { escapeHtml, formatBusinessDateTime } from "../insights/formatters.js";
import { getRouteByPageName } from "../routes.js";
import {
  createPreferencePreview,
  createReadOnlyField,
  createSelectField,
  createSettingsCard,
  createSettingsLayout,
  createSettingsNav,
  createTextField,
  createToggleField
} from "./components.js";
import { createAdminInvite } from "./adminInviteService.js";
import { getProfileUpdateCapability, saveProfileChanges } from "./profileService.js";
import { changePassword, getSecurityCapabilities, signOutAllSessions } from "./securityService.js";

const SETTINGS_SECTIONS = [
  { id: "account", label: "Account", helper: "Name, email, and role" },
  { id: "appearance", label: "Appearance", helper: "Theme, density, start page" },
  { id: "accessibility", label: "Accessibility", helper: "Font size, contrast, motion" },
  { id: "security", label: "Security", helper: "Password and active sessions" },
  { id: "company-access", label: "Company Access", helper: "Tenant and data scope" }
];

const THEME_OPTIONS = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" }
];

const LANDING_PAGE_OPTIONS = [
  { value: "dashboard", label: "Dashboard" },
  { value: "forecasts", label: "Forecasts" },
  { value: "query", label: "Query" }
];

const FONT_SIZE_OPTIONS = [
  { value: "small", label: "Small" },
  { value: "default", label: "Default" },
  { value: "large", label: "Large" }
];

const INVITE_ROLE_OPTIONS = [
  { value: "viewer", label: "Viewer" },
  { value: "member", label: "Member" },
  { value: "analyst", label: "Analyst" },
  { value: "admin", label: "Admin" }
];

const DEFAULT_INVITE_EXPIRY_DAYS = "14";

function humanizeValue(value, fallback = "Not available") {
  const text = String(value || "").trim();
  return text || fallback;
}

function humanizeRole(role) {
  const normalized = String(role || "").trim().replaceAll("_", " ");
  return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : "Member";
}

function humanizeStatus(value) {
  const normalized = String(value || "").trim().replaceAll("_", " ");
  return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : "Status unavailable";
}

function getLandingPageLabel(pageName) {
  return getRouteByPageName(pageName).title.replace("Spending Overview", "Dashboard");
}

function buildSessionSummary(sessionState) {
  const user = sessionState?.user || {};
  const company = sessionState?.company || {};
  return {
    fullName: humanizeValue(user.name, "Not available"),
    email: humanizeValue(user.email),
    role: humanizeRole(user.role),
    companyName: humanizeValue(company.name, "Company not available"),
    companyId: humanizeValue(company.id || user.companyId),
    companyStatus: humanizeStatus(company.status),
    trustedPrefix: humanizeValue(company.trustedPrefix, "Not exposed by auth/me"),
    analyticsPrefix: humanizeValue(company.analyticsPrefix, "Not exposed by auth/me"),
    athenaDatabase: humanizeValue(company.athenaDatabase, "Not exposed by auth/me")
  };
}

function isAdminSession(sessionState) {
  return String(sessionState?.user?.role || "").trim().toLowerCase() === "admin";
}

function formatInviteDateTime(value) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return formatBusinessDateTime(value * 1000);
  }
  return formatBusinessDateTime(value);
}

function createLoadingMarkup() {
  return `
    <section class="settings-loading-grid">
      <article class="panel settings-loading-panel skeleton-block"></article>
      <article class="panel settings-loading-panel skeleton-block"></article>
      <article class="panel settings-loading-panel skeleton-block"></article>
    </section>
  `;
}

function createStatusLine(id, tone, message) {
  return `<p id="${escapeHtml(id)}" class="settings-inline-status ${tone ? `is-${escapeHtml(tone)}` : ""}" role="status" aria-live="polite">${escapeHtml(message || "")}</p>`;
}

export function createSettingsPage({
  rootElement,
  preferencesStore,
  getSessionState,
  syncSessionFromServer,
  getAuthToken
}) {
  const profileCapability = getProfileUpdateCapability();
  const securityCapabilities = getSecurityCapabilities();

  let activeSection = SETTINGS_SECTIONS[0].id;
  let hydratedUserId = "";
  let accountNameDraft = "";
  let accountStatus = {
    tone: "muted",
    message: profileCapability.supported
      ? "Your account details come from your secure session."
      : "Your account details come from your secure session. Name updates need a backend endpoint before they can be saved."
  };
  let securityStatus = {
    tone: "muted",
    message: securityCapabilities.passwordChange || securityCapabilities.revokeSessions
      ? "Security actions are connected for this environment."
      : "Security actions are shown here, but backend endpoints are not yet available in this environment."
  };
  let appearanceStatus = {
    tone: "success",
    message: "Appearance changes save automatically in this browser."
  };
  let accessibilityStatus = {
    tone: "success",
    message: "Accessibility changes save automatically in this browser."
  };
  let passwordFormState = {
    currentPassword: "",
    newPassword: "",
    confirmPassword: ""
  };
  let inviteFormState = {
    role: "member",
    expiresInDays: DEFAULT_INVITE_EXPIRY_DAYS
  };
  let companyAccessStatusOverride = null;
  let lastCreatedInvite = null;
  let isSavingAccount = false;
  let isUpdatingPassword = false;
  let isRevokingSessions = false;
  let isCreatingInvite = false;

  function getAccountDirtyState(sessionSummary) {
    return accountNameDraft.trim() !== sessionSummary.fullName.trim();
  }

  function hydrateDrafts(sessionSummary, force = false) {
    const sessionState = getSessionState();
    const userId = String(sessionState?.user?.id || "");
    if (force || hydratedUserId !== userId) {
      hydratedUserId = userId;
      accountNameDraft = sessionSummary.fullName;
    }
  }

  function getDefaultCompanyAccessStatus(sessionState) {
    return isAdminSession(sessionState)
      ? {
          tone: "muted",
          message: "Generate an invite code here, then email it to the teammate you want to onboard."
        }
      : {
          tone: "muted",
          message: "Invite code creation is limited to admins in this workspace."
        };
  }

  function getCompanyAccessStatus(sessionState) {
    return companyAccessStatusOverride || getDefaultCompanyAccessStatus(sessionState);
  }

  function buildAccountCard(sessionSummary) {
    const accountDirty = getAccountDirtyState(sessionSummary);
    const footer = `
      <div class="settings-card-footer-row">
        ${createStatusLine("settings-account-status", accountStatus.tone, accountStatus.message)}
        <div class="settings-footer-actions">
          <button type="button" class="action login-toggle-btn" data-settings-action="reset-account" ${!accountDirty ? "disabled" : ""}>Reset</button>
          <button type="button" class="action" data-settings-action="save-account" ${isSavingAccount ? "disabled" : ""}>
            ${isSavingAccount ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    `;

    const content = `
      <div class="settings-form-grid">
        ${createTextField({
          id: "settings-full-name",
          label: "Full name",
          value: accountNameDraft,
          description: "This is the name SmartStream shows around the workspace."
        })}
        ${createTextField({
          id: "settings-email",
          label: "Email",
          value: sessionSummary.email,
          description: "Email changes are not available in the current backend.",
          type: "email",
          readOnly: true
        })}
        ${createReadOnlyField({
          label: "Company name",
          value: sessionSummary.companyName,
          description: "Shown from the authenticated server response."
        })}
        ${createReadOnlyField({
          label: "Company ID",
          value: sessionSummary.companyId,
          description: "Useful when confirming you are in the correct tenant."
        })}
        ${createReadOnlyField({
          label: "Role",
          value: sessionSummary.role,
          description: "Access permissions are determined by your current session."
        })}
      </div>
    `;

    return createSettingsCard({
      sectionId: "account",
      title: "Account",
      description: "Review the identity details tied to your current SmartStream account.",
      badge: accountDirty ? "Unsaved changes" : "Secure session",
      content,
      footer
    });
  }

  function buildAppearanceCard(preferences) {
    const content = `
      <div class="settings-form-grid">
        ${createSelectField({
          id: "preference-theme",
          label: "Theme",
          value: preferences.theme,
          options: THEME_OPTIONS,
          description: "Switch between light, dark, or the same theme as your device."
        })}
        ${createSelectField({
          id: "preference-landingPage",
          label: "Default landing page",
          value: preferences.landingPage,
          options: LANDING_PAGE_OPTIONS,
          description: "Choose where SmartStream should open when you enter the workspace root."
        })}
      </div>
      <div class="settings-toggle-stack">
        ${createToggleField({
          id: "preference-compactMode",
          label: "Compact mode",
          description: "Tighten cards, tables, and page spacing for denser layouts.",
          checked: preferences.compactMode
        })}
      </div>
      ${createPreferencePreview()}
    `;

    const footer = `
      <div class="settings-card-footer-row">
        ${createStatusLine("settings-appearance-status", appearanceStatus.tone, appearanceStatus.message)}
        <div class="settings-footer-actions">
          <button type="button" class="action login-toggle-btn" data-settings-action="reset-preferences">Reset to defaults</button>
        </div>
      </div>
    `;

    return createSettingsCard({
      sectionId: "appearance",
      title: "Appearance",
      description: "Set how SmartStream should look when you work across dashboards, tables, and charts.",
      badge: "Auto-saved",
      content,
      footer
    });
  }

  function buildAccessibilityCard(preferences) {
    const content = `
      <div class="settings-form-grid">
        ${createSelectField({
          id: "preference-fontSize",
          label: "Font size",
          value: preferences.fontSize,
          options: FONT_SIZE_OPTIONS,
          description: "Adjust the reading size across labels, cards, and tables."
        })}
      </div>
      <div class="settings-toggle-stack">
        ${createToggleField({
          id: "preference-reducedMotion",
          label: "Reduced motion",
          description: "Limit non-essential animations and transitions across the app.",
          checked: preferences.reducedMotion
        })}
        ${createToggleField({
          id: "preference-highContrast",
          label: "High contrast",
          description: "Increase contrast for cards, labels, charts, and tables.",
          checked: preferences.highContrast
        })}
      </div>
    `;

    const footer = `
      <div class="settings-card-footer-row">
        ${createStatusLine("settings-accessibility-status", accessibilityStatus.tone, accessibilityStatus.message)}
      </div>
    `;

    return createSettingsCard({
      sectionId: "accessibility",
      title: "Accessibility",
      description: "Keep SmartStream comfortable and readable for longer working sessions.",
      badge: "Auto-saved",
      content,
      footer
    });
  }

  function buildSecurityCard() {
    const disablePasswordInputs = !securityCapabilities.passwordChange || isUpdatingPassword;
    const disableSessionAction = !securityCapabilities.revokeSessions || isRevokingSessions;

    const content = `
      <div class="settings-form-grid">
        ${createTextField({
          id: "settings-current-password",
          label: "Current password",
          value: passwordFormState.currentPassword,
          description: securityCapabilities.passwordChange
            ? "Required before SmartStream can set a new password."
            : "Visible for planning, but the backend endpoint is not available yet.",
          type: "password",
          disabled: disablePasswordInputs,
          placeholder: securityCapabilities.passwordChange ? "" : "Coming soon"
        })}
        ${createTextField({
          id: "settings-new-password",
          label: "New password",
          value: passwordFormState.newPassword,
          description: "Use at least 8 characters.",
          type: "password",
          disabled: disablePasswordInputs,
          placeholder: securityCapabilities.passwordChange ? "" : "Coming soon"
        })}
        ${createTextField({
          id: "settings-confirm-password",
          label: "Confirm new password",
          value: passwordFormState.confirmPassword,
          description: "Repeat the new password exactly.",
          type: "password",
          disabled: disablePasswordInputs,
          placeholder: securityCapabilities.passwordChange ? "" : "Coming soon"
        })}
      </div>

      <div class="settings-placeholder-grid">
        <article class="settings-placeholder-card">
          <span class="settings-placeholder-label">Active session summary</span>
          <strong>Current browser session</strong>
          <p>Additional session detail is not exposed by the current backend yet. This card is ready for future session metadata.</p>
        </article>
        <article class="settings-placeholder-card">
          <span class="settings-placeholder-label">Password last updated</span>
          <strong>Not available</strong>
          <p>Show the last password rotation time here once the backend returns it.</p>
        </article>
      </div>
    `;

    const footer = `
      <div class="settings-card-footer-row">
        ${createStatusLine("settings-security-status", securityStatus.tone, securityStatus.message)}
        <div class="settings-footer-actions">
          <button type="button" class="action login-toggle-btn" data-settings-action="sign-out-all-sessions" ${disableSessionAction ? "disabled" : ""}>
            ${isRevokingSessions ? "Signing out..." : "Sign out all sessions"}
          </button>
          <button type="button" class="action" data-settings-action="change-password" ${disablePasswordInputs ? "disabled" : ""}>
            ${isUpdatingPassword ? "Updating..." : "Change password"}
          </button>
        </div>
      </div>
    `;

    return createSettingsCard({
      sectionId: "security",
      title: "Security",
      description: "Protect your workspace access and understand which actions are already supported by the backend.",
      badge: securityCapabilities.passwordChange || securityCapabilities.revokeSessions ? "Connected" : "Placeholders",
      content,
      footer
    });
  }

  function buildCompanyAccessCard(sessionSummary, sessionState) {
    const isAdmin = isAdminSession(sessionState);
    const companyAccessStatus = getCompanyAccessStatus(sessionState);
    const accessSummary = sessionSummary.companyName === "Company not available"
      ? "SmartStream could not read company details from the authenticated response."
      : `You can only access analytics and pipeline data for ${sessionSummary.companyName}.`;

    const inviteSummary = isAdmin
      ? `
        <div class="settings-access-summary">
          <strong>Invite teammates</strong>
          <p>SmartStream does not send invite emails yet. Generate a single-use code here, then share it manually with the teammate you want to onboard.</p>
        </div>

        <div class="settings-form-grid">
          ${createSelectField({
            id: "settings-invite-role",
            label: "Invite role",
            value: inviteFormState.role,
            options: INVITE_ROLE_OPTIONS,
            description: "Choose the starting permissions for the new account."
          })}
          ${createTextField({
            id: "settings-invite-expiry-days",
            label: "Expires after (days)",
            value: inviteFormState.expiresInDays,
            description: "Invite codes can be valid for 1 to 90 days.",
            type: "number",
            inputAttributes: 'min="1" max="90" step="1" inputmode="numeric"'
          })}
          ${createTextField({
            id: "settings-generated-invite-code",
            label: "Latest invite code",
            value: lastCreatedInvite?.inviteCode || "",
            description: lastCreatedInvite
              ? "Copy this code into the email or message you send to the new teammate."
              : "Generate an invite to reveal the code you should send to the new teammate.",
            placeholder: "Generate an invite code",
            readOnly: true,
            inputAttributes: 'spellcheck="false" autocapitalize="characters"'
          })}
          ${createReadOnlyField({
            label: "Latest invite details",
            value: lastCreatedInvite
              ? `${humanizeRole(lastCreatedInvite.role)} | Expires ${formatInviteDateTime(lastCreatedInvite.expiresAt)}`
              : "No invite generated in this session",
            description: lastCreatedInvite
              ? `Created ${formatInviteDateTime(lastCreatedInvite.createdAt)} for ${lastCreatedInvite.companyId || sessionSummary.companyId}.`
              : "Generated codes are tied to your current company and can only be used once."
          })}
        </div>
      `
      : `
        <div class="settings-access-summary">
          <strong>Invite teammates</strong>
          <p>Ask a workspace admin to generate an invite code for any new teammate who needs to sign up.</p>
        </div>
      `;

    const content = `
      <div class="settings-access-grid">
        ${createReadOnlyField({
          label: "Company name",
          value: sessionSummary.companyName,
          description: "This value comes from the authenticated backend response."
        })}
        ${createReadOnlyField({
          label: "Company ID",
          value: sessionSummary.companyId,
          description: "Tenant isolation is tied to this server-controlled identifier."
        })}
        ${createReadOnlyField({
          label: "Role",
          value: sessionSummary.role,
          description: "Role-based permissions are enforced from your secure session."
        })}
        ${createReadOnlyField({
          label: "Company status",
          value: sessionSummary.companyStatus,
          description: "Active companies can access live SmartStream data."
        })}
      </div>

      <div class="settings-access-summary">
        <strong>Access summary</strong>
        <p>${escapeHtml(accessSummary)}</p>
      </div>

      <div class="settings-access-list">
        <div class="settings-access-item">
          <span>Trusted data prefix</span>
          <strong>${escapeHtml(sessionSummary.trustedPrefix)}</strong>
        </div>
        <div class="settings-access-item">
          <span>Analytics prefix</span>
          <strong>${escapeHtml(sessionSummary.analyticsPrefix)}</strong>
        </div>
        <div class="settings-access-item">
          <span>Athena database</span>
          <strong>${escapeHtml(sessionSummary.athenaDatabase)}</strong>
        </div>
      </div>

      ${inviteSummary}
    `;

    const footer = `
      <div class="settings-card-footer-row">
        ${createStatusLine("settings-company-access-status", companyAccessStatus.tone, companyAccessStatus.message)}
        ${isAdmin
          ? `
            <div class="settings-footer-actions">
              <button type="button" class="action" data-settings-action="create-invite" ${isCreatingInvite ? "disabled" : ""}>
                ${isCreatingInvite ? "Generating..." : "Generate invite code"}
              </button>
            </div>
          `
          : ""}
      </div>
    `;

    return createSettingsCard({
      sectionId: "company-access",
      title: "Company Access",
      description: "Confirm that you are inside the correct tenant and review the workspace scope being enforced.",
      badge: isAdmin ? "Admin tools" : "Server authority",
      content,
      footer
    });
  }

  function render() {
    if (!rootElement) {
      return;
    }

    const sessionState = getSessionState();
    if (sessionState.status === "loading") {
      rootElement.innerHTML = createLoadingMarkup();
      return;
    }

    if (sessionState.status !== "authenticated") {
      rootElement.innerHTML = "";
      return;
    }

    const preferences = preferencesStore.getState();
    const sessionSummary = buildSessionSummary(sessionState);
    hydrateDrafts(sessionSummary);

    rootElement.innerHTML = createSettingsLayout({
      companyName: sessionSummary.companyName,
      companyId: sessionSummary.companyId,
      navHtml: createSettingsNav({
        sections: SETTINGS_SECTIONS,
        activeSection
      }),
      contentHtml: [
        buildAccountCard(sessionSummary),
        buildAppearanceCard(preferences),
        buildAccessibilityCard(preferences),
        buildSecurityCard(),
        buildCompanyAccessCard(sessionSummary, sessionState)
      ].join("")
    });

    syncPreferenceControls();
  }

  function updateInlineStatus(id, tone, message) {
    const element = rootElement?.querySelector(`#${id}`);
    if (!element) {
      return;
    }

    element.className = `settings-inline-status ${tone ? `is-${tone}` : ""}`.trim();
    element.textContent = message;
  }

  function syncPreferenceControls() {
    const preferences = preferencesStore.getState();
    const themeSelect = rootElement?.querySelector("#preference-theme");
    const landingSelect = rootElement?.querySelector("#preference-landingPage");
    const fontSizeSelect = rootElement?.querySelector("#preference-fontSize");
    const compactToggle = rootElement?.querySelector("#preference-compactMode");
    const reducedMotionToggle = rootElement?.querySelector("#preference-reducedMotion");
    const highContrastToggle = rootElement?.querySelector("#preference-highContrast");
    const previewTheme = rootElement?.querySelector("#settings-preview-theme-label");
    const previewDensity = rootElement?.querySelector("#settings-preview-density-label");
    const previewAccessibility = rootElement?.querySelector("#settings-preview-accessibility-label");

    if (themeSelect) {
      themeSelect.value = preferences.theme;
    }
    if (landingSelect) {
      landingSelect.value = preferences.landingPage;
    }
    if (fontSizeSelect) {
      fontSizeSelect.value = preferences.fontSize;
    }
    if (compactToggle) {
      compactToggle.checked = preferences.compactMode;
    }
    if (reducedMotionToggle) {
      reducedMotionToggle.checked = preferences.reducedMotion;
    }
    if (highContrastToggle) {
      highContrastToggle.checked = preferences.highContrast;
    }

    if (previewTheme) {
      previewTheme.textContent = `Theme: ${THEME_OPTIONS.find((option) => option.value === preferences.theme)?.label || "System"}`;
    }
    if (previewDensity) {
      previewDensity.textContent = preferences.compactMode
        ? "Compact spacing for denser data review."
        : "Comfortable spacing for guided business reading.";
    }
    if (previewAccessibility) {
      previewAccessibility.textContent = [
        FONT_SIZE_OPTIONS.find((option) => option.value === preferences.fontSize)?.label || "Default",
        preferences.highContrast ? "high contrast" : "standard contrast",
        preferences.reducedMotion ? "reduced motion" : "standard motion"
      ].join(" | ");
    }
  }

  async function handleAccountSave() {
    const sessionSummary = buildSessionSummary(getSessionState());
    const nextName = accountNameDraft.trim();

    if (!nextName) {
      accountStatus = {
        tone: "error",
        message: "Please enter your full name before saving."
      };
      updateInlineStatus("settings-account-status", accountStatus.tone, accountStatus.message);
      return;
    }

    if (!getAccountDirtyState(sessionSummary)) {
      accountStatus = {
        tone: "muted",
        message: "There are no account changes to save."
      };
      updateInlineStatus("settings-account-status", accountStatus.tone, accountStatus.message);
      return;
    }

    isSavingAccount = true;
    render();

    try {
      const result = await saveProfileChanges({ fullName: nextName }, getAuthToken);
      if (!result.supported) {
        accountStatus = {
          tone: "warning",
          message: result.message
        };
        return;
      }

      await syncSessionFromServer();
      accountStatus = {
        tone: "success",
        message: result.message
      };
    } catch (error) {
      accountStatus = {
        tone: "error",
        message: error.message || "Profile changes could not be saved."
      };
    } finally {
      isSavingAccount = false;
      render();
    }
  }

  async function handleChangePassword() {
    const { currentPassword, newPassword, confirmPassword } = passwordFormState;

    if (!currentPassword || !newPassword || !confirmPassword) {
      securityStatus = {
        tone: "error",
        message: "Please complete all password fields."
      };
      updateInlineStatus("settings-security-status", securityStatus.tone, securityStatus.message);
      return;
    }

    if (newPassword.length < 8) {
      securityStatus = {
        tone: "error",
        message: "New password must be at least 8 characters long."
      };
      updateInlineStatus("settings-security-status", securityStatus.tone, securityStatus.message);
      return;
    }

    if (newPassword !== confirmPassword) {
      securityStatus = {
        tone: "error",
        message: "New password and confirmation do not match."
      };
      updateInlineStatus("settings-security-status", securityStatus.tone, securityStatus.message);
      return;
    }

    isUpdatingPassword = true;
    render();

    try {
      const result = await changePassword(passwordFormState, getAuthToken);
      securityStatus = {
        tone: result.supported ? "success" : "warning",
        message: result.message
      };

      if (result.supported) {
        passwordFormState = {
          currentPassword: "",
          newPassword: "",
          confirmPassword: ""
        };
      }
    } catch (error) {
      securityStatus = {
        tone: "error",
        message: error.message || "Password update failed."
      };
    } finally {
      isUpdatingPassword = false;
      render();
    }
  }

  async function handleSignOutAllSessions() {
    isRevokingSessions = true;
    render();

    try {
      const result = await signOutAllSessions(getAuthToken);
      securityStatus = {
        tone: result.supported ? "success" : "warning",
        message: result.message
      };
    } catch (error) {
      securityStatus = {
        tone: "error",
        message: error.message || "Session sign-out failed."
      };
    } finally {
      isRevokingSessions = false;
      render();
    }
  }

  async function handleCreateInvite() {
    const sessionState = getSessionState();
    if (!isAdminSession(sessionState)) {
      companyAccessStatusOverride = {
        tone: "error",
        message: "Only admins can generate invite codes."
      };
      updateInlineStatus("settings-company-access-status", companyAccessStatusOverride.tone, companyAccessStatusOverride.message);
      return;
    }

    const expiresInDays = Number.parseInt(String(inviteFormState.expiresInDays || "").trim(), 10);
    if (!Number.isFinite(expiresInDays) || expiresInDays < 1 || expiresInDays > 90) {
      companyAccessStatusOverride = {
        tone: "error",
        message: "Choose an invite expiry between 1 and 90 days."
      };
      updateInlineStatus("settings-company-access-status", companyAccessStatusOverride.tone, companyAccessStatusOverride.message);
      return;
    }

    isCreatingInvite = true;
    render();

    try {
      const result = await createAdminInvite(
        {
          role: inviteFormState.role,
          expiresInDays
        },
        getAuthToken
      );
      lastCreatedInvite = result.invite;
      companyAccessStatusOverride = {
        tone: "success",
        message: `Invite ready for a ${humanizeRole(result.invite.role)} account. Send it before ${formatInviteDateTime(result.invite.expiresAt)}.`
      };
    } catch (error) {
      companyAccessStatusOverride = {
        tone: "error",
        message: error.message || "Invite code could not be generated."
      };
    } finally {
      isCreatingInvite = false;
      render();
    }
  }

  function updatePreferenceFromControl(control) {
    if (!control) {
      return;
    }

    if (control.id === "preference-theme") {
      preferencesStore.update({ theme: control.value });
      appearanceStatus = {
        tone: "success",
        message: "Theme updated for this browser."
      };
      updateInlineStatus("settings-appearance-status", appearanceStatus.tone, appearanceStatus.message);
      syncPreferenceControls();
      return;
    }

    if (control.id === "preference-landingPage") {
      preferencesStore.update({ landingPage: control.value });
      appearanceStatus = {
        tone: "success",
        message: `Default landing page set to ${getLandingPageLabel(control.value)}.`
      };
      updateInlineStatus("settings-appearance-status", appearanceStatus.tone, appearanceStatus.message);
      syncPreferenceControls();
      return;
    }

    if (control.id === "preference-fontSize") {
      preferencesStore.update({ fontSize: control.value });
      accessibilityStatus = {
        tone: "success",
        message: "Font size updated for this browser."
      };
      updateInlineStatus("settings-accessibility-status", accessibilityStatus.tone, accessibilityStatus.message);
      syncPreferenceControls();
      return;
    }

    if (control.id === "preference-compactMode") {
      preferencesStore.update({ compactMode: control.checked });
      appearanceStatus = {
        tone: "success",
        message: control.checked ? "Compact mode enabled." : "Compact mode disabled."
      };
      updateInlineStatus("settings-appearance-status", appearanceStatus.tone, appearanceStatus.message);
      syncPreferenceControls();
      return;
    }

    if (control.id === "preference-reducedMotion") {
      preferencesStore.update({ reducedMotion: control.checked });
      accessibilityStatus = {
        tone: "success",
        message: control.checked ? "Reduced motion enabled." : "Reduced motion disabled."
      };
      updateInlineStatus("settings-accessibility-status", accessibilityStatus.tone, accessibilityStatus.message);
      syncPreferenceControls();
      return;
    }

    if (control.id === "preference-highContrast") {
      preferencesStore.update({ highContrast: control.checked });
      accessibilityStatus = {
        tone: "success",
        message: control.checked ? "High contrast enabled." : "High contrast disabled."
      };
      updateInlineStatus("settings-accessibility-status", accessibilityStatus.tone, accessibilityStatus.message);
      syncPreferenceControls();
    }
  }

  function resetPreferences() {
    preferencesStore.reset();
    appearanceStatus = {
      tone: "success",
      message: "Appearance settings reset to their defaults."
    };
    accessibilityStatus = {
      tone: "success",
      message: "Accessibility settings reset to their defaults."
    };
    render();
  }

  function focusSection(sectionId) {
    const section = rootElement?.querySelector(`#settings-section-${sectionId}`);
    if (!section) {
      return;
    }

    activeSection = sectionId;
    rootElement.querySelectorAll("[data-settings-section]").forEach((button) => {
      const isActive = button.getAttribute("data-settings-section") === sectionId;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-current", isActive ? "true" : "false");
    });

    section.scrollIntoView({
      behavior: document.documentElement.dataset.reducedMotion === "true" ? "auto" : "smooth",
      block: "start"
    });
    section.focus({ preventScroll: true });
  }

  rootElement?.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }

    const sectionButton = event.target.closest("[data-settings-section]");
    if (sectionButton) {
      focusSection(sectionButton.getAttribute("data-settings-section") || SETTINGS_SECTIONS[0].id);
      return;
    }

    const actionButton = event.target.closest("[data-settings-action]");
    if (!actionButton) {
      return;
    }

    const action = actionButton.getAttribute("data-settings-action");
    if (action === "save-account") {
      void handleAccountSave();
      return;
    }

    if (action === "reset-account") {
      const sessionSummary = buildSessionSummary(getSessionState());
      accountNameDraft = sessionSummary.fullName;
      accountStatus = {
        tone: "muted",
        message: "Name reset to the latest value from your secure session."
      };
      render();
      return;
    }

    if (action === "change-password") {
      void handleChangePassword();
      return;
    }

    if (action === "sign-out-all-sessions") {
      void handleSignOutAllSessions();
      return;
    }

    if (action === "create-invite") {
      void handleCreateInvite();
      return;
    }

    if (action === "reset-preferences") {
      resetPreferences();
    }
  });

  rootElement?.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    if (target.id === "settings-full-name") {
      const sessionSummary = buildSessionSummary(getSessionState());
      accountNameDraft = target.value;
      accountStatus = {
        tone: getAccountDirtyState(sessionSummary) ? "warning" : "muted",
        message: getAccountDirtyState(sessionSummary)
          ? "You have unsaved profile changes."
          : "Your account details come from your secure session."
      };
      updateInlineStatus("settings-account-status", accountStatus.tone, accountStatus.message);
      return;
    }

    if (target.id === "settings-current-password") {
      passwordFormState.currentPassword = target.value;
      return;
    }
    if (target.id === "settings-new-password") {
      passwordFormState.newPassword = target.value;
      return;
    }
    if (target.id === "settings-confirm-password") {
      passwordFormState.confirmPassword = target.value;
      return;
    }

    if (target.id === "settings-invite-expiry-days") {
      inviteFormState.expiresInDays = target.value;
      companyAccessStatusOverride = null;
      const status = getCompanyAccessStatus(getSessionState());
      updateInlineStatus("settings-company-access-status", status.tone, status.message);
    }
  });

  rootElement?.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement || target instanceof HTMLInputElement)) {
      return;
    }

    if (target.id.startsWith("preference-")) {
      updatePreferenceFromControl(target);
      return;
    }

    if (target.id === "settings-invite-role") {
      inviteFormState.role = target.value;
      companyAccessStatusOverride = null;
      const status = getCompanyAccessStatus(getSessionState());
      updateInlineStatus("settings-company-access-status", status.tone, status.message);
    }
  });

  preferencesStore.subscribe(() => {
    syncPreferenceControls();
  });

  return {
    render,
    syncPageContext() {
      const sessionState = getSessionState();
      if (sessionState.status !== "authenticated") {
        return;
      }

      const sessionSummary = buildSessionSummary(sessionState);
      const accessSummary = rootElement?.querySelector(".settings-access-summary p");
      const trustTitle = rootElement?.querySelector(".settings-page-trust strong");
      const trustBody = rootElement?.querySelector(".settings-page-trust p");
      const placeholderCards = rootElement?.querySelectorAll(".settings-placeholder-card strong");

      if (trustTitle) {
        trustTitle.textContent = sessionSummary.companyName;
      }
      if (trustBody) {
        trustBody.textContent = sessionSummary.companyId;
      }
      if (accessSummary) {
        accessSummary.textContent = `You can only access analytics and pipeline data for ${sessionSummary.companyName}.`;
      }
      if (placeholderCards?.[1]) {
        placeholderCards[1].textContent = sessionState?.raw?.user?.updated_at
          ? formatBusinessDateTime(sessionState.raw.user.updated_at)
          : "Not available";
      }
    }
  };
}
