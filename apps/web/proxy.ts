import { getAPIUrl } from './services/config/config'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { isLocalhost as isLocalhostCheck } from './services/utils/ts/hostUtils'

// =============================================================================
// Tenancy
// =============================================================================
//
// Three runtime behaviors selected by `instance.tenancy`:
//
//   1. multi:               slug.{LEARNHOUSE_DOMAIN} subdomain detection +
//                           per-org custom domains. The resolver ships with the
//                           web application and is dynamically imported here.
//   2. single (localhost):  always serves the default org. Host-only cookies.
//   3. single (VPS):        any domain on a self-hosted VPS. Same as #2 — we
//                           trust the incoming Host header.
//
// Modes 2 and 3 share `tenancy === "single"`. The single-tenant code path
// returns the default org without ever calling subdomain extraction.

interface InstanceInfo {
  multi_org_enabled: boolean
  default_org_slug: string
  mode: 'saas' | 'oss' | 'ee'
  tenancy: 'multi' | 'single'
  frontend_domain: string
  top_domain: string
}

let _instanceCache: { data: InstanceInfo; ts: number } | null = null
const INSTANCE_CACHE_TTL = 30 * 1000

async function getInstanceInfo(): Promise<InstanceInfo> {
  if (_instanceCache && Date.now() - _instanceCache.ts < INSTANCE_CACHE_TTL) {
    return _instanceCache.data
  }

  try {
    const apiUrl = getAPIUrl()
    const res = await fetch(`${apiUrl}instance/info`, { signal: AbortSignal.timeout(3000) })
    if (res.ok) {
      const raw = await res.json()
      const tenancy: 'multi' | 'single' =
        raw.tenancy === 'multi' || raw.multi_org_enabled ? 'multi' : 'single'
      _instanceCache = { data: { ...raw, tenancy }, ts: Date.now() }
      return _instanceCache.data
    }
  } catch {
    // Backend unavailable — use safe defaults.
  }
  return {
    multi_org_enabled: false,
    default_org_slug: 'default',
    mode: 'oss' as const,
    tenancy: 'single',
    frontend_domain: 'localhost:3000',
    top_domain: 'localhost',
  }
}

// =============================================================================
// Resolver
// =============================================================================

interface ResolvedTenant {
  slug: string
  customDomain?: string
  source: 'custom-domain' | 'subdomain' | 'cookie' | 'default'
}

async function resolveTenant(req: NextRequest, instance: InstanceInfo): Promise<ResolvedTenant> {
  if (instance.tenancy === 'single') {
    return { slug: instance.default_org_slug, source: 'default' }
  }

  try {
    const mod = await import('./ee/services/tenancy/resolveMulti.middleware')
    return await mod.resolveMultiFromRequest(req, instance)
  } catch (err) {
    console.warn('[proxy] multi-tenant resolver unavailable; falling back to default org', err)
    return { slug: instance.default_org_slug, source: 'default' }
  }
}

async function hostIsCustomDomain(host: string | null, instance: InstanceInfo): Promise<boolean> {
  if (instance.tenancy === 'single' || !host) return false
  try {
    const mod = await import('./ee/services/tenancy/resolveMulti.middleware')
    return mod.isCustomDomain(host, instance.frontend_domain)
  } catch {
    return false
  }
}

async function isAdminSubdomain(host: string | null, instance: InstanceInfo): Promise<boolean> {
  if (instance.tenancy === 'single' || !host) return false
  try {
    const mod = await import('./ee/services/tenancy/resolveMulti.middleware')
    return mod.extractOrgSubdomain(host, instance.frontend_domain) === 'admin'
      || host.split(':')[0] === `admin.${instance.frontend_domain.split(':')[0]}`
      || host.startsWith('admin.')
  } catch {
    return host.startsWith('admin.')
  }
}

// =============================================================================
// Cookies
// =============================================================================

