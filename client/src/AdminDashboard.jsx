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
    <div>
      <header>
        <div className="header-inner">
          <div className="title">Prodit Admin <span className="build-badge">{BUILD_LABEL}</span></div>
          <div className="toolbar">
            <label className="switch">
              <input id="theme-toggle" type="checkbox" checked={theme==='dark'} onChange={toggleTheme} />
              <span className="track"><span className="thumb"></span></span>
              <label htmlFor="theme-toggle" className="small">{theme==='dark' ? 'Dark' : 'Light'}</label>
            </label>

            <span className="small">{user.email}</span>
            <button onClick={handleLogout}>Logout</button>
          </div>
        </div>
      </header>

      <div className="container">
        <h2>Admin Dashboard</h2>
        {message && <p className="message" style={{ marginBottom: '1rem' }}>{message}</p>}

        {/* Xero Connection Section */}
        <div className="table-card" style={{ marginBottom: '2rem' }}>
          <h3 style={{ margin: '0 0 1rem 0' }}>System Xero Connection</h3>
          {xeroStatus.connected ? (
            <div>
              <p><strong>Status:</strong> Connected</p>
              <p><strong>Organization:</strong> {xeroStatus.tenantName}</p>
              <p><strong>Tenant ID:</strong> {xeroStatus.tenantId}</p>
              <p><strong>Last Synced:</strong> {xeroStatus.lastSynced ? new Date(xeroStatus.lastSynced).toLocaleString() : 'N/A'}</p>
              <div style={{ marginTop: '1rem' }}>
                <button onClick={disconnectXero} disabled={loading}>Disconnect Xero</button>
                <a href="/auth/xero" className="btn-link" style={{ marginLeft: '1rem' }}>Reconnect Xero</a>
              </div>
            </div>
          ) : (
            <div>
              <p>No Xero connection configured. Users will not be able to access the system until you connect Xero.</p>
              <a href="/auth/xero" className="btn-primary">Connect Xero Organization</a>
            </div>
          )}
        </div>

        {/* User Management Section */}
        <div className="table-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ margin: 0 }}>User Management</h3>
            <button className="primary" onClick={() => setShowCreateUser(!showCreateUser)}>
              {showCreateUser ? 'Cancel' : 'Create New User'}
            </button>
          </div>

          {showCreateUser && (
            <div style={{ background: 'var(--bg-secondary)', padding: '1rem', borderRadius: '4px', marginBottom: '1rem' }}>
              <form onSubmit={handleCreateUser}>
                <h4 style={{ marginTop: 0 }}>Create New User</h4>
                <div style={{ display: 'grid', gap: '0.5rem' }}>
                  <input type="email" name="email" placeholder="Email" required />
                  <input type="text" name="fullName" placeholder="Full Name (optional)" />
                  <input type="password" name="password" placeholder="Password (min 8 characters)" required minLength={8} />
                </div>
                <div style={{ marginTop: '1rem' }}>
                  <button type="submit" className="primary" disabled={loading}>Create User</button>
                </div>
              </form>
            </div>
          )}

          {users.length === 0 ? (
            <p>No users found.</p>
          ) : (
            <table>
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
                    <td>{u.is_admin ? <span className="badge">Admin</span> : 'User'}</td>
                    <td>{new Date(u.created_at).toLocaleDateString()}</td>
                    <td>{u.last_login ? new Date(u.last_login).toLocaleDateString() : 'Never'}</td>
                    <td>
                      {u.id !== user.id && (
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button
                            onClick={() => toggleUserStatus(u.id, u.is_active)}
                            disabled={loading}
                            style={{ fontSize: '0.85rem', padding: '0.25rem 0.5rem' }}
                          >
                            {u.is_active ? 'Deactivate' : 'Activate'}
                          </button>
                          <button
                            onClick={() => deleteUser(u.id, u.email)}
                            disabled={loading}
                            style={{ fontSize: '0.85rem', padding: '0.25rem 0.5rem', background: '#dc3545' }}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                      {u.id === user.id && <span className="small">You</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <footer className="footer-note">Prodit · {BUILD_LABEL} · Admin Dashboard</footer>
    </div>
  )
}
