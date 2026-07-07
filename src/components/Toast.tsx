import { useCallback, useRef, useState } from 'react'
import './Toast.css'

interface ToastState {
  show: boolean
  title: string
  text: string
}

/** Bottom-center toast. `accent` matches the reference per screen:
 *  blue on Bed Overview, green on Doctor Workspace. */
export function Toast({ state, accent }: { state: ToastState; accent: 'blue' | 'green' }) {
  return (
    <div className={`toast toast-${accent}${state.show ? ' show' : ''}`} role="status" aria-live="polite">
      <b>{state.title}</b> <span>{state.text}</span>
    </div>
  )
}

export function useToast(defaultTitle = '') {
  const [state, setState] = useState<ToastState>({ show: false, title: defaultTitle, text: '' })
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const showToast = useCallback((title: string, text: string, ms = 2400) => {
    setState({ show: true, title, text })
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setState(s => ({ ...s, show: false })), ms)
  }, [])
  return { toast: state, showToast }
}
