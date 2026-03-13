import "./styles/main.css";
import { createMonitorApp } from "./app.js";

const rootElement = document.getElementById("app");

if (!rootElement) {
  throw new Error("Monitor root element was not found.");
}

createMonitorApp(rootElement);
