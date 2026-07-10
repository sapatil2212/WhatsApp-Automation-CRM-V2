/* eslint-disable @typescript-eslint/no-explicit-any */
import { getSocket } from '@/lib/socket'

function toSnakeCase(obj: any): any {
  if (obj === null || obj === undefined) return obj
  if (Array.isArray(obj)) return obj.map(toSnakeCase)
  if (typeof obj !== 'object' || obj instanceof Date) return obj

  const newObj: any = {}
  for (const key of Object.keys(obj)) {
    const snakeKey = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
    newObj[snakeKey] = toSnakeCase(obj[key])
  }
  return newObj
}

class SupabaseCompatBuilder {
  private table: string
  private method: 'select' | 'insert' | 'update' | 'delete' = 'select'
  private filters: Array<{ type: string; field: string; value: any }> = []
  private payloadData: any = null
  private orderByField: string | null = null
  private orderAscending = true
  private limitCount: number | null = null
  private singleRequested = false
  private countMode: string | null = null
  private isUpsert = false
  private rangeObj: { from: number; to: number } | null = null

  constructor(table: string) {
    this.table = table
  }

  select(fields: string = '*', options?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean }) {
    // Only switch to 'select' if no mutation method (insert/update/delete) was already set.
    // Chaining .select() after .insert()/.update() in Supabase means "return the result",
    // NOT "switch to a select query".
    if (this.method === 'select') {
      this.method = 'select'
    }
    if (options?.count) {
      this.countMode = options.count
    }
    if (options?.head) {
      this.singleRequested = true
    }
    return this
  }

  insert(data: any) {
    this.method = 'insert'
    this.payloadData = data
    return this
  }

  update(data: any) {
    this.method = 'update'
    this.payloadData = data
    return this
  }

  upsert(data: any, options?: { onConflict?: string }) {
    this.method = 'insert'
    this.payloadData = data
    this.isUpsert = true
    return this
  }

  delete() {
    this.method = 'delete'
    return this
  }

  eq(field: string, value: any) {
    this.filters.push({ type: 'eq', field, value })
    return this
  }

  neq(field: string, value: any) {
    this.filters.push({ type: 'neq', field, value })
    return this
  }

  in(field: string, values: any[]) {
    this.filters.push({ type: 'in', field, value: values })
    return this
  }

  gte(field: string, value: any) {
    this.filters.push({ type: 'gte', field, value })
    return this
  }

  lte(field: string, value: any) {
    this.filters.push({ type: 'lte', field, value })
    return this
  }

  ilike(field: string, pattern: string) {
    const cleanPattern = pattern.replace(/%/g, '')
    this.filters.push({ type: 'ilike', field, value: cleanPattern })
    return this
  }

  or(filters: string) {
    this.filters.push({ type: 'or', field: '', value: filters })
    return this
  }

  is(field: string, value: any) {
    return this.eq(field, value)
  }

  range(from: number, to: number) {
    this.rangeObj = { from, to }
    return this
  }

  order(field: string, options?: { ascending?: boolean }) {
    this.orderByField = field
    this.orderAscending = options?.ascending ?? true
    return this
  }

  limit(count: number) {
    this.limitCount = count
    return this
  }

  maybeSingle() {
    this.singleRequested = true
    return this
  }

  single() {
    this.singleRequested = true
    return this
  }

  async execute() {
    const payload = {
      table: this.table,
      method: this.method,
      filters: this.filters,
      data: this.payloadData,
      order: this.orderByField ? { field: this.orderByField, ascending: this.orderAscending } : null,
      limit: this.limitCount,
      countMode: this.countMode,
      single: this.singleRequested,
      isUpsert: this.isUpsert,
      range: this.rangeObj
    }

    console.log('[DEBUG compat-client] execute payload:', JSON.stringify(payload))

    const res = await fetch('/api/supabase-compat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })

    if (!res.ok) {
      const err = await res.json()
      console.log('[DEBUG compat-client] error response:', JSON.stringify(err))
      return { data: null, error: err, count: null }
    }

    const result = await res.json()
    console.log('[DEBUG compat-client] success response:', JSON.stringify({ dataLength: Array.isArray(result.data) ? result.data.length : result.data ? 1 : 0, count: result.count, hasError: !!result.error }))
    return result
  }

  then(onfulfilled?: (value: any) => any, onrejected?: (reason: any) => any) {
    return this.execute().then(onfulfilled, onrejected)
  }
}

class MockRealtimeChannel {
  private channelName: string
  private listeners: Array<{ table: string; callback: (payload: any) => void }> = []

  constructor(channelName: string) {
    this.channelName = channelName
  }

  on(type: string, filter: { event: string; schema: string; table: string; filter?: string }, callback: (payload: any) => void) {
    this.listeners.push({ table: filter.table, callback })
    return this
  }

