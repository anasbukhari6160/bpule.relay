import { notifyError } from '@/lib/ui/notify'

export type SseHandlers<T extends { type: string } = { type: string }> = {
  onEvent: (event: T) => void
  onEnd?: () => void
  onError?: (message: string) => void
  /** The caller renders errors itself — do not also show a toast. */
  silent?: boolean
}

/**
 * Reads a fetch Response as server-sent events and dispatches each parsed
 * JSON frame. Resolves when the stream ends or the server sent an error frame.
 * Throws on network failure so callers can show a retry.
 */
export async function readSse<T extends { type: string }>(
  response: Response,
  handlers: SseHandlers<T>,
): Promise<void> {
  if (!response.ok) {
    let message = `Request failed (${response.status}).`
    try {
      const body = await response.json()
      if (body?.error) message = body.error
    } catch {
      // Non-JSON error body; keep the generic message.
    }
    if (!handlers.silent) notifyError(message)
    handlers.onError?.(message)
    throw new Error(message)
  }

  if (!response.body) {
    readonlyToolsError()
    return
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let idx = buffer.indexOf('\n\n')
      while (idx !== -1) {
        const frame = buffer.slice(0, idx).trim()
        buffer = buffer.slice(idx + 2)
        if (frame.startsWith('data: ')) {
          try {
            handlers.onEvent(JSON.parse(frame.slice(6)) as T)
          } catch {
            // Malformed frame; skip it rather than killing the stream.
          }
        }
        idx = buffer.indexOf('\n\n')
      }
    }
  } catch (err) {
    const message =
      err instanceof Error
        ? `Connection dropped: ${err.message}`
        : 'Connection dropped while the model was writing.'
    notifyError(message, 'Connection dropped')
    handlers.onError?.(message)
    throw err
  } finally {
    reader.releaseLock()
  }

  handlers.onEnd?.()
}

function readonlyToolsError(): void {
  // Not reachable in practice: fetch responses always carry a body.
  throw new Error('Response had no body.')
}