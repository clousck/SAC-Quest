import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Carga datos asincronos y los expone con estado de carga/error.
 * `reload()` vuelve a pedirlos sin vaciar lo que ya se muestra.
 */
export function useAsync(fn, deps) {
  const [state, setState] = useState({ data: null, error: null, loading: true })
  const fnRef = useRef(fn)
  fnRef.current = fn
  const seq = useRef(0)

  const reload = useCallback(async () => {
    const id = ++seq.current
    setState((s) => ({ ...s, loading: true }))
    try {
      const data = await fnRef.current()
      if (id === seq.current) setState({ data, error: null, loading: false })
      return data
    } catch (error) {
      if (id === seq.current) setState((s) => ({ ...s, error, loading: false }))
      return null
    }
  }, [])

  // Las dependencias las pasa quien llama, como en useEffect.
  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    setState({ data: null, error: null, loading: true })
    reload()
  }, deps)
  /* eslint-enable react-hooks/exhaustive-deps */

  const setData = useCallback((update) => {
    setState((s) => ({ ...s, data: typeof update === 'function' ? update(s.data) : update }))
  }, [])

  return { ...state, reload, setData }
}
