/* eslint-disable @typescript-eslint/no-explicit-any */
import { prisma } from '@/lib/prisma'

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

class PrismaQueryBuilder {
  private modelName: string
  private where: any = {}
  private orderBy: any = undefined
  private take: number | undefined = undefined
  private isInsert = false
  private isUpdate = false
  private isDelete = false
  private dataToSave: any = null
  private countOptions: any = null

  constructor(table: string) {
    const modelMappings: Record<string, string> = {
      'automations': 'automation',
      'automation_steps': 'automationStep',
      'automation_logs': 'automationLog',
      'automation_pending_executions': 'automationPendingExecution',
      'messages': 'message',
      'conversations': 'conversation',
      'contact_tags': 'contactTag',
      'contacts': 'contact',
    }
    this.modelName = modelMappings[table] || table
  }

  select(fields: string = '*', options?: any) {
    if (options?.count) {
      this.countOptions = options
    }
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

  order(field: string, options?: { ascending?: boolean }) {
    const camelField = columnToCamel(field)
    this.orderBy = { [camelField]: options?.ascending ?? true ? 'asc' : 'desc' }
    return this
  }

  limit(count: number) {
    this.take = count
    return this
  }

  insert(data: any) {
    this.isInsert = true
    this.dataToSave = toCamelCase(data)
    return this
  }

  update(data: any) {
    this.isUpdate = true
    this.dataToSave = toCamelCase(data)
    return this
  }

  delete() {
    this.isDelete = true
    return this
  }

  async execute() {
    const client = (prisma as any)[this.modelName]
    if (!client) {
      throw new Error(`Prisma model not found: ${this.modelName}`)
    }

    let result: any = null

    if (this.isInsert) {
      if (Array.isArray(this.dataToSave)) {
        for (const item of this.dataToSave) {
          await this.injectTenantId(item)
        }
        await client.createMany({ data: this.dataToSave })
        result = this.dataToSave
      } else {
        await this.injectTenantId(this.dataToSave)
        result = await client.create({ data: this.dataToSave })
      }
    } else if (this.isUpdate) {
      const updateData = { ...this.dataToSave }
      Object.keys(updateData).forEach(key => {
        if (updateData[key] === undefined) delete updateData[key]
      })

      await client.updateMany({
        where: this.where,
        data: updateData
      })
      result = [updateData]
    } else if (this.isDelete) {
      result = await client.deleteMany({
        where: this.where
      })
    } else {
      if (this.countOptions) {
        const count = await client.count({ where: this.where })
        return { count, data: [] }
      }

      result = await client.findMany({
        where: this.where,
        orderBy: this.orderBy,
        take: this.take
      })
    }

    return toSnakeCase(result)
  }

  private async injectTenantId(item: any) {
    const clientFields = prisma[this.modelName as keyof typeof prisma] as any
    if (clientFields && ['automation', 'automationStep', 'automationLog', 'automationPendingExecution', 'contact', 'conversation'].includes(this.modelName)) {
      if (item.tenantId) return
      
      let userId = item.userId
      if (!userId && item.automationId) {
        const aut = await prisma.automation.findUnique({ where: { id: item.automationId }, select: { userId: true } })
        userId = aut?.userId
      }
      if (!userId && item.conversationId) {
        const conv = await prisma.conversation.findUnique({ where: { id: item.conversationId }, select: { userId: true } })
        userId = conv?.userId
      }

      if (userId) {
        const profile = await prisma.profile.findUnique({ where: { userId }, select: { tenantId: true } })
        if (profile?.tenantId) {
          item.tenantId = profile.tenantId
        }
      }
    }
  }

  async then(resolve: any, reject: any) {
    try {
      const data = await this.execute()
      if (data && typeof data === 'object' && 'count' in data) {
        resolve({ data: data.data, count: data.count, error: null })
      } else {
        resolve({ data, error: null })
      }
    } catch (err: any) {
      console.error('[PrismaSupabaseCompat] Error executing query:', err)
      resolve({ data: null, error: err })
    }
  }

  maybeSingle() {
    const originalThen = this.then.bind(this)
    this.then = async (resolve: any, reject: any) => {
      await originalThen((res: any) => {
        if (res.data && Array.isArray(res.data)) {
          resolve({ data: res.data[0] || null, error: res.error })
        } else {
          resolve(res)
        }
      }, reject)
    }
    return this
  }

  single() {
    return this.maybeSingle()
  }
}

export function supabaseAdmin(): any {
  return {
    from: (table: string) => new PrismaQueryBuilder(table),
    rpc: async (functionName: string, args: any) => {
      if (functionName === 'increment_automation_execution_count') {
        try {
          await prisma.automation.update({
            where: { id: args.automation_id },
            data: {
              executionCount: { increment: 1 },
              lastExecutedAt: new Date()
            }
          })
          return { error: null }
        } catch (err: any) {
          return { error: err }
        }
      }
      return { error: new Error(`RPC function not emulated: ${functionName}`) }
    }
  }
}
