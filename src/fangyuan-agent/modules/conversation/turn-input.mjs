/** Capture the host's full query before lastTextOf truncates it or steering replaces it. */
export function turnInputs({ clock = Date.now, ttlMs = 600000 } = {}) {
  const turns = new Map()
  const get = chatId => {
    const turn = turns.get(chatId)
    if (turn && clock() - turn.at <= ttlMs) return turn
    turns.delete(chatId)
    return null
  }
  return {
    capture(content, { chat, queryText, steer = false } = {}) {
      if (!chat?.chatId || typeof queryText !== 'string') return content
      const previous = steer ? get(chat.chatId) : null
      const text = previous ? previous.text + '\n' + queryText : queryText
      turns.set(chat.chatId, { text, at: clock() })
      for (const id of turns.keys()) get(id)
      return content
    },
    text: (chatId, fallback = '') => get(chatId)?.text ?? fallback,
    take(chatId, fallback = '') {
      const text = get(chatId)?.text ?? fallback
      turns.delete(chatId)
      return text
    },
  }
}