function cookieDomainFor(instance: InstanceInfo, customDomain?: string): string {
  if (instance.tenancy === 'single') return ''
  if (customDomain) return ''
  if (instance.top_domain === 'localhost') return ''
  return `.${instance.top_domain}`
}

function setOrgCookies(
  response: NextResponse,
  resolved: ResolvedTenant,
  instance: InstanceInfo,
) {
  const domain = cookieDomainFor(instance, resolved.customDomain)
  response.cookies.set({
    name: 'LH_org',
    value: resolved.slug,
    domain,
    path: '/',
  })
  if (resolved.customDomain) {
    response.cookies.set({
      name: 'LH_custom_domain',
      value: resolved.customDomain,
      path: '/',
    })
    response.headers.set('x-custom-domain', resolved.customDomain)
  }
}

function setInstanceCookies(response: NextResponse, info: InstanceInfo) {
  response.cookies.set({ name: 'LH_tenancy', value: info.tenancy, path: '/' })
  response.cookies.set({ name: 'LH_default_org', value: info.default_org_slug, path: '/' })
  response.cookies.set({ name: 'LH_frontend_domain', value: info.frontend_domain, path: '/' })
  response.cookies.set({ name: 'LH_top_domain', value: info.top_domain, path: '/' })
  response.cookies.set({ name: 'LH_mode', value: info.mode, path: '/' })
  return response
}

function tenantRequestHeaders(
  req: NextRequest,
  resolved: ResolvedTenant,
  instance: InstanceInfo,
): Headers {
  const headers = new Headers(req.headers)
  headers.set('x-lh-tenancy', instance.tenancy)
  headers.set('x-lh-org', resolved.slug)
  headers.set('x-lh-top-domain', instance.top_domain)
  headers.set('x-lh-frontend-domain', instance.frontend_domain)
  headers.set('x-lh-mode', instance.mode)
  if (resolved.customDomain) {
    headers.set('x-lh-custom-domain', resolved.customDomain)
  }
  return headers
}

// =============================================================================
// Middleware
// =============================================================================

export const config = {
  matcher: [
    '/((?!api|_next|fonts|umami|ingest|examples|embed|monitoring|[\\w-]+\\.\\w+).*)',
    '/sitemap.xml',
    '/robots.txt',
    '/payments/stripe/connect/oauth',
    '/podcast/:path*/feed',
  ],
}

