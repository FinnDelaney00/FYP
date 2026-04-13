import "./styles/main.css";
import { createMonitorApp } from "./app.js";

// The monitor is mounted into a single app shell so the page can stay framework
// agnostic and be embedded in simple static hosting environments.
const rootElement = document.getElementById("app");

if (!rootElement) {
  throw new Error("Monitor root element was not found.");
}

createMonitorApp(rootElement);
