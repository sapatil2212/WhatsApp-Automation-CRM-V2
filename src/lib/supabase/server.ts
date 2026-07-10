/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from '@/lib/prisma'
import { cookies } from 'next/headers'
import { verifyAccessToken, rotateRefreshToken } from '@/lib/auth'

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

function toCamelCase(obj: any): any {
  if (obj === null || obj === undefined) return obj
  if (Array.isArray(obj)) return obj.map(toCamelCase)
  if (typeof obj !== 'object' || obj instanceof Date) return obj

  const newObj: any = {}
  for (const key of Object.keys(obj)) {
    const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
    newObj[camelKey] = toCamelCase(obj[key])
  }
  return newObj
}

function columnToCamel(col: string): string {
  return col.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
}

class ServerQueryBuilder {
  private table: string
  private modelName: string
  private method: 'select' | 'insert' | 'update' | 'delete' = 'select'
  private where: any = {}
  private payloadData: any = null
  private orderByField: string | null = null
  private orderAscending = true
  private limitCount: number | null = null
  private skipCount: number | null = null
  private singleRequested = false
  private countMode: string | null = null
  private isUpsert = false

  constructor(table: string) {
    this.table = table
    const modelMappings: Record<string, string> = {
      'flows': 'flow',
      'flow_nodes': 'flowNode',
      'flow_runs': 'flowRun',
      'flow_run_events': 'flowRunEvent',
      'messages': 'message',
      'conversations': 'conversation',
      'contact_tags': 'contactTag',
      'contacts': 'contact',
      'deals': 'deal',
      'pipelines': 'pipeline',
      'pipeline_stages': 'pipelineStage',
      'broadcasts': 'broadcast',
      'broadcast_recipients': 'broadcastRecipient',
      'automations': 'automation',
      'automation_steps': 'automationStep',
      'automation_logs': 'automationLog',
      'automation_pending_executions': 'automationPendingExecution',
      'profiles': 'profile',
      'whatsapp_config': 'whatsappConfig',
      'message_templates': 'messageTemplate',
      'clinics': 'clinic',
      'ai_settings': 'aISettings',
      'doctors': 'doctor',
      'clinic_timings': 'clinicTiming',
      'clinic_services': 'clinicService',
      'clinic_faqs': 'clinicFAQ',
      'appointments': 'appointment',
      'contact_notes': 'contactNote',
      'business_profiles': 'businessProfile',
      'portfolio_items': 'portfolioItem',
      'message_reactions': 'messageReaction'
    }
    this.modelName = modelMappings[table] || table
  }