  subscribe(callback?: (status: string) => void) {
    const socket = getSocket()
    if (!socket.connected) {
      socket.connect()
    }

    const handleMessage = (event: any) => {
      const payload = {
        eventType: event.eventType,
        new: toSnakeCase(event.new),
        old: toSnakeCase(event.old)
      }
      this.listeners
        .filter(l => l.table === 'messages')
        .forEach(l => l.callback(payload))
    }

    const handleConversation = (event: any) => {
      const payload = {
        eventType: event.eventType,
        new: toSnakeCase(event.new),
        old: toSnakeCase(event.old)
      }
      this.listeners
        .filter(l => l.table === 'conversations')
        .forEach(l => l.callback(payload))
    }

    socket.on('message', handleMessage)
    socket.on('conversation', handleConversation)

    setTimeout(() => {
      if (callback) callback('SUBSCRIBED')
    }, 100)

    return this
  }
}

export function createClient() {
  return {
    from: (table: string) => new SupabaseCompatBuilder(table),
    channel: (name: string) => new MockRealtimeChannel(name),
    removeChannel: (channel: any) => {
      // Handled by client cleanup
    },
    auth: {
      getSession: async () => {
        try {
          const res = await fetch('/api/auth/session')
          if (res.ok) {
            const data = await res.json()
            if (data.user) {
              const u = { 
                ...data.user, 
                id: data.user.userId || data.user.id,
                created_at: data.user.createdAt || data.user.created_at
              }
              return { data: { session: { user: u } }, error: null }
            }
          }
          return { data: { session: null }, error: null }
        } catch (err: any) {
          return { data: { session: null }, error: err }
        }
      },
      getUser: async () => {
        try {
          const res = await fetch('/api/auth/session')
          if (res.ok) {
            const data = await res.json()
            if (data.user) {
              const u = { 
                ...data.user, 
                id: data.user.userId || data.user.id,
                created_at: data.user.createdAt || data.user.created_at
              }
              return { data: { user: u }, error: null }
            }
          }
          return { data: { user: null }, error: null }
        } catch (err: any) {
          return { data: { user: null }, error: err }
        }
      },
      signOut: async (options?: any) => {
        await fetch('/api/auth/logout', { method: 'POST' })
        window.location.href = '/login'
        return { error: null as any }
      },
      signUp: async (credentials: any) => {
        try {
          const res = await fetch('/api/auth/signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: credentials.email,
              password: credentials.password,
              fullName: credentials.options?.data?.full_name || '',
              businessType: credentials.options?.data?.business_category || '',
              phoneNumber: credentials.options?.data?.phone_number || '',
              selectedPlan: credentials.options?.data?.selected_plan || 'starter'
            })
          })
          if (res.ok) {
            const data = await res.json()
            return { data: { user: data.user, session: null }, error: null }
          }
          const err = await res.json()
          return { data: { user: null, session: null }, error: { message: err.error || 'Signup failed' } }
        } catch (err: any) {
          return { data: { user: null, session: null }, error: err }
        }
      },
      verifyOtp: async (params: { email: string; token: string; type: string }) => {
        try {
          const res = await fetch('/api/auth/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: params.email,
              code: params.token
            })
          })
          if (res.ok) {
            const data = await res.json()
            return { data: { user: data.user, session: { user: data.user } }, error: null }
          }
          const err = await res.json()
          return { data: { user: null, session: null }, error: { message: err.error || 'Verification failed' } }
        } catch (err: any) {
          return { data: { user: null, session: null }, error: err }
        }
      },
      onAuthStateChange: (callback: any) => {
        return { data: { subscription: { unsubscribe: () => {} } } }
      },
      exchangeCodeForSession: async (code: string) => {
        return { data: { session: null }, error: null }
      },
      signInWithPassword: async (credentials: any) => {
        try {
          const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: credentials.email, password: credentials.password })
          })
          if (res.ok) {
            const data = await res.json()
            return { data: { user: data.user, session: { user: data.user } }, error: null }
          }
          const err = await res.json()
          return { data: { user: null, session: null }, error: { message: err.error || 'Login failed' } }
        } catch (err: any) {
          return { data: { user: null, session: null }, error: err }
        }
      },
      updateUser: async (attributes: any) => {
        try {
          const res = await fetch('/api/auth/update-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: attributes.email,
              password: attributes.password,
              currentPassword: attributes.currentPassword
            })
          })
          if (res.ok) {
            return { data: { user: null }, error: null }
          }
          const err = await res.json()
          return { data: { user: null }, error: { message: err.error || 'Update failed' } }
        } catch (err: any) {
          return { data: { user: null }, error: err }
        }
      }
    }
  }
}
