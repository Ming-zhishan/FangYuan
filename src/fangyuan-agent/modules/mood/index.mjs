export default {
  id: 'mood', name: '方源心境', api: 1, version: '0.1.0', tab: 'mood',
  description: '情绪由人格和真实事件判断；移除夸奖加分、粗话扣分和撒娇模板。',
  setup() {
    return {
      fangyuanImplementation: '0.1.0',
      state: () => ({ label: '不使用关键词情绪评分', history: [] }),
      label: () => '平稳', nudge: () => undefined, current: () => 60,
      effects: () => ({ sticker: 1, voice: 1, delay: 1, chatty: 1 }),
      contextLine: () => '', observe: () => undefined, judge: async () => null,
    }
  },
}
