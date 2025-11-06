import React, { useEffect, useMemo, useRef, useState } from 'react'
const BUILD_LABEL = 'v3.0 SaaS'
import { register, login, logout, getMe, getStatus, searchItems, updateItems, getTaxRates, getAccounts } from './api.js'
import AdminDashboard from './AdminDashboard.jsx'

const PAGE_LIMIT = 8
const PREFETCH_AHEAD = 3

function useDebounced(value, delay=500) {
  const [v, setV] = useState(value)
  useEffect(() => { const t = setTimeout(() => setV(value), delay); return () => clearTimeout(t) }, [value, delay])
  return v
}

function setDeep(obj, path, value) { const [a,b]=path.split('.'); return { ...obj, [a]: { ...(obj[a]||{}), [b]: value } } }

function normaliseChanges(changes) {
  const out = {}
  for (const [k, v] of Object.entries(changes)) {
    if (v === '' || v === undefined) continue
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      const child = normaliseChanges(v); if (Object.keys(child).length) out[k] = child
    } else if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) { out[k] = Number(v) }
    else { out[k] = v }
  }
  return out
}

export default function App() {
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authMode, setAuthMode] = useState('login') // 'login' or 'signup'

  const [connected, setConnected] = useState(false)
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const q = useDebounced(query, 400)
  const [page, setPage] = useState(1)
  const [items, setItems] = useState([])
  const [note, setNote] = useState('')
  const [changed, setChanged] = useState({})
  const [message, setMessage] = useState('')
  const [taxRates, setTaxRates] = useState([])
  const [accounts, setAccounts] = useState([])
  const [tenantName, setTenantName] = useState('')

  const pageCache = useRef({})
  const prefetching = useRef(false)

  const [theme, setTheme] = useState(document.documentElement.getAttribute('data-theme') || 'light')

  function toggleTheme() {
    const next = theme === 'light' ? 'dark' : 'light'
    setTheme(next); document.documentElement.setAttribute('data-theme', next); localStorage.setItem('prodit-theme', next)
  }

  // Check auth status on mount
  useEffect(() => {
    getMe().then(userData => {
      if (userData) {
        setUser(userData)
      }
    }).finally(() => setAuthLoading(false))
  }, [])

  async function loadStatus() {
    try {
      const status = await getStatus()
      setConnected(status.connected)
      setTenantName(status.tenantName || '')
    } catch (e) {
      setConnected(false)
    }
  }

  async function loadMetadata() {
    setLoading(true)
    try {
      const [taxes, accs] = await Promise.all([
        getTaxRates().catch(()=>({ TaxRates: [] })),
        getAccounts().catch(()=>({ Accounts: [] }))
      ])
      setTaxRates(taxes?.TaxRates || [])
      setAccounts(accs?.Accounts || [])
    } finally { setLoading(false) }
  }

  useEffect(() => {
    if (user) {
      loadStatus()
    }
  }, [user])

  useEffect(() => {
    if (connected) {
      loadMetadata()
    }
  }, [connected])

  async function fetchPage(p) {
    const data = await searchItems({ query: q, page: p, limit: PAGE_LIMIT })
    const rows = data?.Items || []
    pageCache.current[p] = rows
    return rows.length
  }

  async function loadItems() {
    if (!connected) return
    setLoading(true); setItems([]); setNote(''); pageCache.current = {}
    setPage(1) // Reset to page 1 when loading new items
    try {
      const count = await fetchPage(1)
      setItems(pageCache.current[1] || [])
      setNote(count === 0 ? 'No results on page 1' : '')
      prefetchAhead(2)
    } finally { setLoading(false) }
  }

  function prefetchAhead(startPage) {
    if (prefetching.current) return
    prefetching.current = true
    let p = startPage
    const tick = async () => {
      try {
        if (p - startPage >= PREFETCH_AHEAD) { prefetching.current = false; return }
        if (pageCache.current[p]) { p += 1; setTimeout(tick, 200); return }
        const got = await fetchPage(p)
        if (got === 0) { prefetching.current = false; return }
        p += 1; setTimeout(tick, 200)
      } catch { prefetching.current = false }
    }
    setTimeout(tick, 300)
  }

  useEffect(() => { loadItems() }, [q, connected])
  useEffect(() => {
    if (!connected) return
    const cached = pageCache.current[page]
    if (cached) { setItems(cached); prefetchAhead(page + 1) }
    else {
      setLoading(true)
      fetchPage(page).then(() => { setItems(pageCache.current[page] || []); prefetchAhead(page + 1) }).finally(() => setLoading(false))
    }
  }, [page, connected])

  function setField(item, field, value) {
    setItems(prev => prev.map(it => it.ItemID === item.ItemID ? { ...it, [field]: value } : it))
    setChanged(prev => ({ ...prev, [item.ItemID]: { ...(prev[item.ItemID]||{}), [field]: value } }))
  }

  function setNested(item, path, value) {
    setItems(prev => prev.map(it => it.ItemID === item.ItemID ? setDeep(it, path, value) : it))
    setChanged(prev => ({ ...prev, [item.ItemID]: setDeep(prev[item.ItemID]||{}, path, value) }))
  }

  async function saveChanges() {
    const updates = items.filter(it => changed[it.ItemID]).map(it => ({ ItemID: it.ItemID, Code: it.Code, ...normaliseChanges(changed[it.ItemID]) }))
    if (updates.length === 0) { setMessage('No changes to save.'); return }
    setLoading(true); setMessage('Saving changes...')
    try {
      const resp = await updateItems(updates); const ok = resp?.Items?.length || 0
      setMessage(`Saved. ${ok} item(s) updated.`); setChanged({})
      await fetchPage(page); setItems(pageCache.current[page] || [])
    } catch (e) { setMessage(`Failed to save changes. ${e.message}`) } finally { setLoading(false) }
  }

  const changedCount = useMemo(() => Object.keys(changed).length, [changed])

  const taxOptions = taxRates.filter(t => t?.Status !== 'DELETED').map(t => ({ value: t.TaxType, label: t.Name }))
  const accountOptions = accounts.filter(a => a?.Status === 'ACTIVE').sort((a,b)=>String(a.Code).localeCompare(String(b.Code))).map(a => ({ value: String(a.Code||''), label: `${a.Code||''} — ${a.Name||''}` }))

  function TaxSelect({ item, path, value, disabled }) {
    return (<select value={value||''} onChange={e=>setNested(item, path, e.target.value)} disabled={disabled}><option value=""></option>{taxOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}</select>)
  }

  function AccountSelect({ item, path, value, disabled }) {
    return (<select value={value||''} onChange={e=>setNested(item, path, e.target.value)} disabled={disabled}><option value=""></option>{accountOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}</select>)
  }

  // Column widths
  const defaults = {
    code: 220, name: 260, desc: 420,
    sale: 110, saleAcct: 160, saleTax: 150,
    cost: 110, purAcct: 160, purTax: 150, status: 120
  }
  const [colW, setColW] = useState(() => {
    try { return { ...defaults, ...(JSON.parse(localStorage.getItem('prodit-colw')||'{}')) } } catch { return defaults }
  })
  useEffect(() => { localStorage.setItem('prodit-colw', JSON.stringify(colW)) }, [colW])

  function ResizableTH({ id, title }) {
    const w = colW[id]
    function onMouseDown(e) {
      const startX = e.clientX
      const startW = colW[id]
      function onMove(ev){
        const delta = ev.clientX - startX
        setColW(prev => ({ ...prev, [id]: Math.max(90, startW + delta) }))
      }
      function onUp(){
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    }
    return (
      <th className="th-resizable" style={{ width: w }}>
        {title}
        <span className="resizer" onMouseDown={onMouseDown} />
      </th>
    )
  }

  // Auth handlers
  async function handleLogin(e) {
    e.preventDefault()
    const formData = new FormData(e.target)
    try {
      setMessage('Signing in...')
      const result = await login({
        email: formData.get('email'),
        password: formData.get('password')
      })
      setUser(result.user)
      setMessage('')
    } catch (error) {
      setMessage(error.message)
    }
  }

  async function handleSignup(e) {
    e.preventDefault()
    const formData = new FormData(e.target)
    const password = formData.get('password')
    const confirmPassword = formData.get('confirmPassword')

    if (password !== confirmPassword) {
      setMessage('Passwords do not match')
      return
    }

    try {
      setMessage('Creating account...')
      const result = await register({
        email: formData.get('email'),
        password: password,
        fullName: formData.get('fullName')
      })
      setUser(result.user)
      setMessage('')
    } catch (error) {
      setMessage(error.message)
    }
  }

  async function handleLogout() {
    await logout()
    setUser(null)
    setConnected(false)
    setItems([])
    setMessage('')
  }

  // Routing logic for admin
  const isAdminPath = window.location.pathname === '/admin'

  useEffect(() => {
    if (!user) return

    // If user is admin and not on admin path, redirect to admin
    if (user.isAdmin && !isAdminPath && window.location.pathname === '/') {
      window.location.pathname = '/admin'
    }

    // If user is not admin and on admin path, redirect to main app
    if (!user.isAdmin && isAdminPath) {
      window.location.pathname = '/'
    }
  }, [user, isAdminPath])

  // Admin dashboard for admin users
  if (user && user.isAdmin && isAdminPath) {
    return <AdminDashboard user={user} onLogout={() => { setUser(null); setConnected(false); setItems([]); setMessage('') }} />
  }

  // Auth screen
  if (authLoading) {
    return (
      <div className="auth-container">
        <div className="auth-box">
          <h1>Prodit</h1>
          <p>Loading...</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="auth-container">
        <div className="auth-box">
          <h1>Prodit</h1>
          <p className="subtitle">Xero Products & Services Editor</p>

          {authMode === 'login' ? (
            <form onSubmit={handleLogin}>
              <h2>Sign In</h2>
              <input type="email" name="email" placeholder="Email" required />
              <input type="password" name="password" placeholder="Password" required />
              <button type="submit" className="primary full-width">Sign In</button>
              <p className="auth-switch">
                Don't have an account? <a href="#" onClick={(e) => { e.preventDefault(); setAuthMode('signup'); setMessage('') }}>Sign up</a>
              </p>
            </form>
          ) : (
            <form onSubmit={handleSignup}>
              <h2>Create Account</h2>
              <input type="text" name="fullName" placeholder="Full Name (optional)" />
              <input type="email" name="email" placeholder="Email" required />
              <input type="password" name="password" placeholder="Password (min 8 characters)" required />
              <input type="password" name="confirmPassword" placeholder="Confirm Password" required />
              <button type="submit" className="primary full-width">Create Account</button>
              <p className="auth-switch">
                Already have an account? <a href="#" onClick={(e) => { e.preventDefault(); setAuthMode('login'); setMessage('') }}>Sign in</a>
              </p>
            </form>
          )}

          {message && <p className="message">{message}</p>}
        </div>
      </div>
    )
  }

  // Main app
  return (
    <div>
      <header>
        <div className="header-inner">
          <div className="title">Prodit <span className="build-badge">{BUILD_LABEL}</span></div>
          <div className="toolbar">
            <label className="switch">
              <input id="theme-toggle" type="checkbox" checked={theme==='dark'} onChange={toggleTheme} />
              <span className="track"><span className="thumb"></span></span>
              <label htmlFor="theme-toggle" className="small">{theme==='dark' ? 'Dark' : 'Light'}</label>
            </label>

            {!connected ? (
              <a href="/auth/xero" className="btn-link">Connect Xero</a>
            ) : (
              <span className="status">Connected: {tenantName}</span>
            )}

            <span className="user-email">{user.email}</span>
            <button onClick={handleLogout}>Logout</button>

            {connected && (
              <button className="save-btn-header" onClick={saveChanges} disabled={loading || changedCount===0}>
                Save changes {changedCount>0 ? `(${changedCount})` : ''}
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="container">
        {!connected ? (
          <div className="welcome-box">
            <h2>Welcome to Prodit!</h2>
            <p>To get started, connect your Xero organization.</p>
            <a href="/auth/xero" className="btn-primary">Connect Xero Account</a>
          </div>
        ) : (
          <>
            <div className="controls-section">
              <input className="stretch" type="text" placeholder="Search by code, name or description (2+ chars)" value={query} onChange={e=>{ setQuery(e.target.value); setPage(1) }} />
              <div className="pagination">
                <button onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page<=1 || loading}>Previous</button>
                <button className="primary" disabled>Page {page}</button>
                <button onClick={()=>setPage(p=>p+1)} disabled={loading}>Next</button>
                <span className="small">Only modified rows are posted in a batch. Code is included for validation.</span>
              </div>
              {message && <span className="small message-inline">{message}</span>}
            </div>

            <div className="table-card">
              <table>
                <colgroup>
                  <col style={{ width: colW.code }}/>
                  <col style={{ width: colW.name }}/>
                  <col style={{ width: colW.desc }}/>
                  <col style={{ width: colW.sale }}/>
                  <col style={{ width: colW.saleAcct }}/>
                  <col style={{ width: colW.saleTax }}/>
                  <col style={{ width: colW.cost }}/>
                  <col style={{ width: colW.purAcct }}/>
                  <col style={{ width: colW.purTax }}/>
                  <col style={{ width: colW.status }}/>
                </colgroup>
                <thead>
                  <tr>
                    <ResizableTH id="code" title="Code" />
                    <ResizableTH id="name" title="Name" />
                    <ResizableTH id="desc" title="Description" />
                    <ResizableTH id="sale" title="Sale price" />
                    <ResizableTH id="saleAcct" title="Sales account" />
                    <ResizableTH id="saleTax" title="Sales tax" />
                    <ResizableTH id="cost" title="Cost price" />
                    <ResizableTH id="purAcct" title="Purchase account" />
                    <ResizableTH id="purTax" title="Purchase tax" />
                    <ResizableTH id="status" title="Status" />
                  </tr>
                </thead>
                <tbody>
                  {note && items.length===0 && (<tr><td colSpan="10"><div className="small">{note}</div></td></tr>)}
                  {items.map(item => {
                    const salePrice = item?.SalesDetails?.UnitPrice ?? ''
                    const costPrice = item?.PurchaseDetails?.UnitPrice ?? ''
                    const tracked = item?.IsTrackedAsInventory
                    // Get field permissions (default all true for admins or if not set)
                    const perms = user?.fieldPermissions || {
                      code: true, name: true, description: true,
                      salePrice: true, salesAccount: true, salesTax: true,
                      costPrice: true, purchaseAccount: true, purchaseTax: true, status: true
                    }
                    return (
                      <tr key={item.ItemID} className={changed[item.ItemID]?'changes':''}>
                        <td><input type="text" value={item.Code||''} onChange={e=>setField(item,'Code',e.target.value)} disabled={!perms.code} /></td>
                        <td><input type="text" value={item.Name||''} onChange={e=>setField(item,'Name',e.target.value)} disabled={!perms.name} /></td>
                        <td><input type="text" value={item.Description||''} onChange={e=>setField(item,'Description',e.target.value)} disabled={!perms.description} /></td>
                        <td><input type="number" step="0.01" value={salePrice} onChange={e=>setNested(item,'SalesDetails.UnitPrice',e.target.value)} disabled={!perms.salePrice} /></td>
                        <td><AccountSelect item={item} path="SalesDetails.AccountCode" value={item.SalesDetails?.AccountCode||''} disabled={!perms.salesAccount} /></td>
                        <td><TaxSelect item={item} path="SalesDetails.TaxType" value={item.SalesDetails?.TaxType||''} disabled={!perms.salesTax} /></td>
                        <td><input type="number" step="0.01" value={costPrice} onChange={e=>setNested(item,'PurchaseDetails.UnitPrice',e.target.value)} disabled={!perms.costPrice} /></td>
                        <td><AccountSelect item={item} path="PurchaseDetails.AccountCode" value={item.PurchaseDetails?.AccountCode||''} disabled={!perms.purchaseAccount} /></td>
                        <td><TaxSelect item={item} path="PurchaseDetails.TaxType" value={item.PurchaseDetails?.TaxType||''} disabled={!perms.purchaseTax} /></td>
                        <td>
                          <select value={item.Status||'ACTIVE'} onChange={e=>setField(item,'Status',e.target.value)} disabled={!perms.status}>
                            <option value="ACTIVE">ACTIVE</option>
                            <option value="ARCHIVED">ARCHIVED</option>
                          </select>
                          {tracked && <div className="small">Tracked item. Quantity and cost are read only in Xero.</div>}
                        </td>
                      </tr>
                    )
                  })}
                  {items.length===0 && !note && (<tr><td colSpan="10"><div className="small">No items. Try another search or page.</div></td></tr>)}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan="10">
                      <div className="table-footer">
                        <button className="save-btn" onClick={saveChanges} disabled={loading || changedCount===0}>
                          Save changes {changedCount>0 ? `(${changedCount})` : ''}
                        </button>
                        <span className="small">{items.length} rows loaded • {changedCount} modified</span>
                      </div>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </div>
      <footer className="footer-note">Prodit · {BUILD_LABEL} · Multi-tenant Xero Products & Services Editor</footer>
    </div>
  )
}
