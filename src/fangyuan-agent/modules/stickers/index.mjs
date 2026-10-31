/** Native collection and library, with current-scene proposals open to admitted people. */
export default {
  id: 'stickers', name: '方源表情学习', api: 1, version: '0.1.0', tab: 'stickers',
  setup(api) {
    const native = api.lib('modules/stickers/index.js').default
    const { segmentBytes } = api.lib('core/net.js')
    let library
    const admitted = (chat) => api.config().enabled && api.config().stickers?.enabled && (!api.use('live-guard')?.permitted || api.use('live-guard').permitted(chat.chatId))
    library = native.setup({ ...api,
      rule: () => api.rule('当前会话的人可以提出存表情的建议，按实际语境和自己的意愿决定，不必只有操作者才能影响表达。只取本会话真实可见图片，不猜私聊图片；不为模仿谁而机械刷表情。'),
      tool(builder) {
        api.tool((ctx) => (builder(ctx) || []).map((tool) => tool.name !== 'qq_save_sticker' ? tool : { ...tool,
          description: '考虑把当前聊天刚才真实收到的图片或表情收进自己的表情库。当前好友、临时私聊和群友都可提议，你可以拒绝。不是导入其他会话的图片。',
          execute: async (args) => {
            if (api.config().ext?.stickers?.requestsFromAll !== true) return tool.execute(args)
            if (!admitted(ctx.chat)) return { ok: false, message: '当前会话不可用' }
            if (args.painting) return { ok: false, message: '当前提议使用真实收到的图片；画作需提供对应图片' }
            const pick = api.core.hub.recentMedia(ctx.chat.chatId).at(-1)
            if (!pick) return { ok: false, message: '当前聊天没有最近收到的图片' }
            if (api.config().dryRun) return { ok: true, simulated: true, message: '试运行，未实际收藏' }
            try {
              const bytes = await segmentBytes(pick.seg, api.core.onebot, { maxBytes: 5 * 1024 * 1024 })
              if (!admitted(ctx.chat)) return { ok: false, message: '当前会话状态已变化' }
              return await library.addFromBuffer(bytes, { name: String(args.name || '').slice(0, 12), tags: Array.isArray(args.tags) ? args.tags.slice(0, 3) : [], from: 'tool' })
            } catch (e) { return { ok: false, message: '未完成收藏：' + e.message } }
          },
        }))
      },
    })
    // Native auto-picking falls back to a random asset. Only semantic, named selection is useful here.
    return { ...library,
      match: (query) => /^id:[a-f0-9]{32}$/i.test(String(query)) ? library.library().items.find(i => i.md5.toLowerCase() === String(query).slice(3).toLowerCase()) || null : library.match(query),
      pickForReply: (text) => library.library().items.find(i => [i.name, ...(i.tags || [])].some(tag => tag && String(text).includes(tag))) || null,
    }
  },
}