  select(fields: string = '*', options?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean }) {
    this.method = 'select'
    if (options?.count) this.countMode = options.count
    if (options?.head) this.singleRequested = true
    return this
  }

  insert(data: any) {
    this.method = 'insert'
    this.payloadData = toCamelCase(data)
    return this
  }

  update(data: any) {
    this.method = 'update'
    this.payloadData = toCamelCase(data)
    return this
  }

  upsert(data: any, options?: { onConflict?: string }) {
    this.method = 'insert'
    this.payloadData = toCamelCase(data)
    this.isUpsert = true
    return this
  }

  delete() {
    this.method = 'delete'
    return this
  }

  eq(field: string, value: any) {
    const camelField = columnToCamel(field)
    this.where[camelField] = value
    return this
  }

  neq(field: string, value: any) {
    const camelField = columnToCamel(field)
    this.where[camelField] = { not: value }
    return this
  }

  in(field: string, values: any[]) {
    const camelField = columnToCamel(field)
    this.where[camelField] = { in: values }
    return this
  }

  gte(field: string, value: any) {
    const camelField = columnToCamel(field)
    this.where[camelField] = { gte: value instanceof Date ? value : new Date(value) }
    return this
  }

  lte(field: string, value: any) {
    const camelField = columnToCamel(field)
    this.where[camelField] = { lte: value instanceof Date ? value : new Date(value) }
    return this
  }

  ilike(field: string, pattern: string) {
    const cleanPattern = pattern.replace(/%/g, '')
    const camelField = columnToCamel(field)
    this.where[camelField] = { contains: cleanPattern, mode: 'insensitive' }
    return this
  }

  is(field: string, value: any) {
    return this.eq(field, value)
  }

  range(from: number, to: number) {
    this.skipCount = from
    this.limitCount = to - from + 1
    return this
  }

  order(field: string, options?: { ascending?: boolean }) {
    this.orderByField = columnToCamel(field)
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
    try {
      const cookieStore = await cookies()
      let accessToken = cookieStore.get('accessToken')?.value
      const refreshToken = cookieStore.get('refreshToken')?.value

      let payload = accessToken ? verifyAccessToken(accessToken) : null

      if (!payload && refreshToken) {
        const rotation = await rotateRefreshToken(refreshToken)
        if (rotation) {
          payload = rotation.user
        }
      }

      if (!payload) {
        return { data: null, error: { message: 'Unauthorized' } }
      }

      const profile = await prisma.profile.findUnique({
        where: { userId: payload.userId }
      })
      if (!profile || !profile.tenantId) {
        return { data: null, error: { message: 'Tenant context not found' } }
      }
      const tenantId = profile.tenantId

      const client = (prisma as any)[this.modelName]
      if (!client) {
        throw new Error(`Prisma model not found: ${this.modelName}`)
      }

      let result: any = null

      if (this.method === 'insert') {
        if (this.isUpsert) {
          if (Array.isArray(this.payloadData)) {
            const results = []
            for (const item of this.payloadData) {
              item.tenantId = tenantId
              if (this.modelName === 'contact' || this.modelName === 'conversation') {
                item.userId = payload.userId
              }
              
              let uniqueWhere: any = null
              if (this.modelName === 'messageReaction' && item.messageId && item.actorType) {
                uniqueWhere = {
                  messageId_actorType_actorId: {
                    messageId: item.messageId,
                    actorType: item.actorType,
                    actorId: item.actorId || ''
                  }
                }
              } else if (this.modelName === 'contactCustomValue' && item.contactId && item.customFieldId) {
                uniqueWhere = {
                  contactId_customFieldId: {
                    contactId: item.contactId,
                    customFieldId: item.customFieldId
                  }
                }
              } else if (item.id) {
                uniqueWhere = { id: item.id }
              }

              let resultItem = null
              if (uniqueWhere) {
                const existing = await client.findUnique({ where: uniqueWhere })
                if (existing) {
                  resultItem = await client.update({ where: uniqueWhere, data: item })
                }
              }

              if (!resultItem) {
                resultItem = await client.create({ data: item })
              }
              results.push(resultItem)
            }
            result = results
          } else {
            this.payloadData.tenantId = tenantId
            if (this.modelName === 'contact' || this.modelName === 'conversation') {
              this.payloadData.userId = payload.userId
            }
            
            let uniqueWhere: any = null
            if (this.modelName === 'messageReaction' && this.payloadData.messageId && this.payloadData.actorType) {
              uniqueWhere = {
                messageId_actorType_actorId: {
                  messageId: this.payloadData.messageId,
                  actorType: this.payloadData.actorType,
                  actorId: this.payloadData.actorId || ''
                }
              }
            } else if (this.modelName === 'contactCustomValue' && this.payloadData.contactId && this.payloadData.customFieldId) {
              uniqueWhere = {
                contactId_customFieldId: {
                  contactId: this.payloadData.contactId,
                  customFieldId: this.payloadData.customFieldId
                }
              }
            } else if (this.payloadData.id) {
              uniqueWhere = { id: this.payloadData.id }
            }

            if (uniqueWhere) {
              const existing = await client.findUnique({ where: uniqueWhere })
              if (existing) {
                result = await client.update({ where: uniqueWhere, data: this.payloadData })
              }
            }

            if (!result) {
              result = await client.create({ data: this.payloadData })
            }
          }
        } else {
          if (Array.isArray(this.payloadData)) {
            for (const item of this.payloadData) {
              item.tenantId = tenantId
              if (this.modelName === 'contact' || this.modelName === 'conversation') {
                item.userId = payload.userId
              }
            }
            await client.createMany({ data: this.payloadData })
            result = this.payloadData
          } else {
            this.payloadData.tenantId = tenantId
            if (this.modelName === 'contact' || this.modelName === 'conversation') {
              this.payloadData.userId = payload.userId
            }
            result = await client.create({ data: this.payloadData })
          }
        }
      } else if (this.method === 'update') {
        this.where.tenantId = tenantId
        const data = { ...this.payloadData }
        Object.keys(data).forEach(key => {
          if (data[key] === undefined) delete data[key]
        })

        await client.updateMany({
          where: this.where,
          data
        })
        result = [data]
      } else if (this.method === 'delete') {
        this.where.tenantId = tenantId
        await client.deleteMany({
          where: this.where
        })
        result = []
      } else {
        const isolatedModels = [
          'profile', 'tenantConfiguration', 'contact', 'tag', 'contactNote',
          'conversation', 'whatsappConfig', 'messageTemplate', 'pipeline',
          'deal', 'broadcast', 'automation', 'automationLog',
          'automationPendingExecution', 'flow', 'flowRun', 'clinic',
          'businessProfile', 'portfolioItem', 'messageReaction'
        ]

        if (isolatedModels.includes(this.modelName)) {
          this.where.tenantId = tenantId
        }

        if (this.countMode) {
          const count = await client.count({ where: this.where })
          return { count, data: [], error: null }
        }

        const orderBy = this.orderByField ? { [this.orderByField]: this.orderAscending ? 'asc' : 'desc' } : undefined

        result = await client.findMany({
          where: this.where,
          orderBy,
          take: this.limitCount || undefined,
          skip: this.skipCount || undefined
        })
      }

      let dataOut = toSnakeCase(result)
      if (this.singleRequested && Array.isArray(dataOut)) {
        dataOut = dataOut[0] || null
      }

      return { data: dataOut, error: null }
    } catch (err: any) {
      console.error('[ServerQueryBuilder] Error executing query:', err)
      return { data: null, error: { message: err.message || String(err) } }
    }
  }

  then(onfulfilled?: (value: any) => any, onrejected?: (reason: any) => any) {
    return this.execute().then(onfulfilled, onrejected)
  }
}

