import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportReactError } from "../lib/renderer-diagnostics";

interface State {
  incidentId: string | null;
}

export class RootErrorBoundary extends Component<
  { children: ReactNode },
  State
> {
  state: State = { incidentId: null };

  static getDerivedStateFromError(): State {
    return { incidentId: "pending" };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ incidentId: reportReactError(error, info.componentStack) });
  }

  render(): ReactNode {
    if (!this.state.incidentId) return this.props.children;
    return (
      <main role="alert" style={{ padding: 32, fontFamily: "sans-serif" }}>
        <h1>The Exva interface stopped unexpectedly</h1>
        <p>Incident: {this.state.incidentId}</p>
        <button type="button" onClick={() => location.reload()}>
          Reload interface
        </button>
      </main>
    );
  }
}
