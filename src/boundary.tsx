import { Component, type ReactNode } from 'react'
/** If any screen crashes, show what happened (and a way back) instead of a blank page. */
export class Boundary extends Component<{ children: ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null }
  static getDerivedStateFromError(err: Error) { return { err } }
  render() {
    const e = this.state.err; if (!e) return this.props.children
    return <div className="card" style={{ maxWidth: 640, margin: '40px auto' }}><h2 style={{ marginTop: 0 }}>Something went wrong</h2>
      <div className="mu">This screen hit an error. Your ratings and history are safe. Please send this message to the developer:</div>
      <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13, margin: '10px 0' }}>{String(e.message || e)}</pre>
      <div className="row"><button className="p" onClick={() => this.setState({ err: null })}>Try again</button><button onClick={() => location.reload()}>Reload the page</button></div></div>
  }
}
