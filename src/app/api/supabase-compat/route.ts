/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { cookies } from 'next/headers'
import { verifyAccessToken, rotateRefreshToken } from '@/lib/auth'

function toSnakeCase(obj: any): any {
  if (obj === null || obj === undefined) return obj
  if (Array.isArray(obj)) return obj.map(toSnakeCase)
  if (obj && obj.constructor && obj.constructor.name === 'Decimal') {
    return Number(obj.toString())
  }
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
  if (obj && obj.constructor && obj.constructor.name === 'Decimal') {
    return Number(obj.toString())
  }
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

export async function POST(req: NextRequest) {
  try {
    const { table, method, filters, data, order, limit, countMode, single, isUpsert, range } = await req.json()

    // 1. Authenticate user from session cookies
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
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // 2. Resolve tenantId
    const profile = await prisma.profile.findUnique({
      where: { userId: payload.userId }
    })
    if (!profile || !profile.tenantId) {
      return NextResponse.json({ error: 'Tenant context not found' }, { status: 403 })
    }
    const tenantId = profile.tenantId

    // 3. Map table name to Prisma model name
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
      'tags': 'tag',
      'custom_fields': 'customField',
      'contact_custom_values': 'contactCustomValue',
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
      'business_services': 'businessService',
      'business_staff': 'businessStaff',
      'business_faqs': 'businessFAQ',
      'business_ai_settings': 'businessAISettings',
      'business_enquiries': 'businessEnquiry',
      'business_ai_logs': 'businessAILog',
      'portfolio_items': 'portfolioItem',
      'message_reactions': 'messageReaction'
    }
    const modelName = modelMappings[table] || table

    const client = (prisma as any)[modelName]
    if (!client) {
      return NextResponse.json({ error: `Prisma model not found: ${modelName}` }, { status: 400 })
    }

    // 4. Build filters where clause
    const where: any = {}
    const camelData = toCamelCase(data)

    const isolatedModels = [
      'profile', 'tenantConfiguration', 'contact', 'tag', 'contactNote',
      'conversation', 'whatsappConfig', 'messageTemplate', 'pipeline',
      'deal', 'broadcast', 'automation', 'automationLog',
      'automationPendingExecution', 'flow', 'flowRun', 'clinic',
      'businessProfile', 'portfolioItem'
    ]

    if (isolatedModels.includes(modelName)) {
      where.tenantId = tenantId
    }

    if (filters && Array.isArray(filters)) {
      for (const filter of filters) {
        const camelField = columnToCamel(filter.field)
        if (filter.type === 'eq') {
          where[camelField] = filter.value
        } else if (filter.type === 'neq') {
          where[camelField] = { not: filter.value }
        } else if (filter.type === 'in') {
          where[camelField] = { in: filter.value }
        } else if (filter.type === 'gte') {
          where[camelField] = { gte: filter.value instanceof Date ? filter.value : new Date(filter.value) }
        } else if (filter.type === 'lte') {
          where[camelField] = { lte: filter.value instanceof Date ? filter.value : new Date(filter.value) }
        } else if (filter.type === 'ilike') {
          where[camelField] = { contains: filter.value, mode: 'insensitive' }
        } else if (filter.type === 'or') {
          const parts = filter.value.split(',')
          const orConditions = parts.map((part: string) => {
            const dotParts = part.split('.')
            const field = dotParts[0]
            const op = dotParts[1]
            const val = dotParts.slice(2).join('.') // handle values that contain dots if any
            const camelF = columnToCamel(field)
            if (op === 'ilike') {
              const cleanVal = val.replace(/%/g, '')
              return { [camelF]: { contains: cleanVal, mode: 'insensitive' } }
            } else if (op === 'eq') {
              return { [camelF]: val }
            } else if (op === 'is' && val === 'null') {
              return { [camelF]: null }
            }
            return {}
          })
          where.OR = orConditions
        }
      }
    }

    let result: any = null
    let count: number | null = null

    // 5. Execute method
    if (method === 'insert') {
      if (isUpsert) {
        if (Array.isArray(camelData)) {
          const results = []
          for (const item of camelData) {
            if (isolatedModels.includes(modelName)) {
              item.tenantId = tenantId
            }
            if (modelName === 'contact' || modelName === 'conversation' || modelName === 'businessProfile') {
              item.userId = payload.userId
            }
            
            let uniqueWhere: any = null
            if (modelName === 'messageReaction' && item.messageId && item.actorType) {
              uniqueWhere = {
                messageId_actorType_actorId: {
                  messageId: item.messageId,
                  actorType: item.actorType,
                  actorId: item.actorId || ''
                }
              }
            } else if (modelName === 'contactCustomValue' && item.contactId && item.customFieldId) {
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
          // Single item upsert
          if (isolatedModels.includes(modelName)) {
            camelData.tenantId = tenantId
          }
          if (modelName === 'contact' || modelName === 'conversation' || modelName === 'businessProfile') {
            camelData.userId = payload.userId
          }

          let uniqueWhere: any = null
          if (modelName === 'messageReaction' && camelData.messageId && camelData.actorType) {
            uniqueWhere = {
              messageId_actorType_actorId: {
                messageId: camelData.messageId,
                actorType: camelData.actorType,
                actorId: camelData.actorId || ''
              }
            }
          } else if (modelName === 'contactCustomValue' && camelData.contactId && camelData.customFieldId) {
            uniqueWhere = {
              contactId_customFieldId: {
                contactId: camelData.contactId,
                customFieldId: camelData.customFieldId
              }
            }
          } else if (camelData.id) {
            uniqueWhere = { id: camelData.id }
          }

          if (uniqueWhere) {
            const existing = await client.findUnique({ where: uniqueWhere })
            if (existing) {
              result = await client.update({ where: uniqueWhere, data: camelData })
            }
          }

          if (!result) {
            result = await client.create({ data: camelData })
          }

          if (modelName === 'businessProfile' && camelData.businessName !== undefined) {
            await prisma.profile.update({
              where: { userId: payload.userId },
              data: { businessName: camelData.businessName }
            }).catch(() => {})

            await prisma.tenant.updateMany({
              where: { ownerUserId: payload.userId },
              data: { name: camelData.businessName || 'My Organization' }
            }).catch(() => {})
          }
        }
      } else {
        // Standard insert
        if (Array.isArray(camelData)) {
          for (const item of camelData) {
            if (isolatedModels.includes(modelName)) {
              item.tenantId = tenantId
            }
            if (modelName === 'contact' || modelName === 'conversation' || modelName === 'businessProfile') {
              item.userId = payload.userId
            }
          }
          await client.createMany({ data: camelData })
          result = camelData
        } else {
          if (isolatedModels.includes(modelName)) {
            camelData.tenantId = tenantId
          }
          if (modelName === 'contact' || modelName === 'conversation' || modelName === 'businessProfile') {
            camelData.userId = payload.userId
          }
          result = await client.create({ data: camelData })

          if (modelName === 'businessProfile' && camelData.businessName !== undefined) {
            await prisma.profile.update({
              where: { userId: payload.userId },
              data: { businessName: camelData.businessName }
            }).catch(() => {})

            await prisma.tenant.updateMany({
              where: { ownerUserId: payload.userId },
              data: { name: camelData.businessName || 'My Organization' }
            }).catch(() => {})
          }
        }
      }
    } else if (method === 'update') {
      // Clean undefined fields
      const updateData = { ...camelData }
      Object.keys(updateData).forEach(key => {
        if (updateData[key] === undefined) delete updateData[key]
      })

      await client.updateMany({
        where,
        data: updateData
      })

      if (modelName === 'businessProfile' && updateData.businessName !== undefined) {
        await prisma.profile.update({
          where: { userId: payload.userId },
          data: { businessName: updateData.businessName }
        }).catch(() => {})

        await prisma.tenant.updateMany({
          where: { ownerUserId: payload.userId },
          data: { name: updateData.businessName || 'My Organization' }
        }).catch(() => {})
      }

      result = [updateData]
    } else if (method === 'delete') {
      await client.deleteMany({
        where
      })
      result = []
    } else {
      // Select
      if (countMode) {
        count = await client.count({ where })
      }

      const orderBy = order ? { [columnToCamel(order.field)]: order.ascending ? 'asc' : 'desc' } : undefined

      let take = limit || undefined
      let skip = undefined
      if (range) {
        take = range.to - range.from + 1
        skip = range.from
      }

      result = await client.findMany({
        where,
        orderBy,
        take,
        skip
      })
    }

    let dataOut = toSnakeCase(result)
    if (single && Array.isArray(dataOut)) {
      dataOut = dataOut[0] || null
    }

    console.log(`[DEBUG supabase-compat] table=${table} method=${method} resultCount=${Array.isArray(result) ? result.length : result ? 1 : 0} count=${count} dataOutType=${typeof dataOut} isArray=${Array.isArray(dataOut)}`)

    return NextResponse.json({ data: dataOut, error: null, count })

  } catch (error: any) {
    console.error('[Supabase Compat Endpoint] Error:', error)
    return NextResponse.json({ error: error.message || String(error) }, { status: 500 })
  }
}
