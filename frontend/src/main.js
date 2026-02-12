const loginView = document.getElementById("login-view");
const workspaceView = document.getElementById("workspace-view");
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const sidebar = document.getElementById("sidebar");
const sidebarToggle = document.getElementById("sidebar-toggle");
const logoutButton = document.getElementById("logout-btn");

const pageTitle = document.getElementById("page-title");
const pageSubtitle = document.getElementById("page-subtitle");
const navLinks = Array.from(document.querySelectorAll(".nav-link"));
const pages = Array.from(document.querySelectorAll(".page"));

const pageMeta = {
  dashboard: {
    title: "Dashboard Overview",
    subtitle: "Real-time analytics and insights for your organization"
  },
  "create-graph": {
    title: "Create Graphs",
    subtitle: "Build custom visualizations for business metrics"
  },
  query: {
    title: "Query Data",
    subtitle: "Run ad-hoc SQL style queries on company datasets"
  },
  anomalies: {
    title: "Anomaly Detection",
    subtitle: "Track unusual patterns and prioritize investigations"
  },
  forecasts: {
    title: "Forecasts",
    subtitle: "Forward-looking revenue and workforce projections"
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

loginForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const formData = new FormData(loginForm);
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "").trim();

  if (!email || !password) {
    loginError.textContent = "Please enter both email and password.";
    return;
  }

  loginError.textContent = "";
  openWorkspace();
  setActivePage("dashboard");
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
  loginForm.reset();
  openLogin();
});

sidebarToggle.addEventListener("click", () => {
  sidebar.classList.toggle("open");
});

window.addEventListener("resize", () => {
  if (window.innerWidth > 980) {
    sidebar.classList.remove("open");
  }
});
