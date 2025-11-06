import React, { useEffect, useState } from 'react'
import { logout } from './api.js'

const BUILD_LABEL = 'v3.0 SaaS'

export default function AdminDashboard({ user, onLogout }) {
  const [users, setUsers] = useState([])
  const [xeroStatus, setXeroStatus] = useState({ connected: false })
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [showCreateUser, setShowCreateUser] = useState(false)
  const [theme, setTheme] = useState(document.documentElement.getAttribute('data-theme') || 'light')
  const [activeView, setActiveView] = useState('dashboard') // 'dashboard' or 'users'

  function toggleTheme() {
    const next = theme === 'light' ? 'dark' : 'light'
    setTheme(next)
    document.documentElement.setAttribute('data-theme', next)
    localStorage.setItem('prodit-theme', next)
  }

  async function loadUsers() {
    try {
      const response = await fetch('/api/admin/users', {
        credentials: 'include'
      })
      const data = await response.json()
      if (response.ok) {
        setUsers(data.users || [])
      } else {
        setMessage(`Failed to load users: ${data.error}`)
      }
    } catch (error) {
      setMessage(`Failed to load users: ${error.message}`)
    }
  }

  async function loadXeroStatus() {
    try {
      const response = await fetch('/api/admin/xero/status', {
        credentials: 'include'
      })
      const data = await response.json()
      if (response.ok) {
        setXeroStatus(data)
      }
    } catch (error) {
      console.error('Failed to load Xero status:', error)
    }
  }

  useEffect(() => {
    loadUsers()
    loadXeroStatus()
  }, [])

  async function handleCreateUser(e) {
    e.preventDefault()
    const formData = new FormData(e.target)

    setLoading(true)
    setMessage('Creating user...')

    try {
      const response = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email: formData.get('email'),
          password: formData.get('password'),
          fullName: formData.get('fullName')
        })
      })

      const data = await response.json()

      if (response.ok) {
        setMessage('User created successfully!')
        setShowCreateUser(false)
        e.target.reset()
        await loadUsers()
      } else {
        setMessage(`Error: ${data.error}`)
      }
    } catch (error) {
      setMessage(`Error: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  async function toggleUserStatus(userId, currentStatus) {
    const newStatus = !currentStatus
    setLoading(true)
    setMessage(`${newStatus ? 'Activating' : 'Deactivating'} user...`)

    try {
      const response = await fetch(`/api/admin/users/${userId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ isActive: newStatus })
      })

      const data = await response.json()

      if (response.ok) {
        setMessage(`User ${newStatus ? 'activated' : 'deactivated'} successfully!`)
        await loadUsers()
      } else {
        setMessage(`Error: ${data.error}`)
      }
    } catch (error) {
      setMessage(`Error: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  async function deleteUser(userId, userEmail) {
    if (!confirm(`Are you sure you want to delete user ${userEmail}? This action cannot be undone.`)) {
      return
    }

    setLoading(true)
    setMessage('Deleting user...')

    try {
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: 'DELETE',
        credentials: 'include'
      })

      const data = await response.json()

      if (response.ok) {
        setMessage('User deleted successfully!')
        await loadUsers()
      } else {
        setMessage(`Error: ${data.error}`)
      }
    } catch (error) {
      setMessage(`Error: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  async function disconnectXero() {
    if (!confirm('Are you sure you want to disconnect the system Xero connection? All users will lose access.')) {
      return
    }

    setLoading(true)
    setMessage('Disconnecting Xero...')

    try {
      const response = await fetch('/api/admin/xero/disconnect', {
        method: 'DELETE',
        credentials: 'include'
      })

      const data = await response.json()

      if (response.ok) {
        setMessage('Xero connection disconnected successfully!')
        await loadXeroStatus()
      } else {
        setMessage(`Error: ${data.error}`)
      }
    } catch (error) {
      setMessage(`Error: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  async function handleLogout() {
    await logout()
    onLogout()
  }

  return (
    <div className="admin-layout">
      {/* Sidebar */}
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <h1>Prodit Admin</h1>
          <span className="build-badge">{BUILD_LABEL}</span>
        </div>

        <nav className="admin-nav">
          <div className="admin-nav-section">
            <button
              className={`admin-nav-item ${activeView === 'dashboard' ? 'active' : ''}`}
              onClick={() => setActiveView('dashboard')}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="7" height="7"></rect>
                <rect x="14" y="3" width="7" height="7"></rect>
                <rect x="14" y="14" width="7" height="7"></rect>
                <rect x="3" y="14" width="7" height="7"></rect>
              </svg>
              <span>Dashboard</span>
            </button>

            <button
              className={`admin-nav-item ${activeView === 'users' ? 'active' : ''}`}
              onClick={() => setActiveView('users')}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                <circle cx="9" cy="7" r="4"></circle>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
              </svg>
              <span>User Management</span>
            </button>

            <button className="admin-nav-item" onClick={() => window.location.href = '/auth/xero'}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                <line x1="12" y1="22.08" x2="12" y2="12"></line>
              </svg>
              <span>Xero Connection</span>
            </button>
          </div>

          <div className="admin-nav-section admin-nav-bottom">
            <label className="switch" style={{ padding: '8px 16px' }}>
              <input id="theme-toggle" type="checkbox" checked={theme==='dark'} onChange={toggleTheme} />
              <span className="track"><span className="thumb"></span></span>
              <label htmlFor="theme-toggle" className="small">{theme==='dark' ? 'Dark' : 'Light'}</label>
            </label>
          </div>
        </nav>
      </aside>

      {/* Main Content */}
      <div className="admin-main">
        <header className="admin-header">
          <div className="admin-header-content">
            <h2>{activeView === 'dashboard' ? 'Dashboard' : 'User Management'}</h2>
            <div className="admin-header-actions">
              <span className="admin-user-badge">{user.email}</span>
              <button onClick={handleLogout} className="btn-secondary">Logout</button>
            </div>
          </div>
        </header>

        <div className="admin-content">
          {message && <div className="alert alert-info">{message}</div>}

          {activeView === 'dashboard' && (
            <>
              <div className="welcome-message">
                <h3>Welcome back, {user.email?.split('@')[0]}!</h3>
                <p>This is your dashboard. You can view system status and manage your account.</p>
              </div>

              <div className="admin-stats-grid">
                <div className="admin-stat-card">
                  <div className="admin-stat-label">Role</div>
                  <div className="admin-stat-value">Admin</div>
                </div>
                <div className="admin-stat-card">
                  <div className="admin-stat-label">Status</div>
                  <div className="admin-stat-value status-active">Active</div>
                </div>
                <div className="admin-stat-card">
                  <div className="admin-stat-label">Organization</div>
                  <div className="admin-stat-value">{xeroStatus.tenantName || 'Not Connected'}</div>
                </div>
              </div>
            </>
          )}

          {activeView === 'dashboard' && (
            <div className="admin-card">
              <h3>System Xero Connection</h3>
              {xeroStatus.connected ? (
                <div className="xero-connected">
                  <div className="info-grid">
                    <div className="info-item">
                      <span className="info-label">Status</span>
                      <span className="badge badge-success">Connected</span>
                    </div>
                    <div className="info-item">
                      <span className="info-label">Organization</span>
                      <span className="info-value">{xeroStatus.tenantName}</span>
                    </div>
                    <div className="info-item">
                      <span className="info-label">Tenant ID</span>
                      <span className="info-value">{xeroStatus.tenantId}</span>
                    </div>
                    <div className="info-item">
                      <span className="info-label">Last Synced</span>
                      <span className="info-value">{xeroStatus.lastSynced ? new Date(xeroStatus.lastSynced).toLocaleString() : 'N/A'}</span>
                    </div>
                  </div>
                  <div className="button-group" style={{ marginTop: '1.5rem' }}>
                    <button onClick={disconnectXero} disabled={loading} className="btn-secondary">Disconnect Xero</button>
                    <a href="/auth/xero" className="btn-primary">Reconnect Xero</a>
                  </div>
                </div>
              ) : (
                <div className="xero-disconnected">
                  <p>No Xero connection configured. Users will not be able to access the system until you connect Xero.</p>
                  <a href="/auth/xero" className="btn-primary">Connect Xero Organization</a>
                </div>
              )}
            </div>
          )}

          {activeView === 'users' && (
            <>
              <div className="admin-card">
                <div className="card-header">
                  <h3>Users</h3>
                  <button className="btn-primary" onClick={() => setShowCreateUser(!showCreateUser)}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '8px' }}>
                      <line x1="12" y1="5" x2="12" y2="19"></line>
                      <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                    {showCreateUser ? 'Cancel' : 'Create New User'}
                  </button>
                </div>

                {showCreateUser && (
                  <div className="create-user-form">
                    <form onSubmit={handleCreateUser}>
                      <h4>Create New User</h4>
                      <div className="form-grid">
                        <input type="email" name="email" placeholder="Email" required />
                        <input type="text" name="fullName" placeholder="Full Name (optional)" />
                        <input type="password" name="password" placeholder="Password (min 8 characters)" required minLength={8} />
                      </div>
                      <button type="submit" className="btn-primary" disabled={loading}>Create User</button>
                    </form>
                  </div>
                )}

                {users.length === 0 ? (
                  <p style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>No users found.</p>
                ) : (
                  <div className="users-table-wrapper">
                    <table className="users-table">
                      <thead>
                        <tr>
                          <th>Email</th>
                          <th>Full Name</th>
                          <th>Status</th>
                          <th>Role</th>
                          <th>Created</th>
                          <th>Last Login</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {users.map(u => (
                          <tr key={u.id}>
                            <td>{u.email}</td>
                            <td>{u.full_name || '-'}</td>
                            <td>
                              <span className={`badge ${u.is_active ? 'badge-success' : 'badge-inactive'}`}>
                                {u.is_active ? 'Active' : 'Inactive'}
                              </span>
                            </td>
                            <td>
                              {u.is_admin ? <span className="badge">Admin</span> : <span className="role-user">User</span>}
                            </td>
                            <td>{new Date(u.created_at).toLocaleDateString()}</td>
                            <td>{u.last_login ? new Date(u.last_login).toLocaleDateString() : <span className="small">Never</span>}</td>
                            <td>
                              {u.id !== user.id ? (
                                <div className="action-buttons">
                                  <button
                                    onClick={() => toggleUserStatus(u.id, u.is_active)}
                                    disabled={loading}
                                    className="btn-sm btn-secondary"
                                  >
                                    {u.is_active ? 'Deactivate' : 'Activate'}
                                  </button>
                                  <button
                                    onClick={() => deleteUser(u.id, u.email)}
                                    disabled={loading}
                                    className="btn-sm btn-danger"
                                  >
                                    Delete
                                  </button>
                                </div>
                              ) : (
                                <span className="small" style={{ color: 'var(--muted)' }}>You</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <footer className="admin-footer">
          Prodit · {BUILD_LABEL} · Admin Dashboard
        </footer>
      </div>
    </div>
  )
}