export default async function proxy(req: NextRequest) {
  const instance = await getInstanceInfo()
  const { pathname, search } = req.nextUrl
  const fullhost = req.headers.get('host')

  const CANONICAL_LOWER = new Set([
    '/login', '/signup', '/forgot', '/reset', '/verify-email',
    '/home', '/billing', '/new', '/account', '/organizations', '/subscriptions', '/catalog',
  ])
  if (pathname !== pathname.toLowerCase() && CANONICAL_LOWER.has(pathname.toLowerCase())) {
    return NextResponse.redirect(new URL(`${pathname.toLowerCase()}${search}`, req.url), 308)
  }

  // Admin subdomain → /admin route group.
  if (await isAdminSubdomain(fullhost, instance)) {
    const target = pathname === '/admin' || pathname.startsWith('/admin/')
      ? pathname
      : `/admin${pathname}`
    const response = NextResponse.rewrite(new URL(`${target}${search}`, req.url))
    setInstanceCookies(response, instance)
    return response
  }

  // Direct /admin path is also supported.
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    const response = NextResponse.rewrite(new URL(`${pathname}${search}`, req.url))
    setInstanceCookies(response, instance)
    return response
  }

  // Legacy dashboard links.
  if (instance.tenancy === 'multi' && pathname.startsWith('/dashboard')) {
    let dest = '/home'
    const planMatch = pathname.match(/^\/dashboard\/([^/]+)\/plan\/?$/)
    if (planMatch && planMatch[1] !== 'new') {
      dest = `/billing?org=${planMatch[1]}`
    } else if (pathname === '/dashboard/new' || pathname.startsWith('/dashboard/new/')) {
      dest = '/new'
    } else if (pathname === '/dashboard/subscriptions') {
      dest = '/subscriptions'
    } else if (pathname === '/dashboard/account' || pathname.startsWith('/dashboard/account/')) {
      dest = '/account'
    }
    const extraQuery = search ? (dest.includes('?') ? `&${search.slice(1)}` : search) : ''
    return NextResponse.redirect(new URL(`${dest}${extraQuery}`, req.url), 308)
  }

  // Root-hub paths. /catalog is deliberately public and lives at the apex.
  const HUB_ROOT_PATHS = ['/home', '/organizations', '/account', '/billing', '/subscriptions', '/new', '/catalog']
  const isHubRoot = HUB_ROOT_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  )
  if (pathname === '/home' || (instance.tenancy === 'multi' && isHubRoot)) {
    let onOrgHost = false
    if ((pathname === '/account' || pathname.startsWith('/account/')) && instance.tenancy === 'multi') {
      const resolved = await resolveTenant(req, instance)
      onOrgHost = resolved.source === 'subdomain' || resolved.source === 'custom-domain'
    }
    if (!onOrgHost) {
      const response = NextResponse.rewrite(new URL(`${pathname}${search}`, req.url))
      setInstanceCookies(response, instance)
      return response
    }
  }

  // Auth pages.
  const authPaths = ['/login', '/signup', '/reset', '/forgot', '/verify-email']
  if (authPaths.includes(pathname)) {
    const hasSession = !!req.cookies.get('LH_session')?.value

    if (pathname === '/login' && hasSession) {
      const next = req.nextUrl.searchParams.get('next')
      return NextResponse.redirect(new URL(next || '/home', req.url))
    }

    const resolved = await resolveTenant(req, instance)

    if (pathname === '/signup' && hasSession) {
      const onOrgHost =
        instance.tenancy === 'single'
        || resolved.source === 'subdomain'
        || resolved.source === 'custom-domain'
      const hasInviteCode = !!req.nextUrl.searchParams.get('inviteCode')
      if (!onOrgHost && !hasInviteCode) {
        return NextResponse.redirect(new URL('/home', req.url))
      }
    }

    const requestHeaders = tenantRequestHeaders(req, resolved, instance)
    const response = NextResponse.rewrite(
      new URL(`/auth${pathname}${search}`, req.url),
      { request: { headers: requestHeaders } },
    )
    setOrgCookies(response, resolved, instance)
    setInstanceCookies(response, instance)
    return response
  }

  // Auth callbacks.
  if (
    pathname.startsWith('/auth/sso/')
    || pathname.startsWith('/auth/callback/')
    || pathname.startsWith('/auth/token-exchange')
  ) {
    const response = NextResponse.rewrite(new URL(`${pathname}${search}`, req.url))
    setInstanceCookies(response, instance)
    return response
  }

  if (pathname === '/auth/magic') {
    const resolved = await resolveTenant(req, instance)
    const requestHeaders = tenantRequestHeaders(req, resolved, instance)
    const response = NextResponse.rewrite(
      new URL(`${pathname}${search}`, req.url),
      { request: { headers: requestHeaders } },
    )
    setOrgCookies(response, resolved, instance)
    setInstanceCookies(response, instance)
    return response
  }

  // Standalone editors / boards.
  if (pathname.match(/^\/course\/[^/]+\/activity\/[^/]+\/edit$/)) {
    return NextResponse.rewrite(new URL(`/editor${pathname}`, req.url))
  }
  if (pathname.startsWith('/board/')) {
    const response = NextResponse.rewrite(new URL(pathname + search, req.url))
    setInstanceCookies(response, instance)
    return response
  }
  if (pathname.startsWith('/editor/playground/')) {
    const response = NextResponse.rewrite(new URL(pathname + search, req.url))
    setInstanceCookies(response, instance)
    return response
  }

  // Stripe Connect OAuth callback.
  if (req.nextUrl.pathname.startsWith('/payments/stripe/connect/oauth')) {
    const searchParams = req.nextUrl.searchParams
    const orgslug = searchParams.get('state')?.split('_')[0]
    const redirectUrl = new URL('/payments/stripe/connect/oauth', req.url)
    searchParams.forEach((value, key) => {
      redirectUrl.searchParams.append(key, value)
    })
    if (orgslug) {
      redirectUrl.searchParams.set('orgslug', orgslug)
    }
    return NextResponse.rewrite(redirectUrl)
  }

  // Health check.
  if (pathname.startsWith('/health')) {
    return NextResponse.rewrite(new URL(`/api/health`, req.url))
  }

  // Cross-domain auth return bridge.
  if (pathname === '/redirect_from_auth') {
    const params = new URLSearchParams(req.nextUrl.searchParams)

    const rawNext = params.get('next')
    params.delete('next')

    const customDomain = req.cookies.get('LH_custom_domain')?.value
    const base = customDomain
      ? `${req.nextUrl.protocol}//${customDomain}`
      : req.url
    const baseOrigin = new URL(base).origin

    let dest = '/'
    if (rawNext) {
      try {
        const candidate = new URL(rawNext, baseOrigin)
        if (candidate.origin === baseOrigin) {
          dest = `${candidate.pathname}${candidate.search}${candidate.hash}`
        }
      } catch {
        // Unparseable — fall back to root.
      }
    }

    const redirectUrl = new URL(dest, base)
    const remaining = params.toString()
    if (remaining) {
      redirectUrl.search = redirectUrl.search
        ? `${redirectUrl.search}&${remaining}`
        : remaining
    }
    return NextResponse.redirect(redirectUrl)
  }

  // Per-org metadata endpoints.
  if (pathname.match(/^\/podcast\/([^/]+)\/feed$/)) {
    const resolved = await resolveTenant(req, instance)
    const feedUrl = new URL(`/api${pathname}`, req.url)
    const response = NextResponse.rewrite(feedUrl)
    response.headers.set('X-Feed-Orgslug', resolved.slug)
    return response
  }
  if (pathname.startsWith('/sitemap.xml')) {
    const resolved = await resolveTenant(req, instance)
    const sitemapUrl = new URL(`/api/sitemap`, req.url)
    const response = NextResponse.rewrite(sitemapUrl)
    response.headers.set('X-Sitemap-Orgslug', resolved.slug)
    return response
  }
  if (pathname === '/robots.txt') {
    const resolved = await resolveTenant(req, instance)
    const robotsUrl = new URL(`/api/robots`, req.url)
    const response = NextResponse.rewrite(robotsUrl)
    response.headers.set('X-Robots-Orgslug', resolved.slug)
    return response
  }

  // Acyberschool apex root is the public course storefront. An org subdomain
  // or verified custom domain still falls through to its own tenant home.
  if (
    instance.tenancy === 'multi'
    && pathname === '/'
    && fullhost
    && !isLocalhostCheck(fullhost)
    && !(await hostIsCustomDomain(fullhost, instance))
  ) {
    const resolved = await resolveTenant(req, instance)
    if (resolved.source === 'default') {
      const requestHeaders = tenantRequestHeaders(req, resolved, instance)
      const response = NextResponse.next({ request: { headers: requestHeaders } })
      setOrgCookies(response, resolved, instance)
      setInstanceCookies(response, instance)
      return response
    }
  }

  // Tenant-scoped catch-all.
  const resolved = await resolveTenant(req, instance)
  const requestHeaders = tenantRequestHeaders(req, resolved, instance)
  const response = NextResponse.rewrite(
    new URL(`/orgs/${resolved.slug}${pathname}${search}`, req.url),
    { request: { headers: requestHeaders } },
  )
  setOrgCookies(response, resolved, instance)
  setInstanceCookies(response, instance)
  return response
}