export async function createClient() {
  return {
    from: (table: string) => new ServerQueryBuilder(table),
    auth: {
      getSession: async () => {
        const cookieStore = await cookies()
        let accessToken = cookieStore.get('accessToken')?.value
        const refreshToken = cookieStore.get('refreshToken')?.value

        let payload = accessToken ? verifyAccessToken(accessToken) : null

        if (!payload && refreshToken) {
          const rotation = await rotateRefreshToken(refreshToken)
          if (rotation) {
            payload = rotation.user
          }
        }

        if (payload) {
          const u = { 
            ...payload, 
            id: payload.userId,
            created_at: (payload as any).createdAt || (payload as any).created_at
          }
          return { data: { session: { user: u } }, error: null }
        }
        return { data: { session: null }, error: null }
      },
      getUser: async () => {
        const cookieStore = await cookies()
        let accessToken = cookieStore.get('accessToken')?.value
        const refreshToken = cookieStore.get('refreshToken')?.value

        let payload = accessToken ? verifyAccessToken(accessToken) : null

        if (!payload && refreshToken) {
          const rotation = await rotateRefreshToken(refreshToken)
          if (rotation) {
            payload = rotation.user
          }
        }

        if (payload) {
          const u = { 
            ...payload, 
            id: payload.userId,
            created_at: (payload as any).createdAt || (payload as any).created_at
          }
          return { data: { user: u }, error: null }
        }
        return { data: { user: null }, error: null }
      },
      exchangeCodeForSession: async (code: string) => {
        return { data: { session: null }, error: null }
      },
      signInWithPassword: async (credentials: any) => {
        return { data: { user: null, session: null }, error: new Error('signInWithPassword is client-side only') }
      },
      updateUser: async (attributes: any) => {
        return { data: { user: null }, error: new Error('updateUser is client-side only') }
      }
    }
  }
}

export async function createServerClient() {
  return createClient()
}
