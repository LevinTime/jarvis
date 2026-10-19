import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { applyAppearance, readLocalSettings } from "./appearance.ts";
import { App } from "./App.tsx";
import "./styles.css";

applyAppearance(readLocalSettings());

const root = document.querySelector("#root");
if (!root) {
  throw new Error("root fehlt");
}
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
