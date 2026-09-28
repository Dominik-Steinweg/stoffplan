import { Component, type ReactNode } from 'react';

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state: { error: string | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  render() {
    if (this.state.error)
      return (
        <main className="loading-screen">
          <h1>Dieser Bearbeitungsstand konnte nicht angezeigt werden.</h1>
          <p>{this.state.error}</p>
          <p>Die lokale Sicherung und deine Projektdateien bleiben erhalten.</p>
          <button onClick={() => location.reload()}>Erneut öffnen</button>
        </main>
      );
    return this.props.children;
  }
}
