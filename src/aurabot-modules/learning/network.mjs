import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

/** Only this module's public GET requests use the already installed local proxy. */
export function publicNetwork(settings) {
  if (!settings.publicProxyUrl || !settings.fetchPackagePath) return { fetcher: fetch, close() {} }
  if (!/^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(settings.publicProxyUrl)) throw new Error('only_existing_loopback_public_proxy_allowed')
  const { fetch: request, ProxyAgent } = createRequire(pathToFileURL(settings.fetchPackagePath))('undici')
  const agent = new ProxyAgent(settings.publicProxyUrl)
  return { fetcher: (url, options) => request(url, { ...options, dispatcher: agent }), close: () => agent.close() }
}
