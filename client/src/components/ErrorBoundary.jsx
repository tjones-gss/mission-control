import { Component } from 'react'

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center space-y-2">
            <p className="text-sm text-red-400">Something went wrong</p>
            <p className="text-xs text-gray-600 max-w-md">{this.state.error?.message || 'An unexpected error occurred'}</p>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className="text-xs text-gray-500 hover:text-gray-300 underline transition-colors"
            >
              Try again
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
