import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Unhandled error caught by ErrorBoundary:', error, errorInfo);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-lg p-6 text-center space-y-4">
            <h1 className="text-lg font-semibold text-zinc-100">Something went wrong</h1>
            <p className="text-sm text-red-400 break-words">
              {this.state.error?.message || String(this.state.error)}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-emerald-600 text-white rounded text-sm font-medium hover:bg-emerald-500"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
