// All API requests stay on this host. The Vercel proxy keeps the HttpOnly
// refresh cookie host-only; access tokens are held only in this module.
const byId = (id) => document.getElementById(id)
const IDLE_MS = 15 * 60 * 1000
let accessToken = null
let identity = ''
let page = 1
let totalPages = 1
let lastActivity = Date.now()
let refreshPromise = null
let generation = 0

class ApiError extends Error {
  constructor(status) { super(`Request failed (${status})`); this.status = status }
}

async function request(path, options = {}) {
  const response = await fetch(`/api/v1${path}`, {
    ...options,
    credentials: 'same-origin',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
  })
  if (!response.ok) throw new ApiError(response.status)
  return response.status === 204 ? null : response.json()
}

function showLogin(message = '') {
  generation += 1
  accessToken = null
  identity = ''
  byId('tenants').replaceChildren()
  byId('identity').textContent = ''
  byId('console').hidden = true
  byId('loading').hidden = true
  byId('login-panel').hidden = false
  byId('login-error').textContent = message
  byId('login-error').hidden = !message
}

function acceptSession(result) {
  accessToken = result.data.accessToken
  identity = result.data.user.email
}

async function refresh() {
  if (!refreshPromise) {
    const current = generation
    refreshPromise = request('/auth/refresh', { method: 'POST' })
      .then((result) => { if (current === generation) acceptSession(result) })
      .finally(() => { refreshPromise = null })
  }
  return refreshPromise
}

async function platformRequest(path) {
  try { return await request(path) }
  catch (error) {
    if (error.status !== 401) throw error
    await refresh()
    if (!accessToken) throw new ApiError(401)
    return request(path)
  }
}

async function loadTenants(targetPage = page) {
  const current = generation
  for (const id of ['reload', 'previous', 'next']) byId(id).disabled = true
  byId('data-error').hidden = true
  try {
    // This server-side SUPER_ADMIN check is the authority. A merchant's
    // ordinary ADMIN role is never sufficient to enter this console.
    const result = await platformRequest(`/platform/tenants?page=${targetPage}&limit=20`)
    if (current !== generation) return
    page = result.meta.page
    totalPages = result.meta.totalPages
    byId('tenants').replaceChildren(...result.data.map((tenant) => {
      const row = document.createElement('tr')
      for (const value of [tenant.slug, tenant.status, tenant.storeCount, new Date(tenant.createdAt).toLocaleDateString()]) {
        const cell = document.createElement('td')
        cell.textContent = String(value)
        row.append(cell)
      }
      return row
    }))
    byId('empty').hidden = result.data.length !== 0
    byId('page-label').textContent = `Page ${page} of ${totalPages}`
    byId('identity').textContent = identity
    byId('login-panel').hidden = true
    byId('loading').hidden = true
    byId('console').hidden = false
  } catch (error) {
    if (current !== generation) return
    if (error.status === 403) {
      await signOut('This account does not have platform superadmin access.')
    } else if (error.status === 401) {
      showLogin('Your session has expired. Please sign in again.')
    } else if (byId('console').hidden) {
      await signOut('Unable to load the platform. Please try again.')
    } else {
      byId('data-error').textContent = 'Unable to refresh tenants. Please try again.'
      byId('data-error').hidden = false
    }
  } finally {
    byId('reload').disabled = false
    byId('previous').disabled = page <= 1
    byId('next').disabled = page >= totalPages
  }
}

async function signOut(message = '') {
  // Capture the authorization header before clearing memory. Hide private
  // content immediately even if the network is unavailable.
  const logout = request('/auth/logout', { method: 'POST' })
  showLogin(message)
  byId('login-button').disabled = true
  try { await logout }
  catch {
    byId('login-error').textContent = 'Signed out locally. Server sign-out could not be confirmed; close this browser on a shared device.'
    byId('login-error').hidden = false
  } finally { byId('login-button').disabled = false }
}

byId('login-form').addEventListener('submit', async (event) => {
  event.preventDefault()
  byId('login-button').disabled = true
  byId('login-error').hidden = true
  try {
    const result = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: byId('email').value.trim(), password: byId('password').value }),
    })
    acceptSession(result)
    lastActivity = Date.now()
    await loadTenants(1)
  } catch (error) {
    showLogin(error.status === 401 ? 'Invalid email or password.' : error.status === 429 ? 'Too many attempts. Please wait before trying again.' : 'Unable to sign in. Please try again.')
  } finally {
    byId('password').value = ''
    byId('login-button').disabled = false
  }
})

byId('logout').addEventListener('click', () => { void signOut() })
byId('reload').addEventListener('click', () => { void loadTenants() })
byId('previous').addEventListener('click', () => { void loadTenants(page - 1) })
byId('next').addEventListener('click', () => { void loadTenants(page + 1) })
function checkIdle() {
  if (accessToken && Date.now() - lastActivity >= IDLE_MS) {
    void signOut('Signed out after 15 minutes of inactivity.')
  }
}
for (const event of ['pointerdown', 'pointermove', 'keydown', 'scroll', 'touchstart']) {
  window.addEventListener(event, () => { checkIdle(); lastActivity = Date.now() }, { passive: true })
}
window.addEventListener('focus', checkIdle)
document.addEventListener('visibilitychange', checkIdle)
setInterval(checkIdle, 30_000)

try { await refresh(); await loadTenants(1) }
catch (error) { showLogin(error.status === 401 ? '' : 'Unable to restore your session. Please sign in.') }
