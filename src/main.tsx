import { Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App";
import "katex/dist/katex.min.css";
import "./styles.css";

type BoundaryState = { error: string | null };

class Boundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error: error instanceof Error ? (error.stack ?? error.message) : String(error) };
  }

  render() {
    if (this.state.error) {
      return <pre className="crash">{this.state.error}</pre>;
    }
    return this.props.children;
  }
}

window.addEventListener("error", (event) => {
  const root = document.getElementById("root");
  if (!root || root.childElementCount > 0) return;
  const error = event.error;
  root.textContent = error instanceof Error ? `${error.name}: ${error.message}\n\n${error.stack ?? ""}` : event.message;
});

const root = document.getElementById("root");
if (root) createRoot(root).render(<Boundary><App /></Boundary>);
