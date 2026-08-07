import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@xterm/xterm/css/xterm.css";
import { App } from "./App";
import { OrcsLiveControlRoom } from "./features/orcs/OrcsLiveControlRoom";
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/patterns.css";
import "./styles/orcs.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    <OrcsLiveControlRoom />
  </StrictMode>
);
