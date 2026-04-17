/**
 * The app's route list and page labels.
 */
const routeDefinitions = [
  {
    pageName: "dashboard",
    path: "/dashboard",
    aliases: ["/"],
    authRequired: true,
    title: "Spending Overview",
    subtitle: "A plain-English view of company spend, hiring, and team mix"
  },
  {
    pageName: "create-graph",
    path: "/charts",
    aliases: ["/create-graph"],
    authRequired: true,
    title: "Custom Charts",
    subtitle: "Build a simple view of the business metric you want to track"
  },
  {
    pageName: "query",
    path: "/query",
    aliases: [],
    authRequired: true,
    title: "Explore Data",
    subtitle: "Look deeper into the raw company data when you need detail"
  },
  {
    pageName: "anomalies",
    path: "/alerts",
    aliases: ["/anomalies"],
    authRequired: true,
    title: "Alerts",
    subtitle: "Review unusual cost patterns and other items that need attention"
  },
  {
    pageName: "forecasts",
    path: "/forecasts",
    aliases: [],
    authRequired: true,
    title: "Forecasts",
    subtitle: "Business-ready outlook for future spend, hiring, and planning risk"
  },
  {
    pageName: "settings",
    path: "/settings",
    aliases: [],
    authRequired: true,
    title: "Settings",
    subtitle: "Manage your account details, company context, and workspace preferences"
  },
  {
    pageName: "login",
    path: "/login",
    aliases: [],
    authRequired: false,
    title: "Sign in",
    subtitle: "Access clear spending and workforce insights in one workspace."
  }
];

/**
 * Cleans up a browser path so matching is more forgiving.
 *
 * @param {string} pathname
 * @returns {string}
 */
function normalizePath(pathname) {
  const raw = String(pathname || "/").trim();
  if (!raw || raw === "/") {
    return "/";
  }
  const cleaned = raw.replace(/\/+$/, "");
  return cleaned.startsWith("/") ? cleaned.toLowerCase() : `/${cleaned.toLowerCase()}`;
}

/**
 * Finds a route by its page name.
 *
 * @param {string} pageName
 * @returns {typeof routeDefinitions[number]}
 */
export function getRouteByPageName(pageName) {
  return routeDefinitions.find((route) => route.pageName === pageName) || routeDefinitions[0];
}

/**
 * Turns a browser path into the route details the app uses.
 *
 * @param {string} pathname
 * @returns {typeof routeDefinitions[number] & { normalizedPath: string, isRootAlias?: boolean, isUnknown?: boolean }}
 */
export function resolveRoute(pathname) {
  const normalizedPath = normalizePath(pathname);
  const matchedRoute = routeDefinitions.find((route) =>
    route.path === normalizedPath || route.aliases.includes(normalizedPath)
  );

  if (matchedRoute) {
    return {
      ...matchedRoute,
      normalizedPath,
      isRootAlias: normalizedPath === "/" && matchedRoute.path !== "/"
    };
  }

  return {
    ...getRouteByPageName("dashboard"),
    normalizedPath,
    isUnknown: true,
    isRootAlias: false
  };
}

/**
 * Gets the main browser path for a page.
 *
 * @param {string} pageName
 * @returns {string}
 */
export function getPathForPage(pageName) {
  return getRouteByPageName(pageName).path;
}
