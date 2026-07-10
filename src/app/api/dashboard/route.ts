import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { cookies } from 'next/headers'
import { verifyAccessToken, rotateRefreshToken } from '@/lib/auth'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const type = searchParams.get('type')

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

    // Resolve tenantId
    const profile = await prisma.profile.findUnique({
      where: { userId: payload.userId }
    })

    if (!profile || !profile.tenantId) {
      return NextResponse.json({ error: 'Tenant context not found' }, { status: 403 })
    }
    const tenantId = profile.tenantId

    if (type === 'metrics') {
      const todayStart = new Date()
      todayStart.setHours(0, 0, 0, 0)

      const yesterdayStart = new Date(todayStart)
      yesterdayStart.setDate(yesterdayStart.getDate() - 1)

      const [
        openConvCur,
        newConvToday,
        newConvYesterday,
        newContactsToday,
        newContactsYesterday,
        openDealsRows,
        messagesToday,
        messagesYesterday,
      ] = await Promise.all([
        prisma.conversation.count({ where: { tenantId, status: 'open' } }),
        prisma.conversation.count({ where: { tenantId, status: 'open', createdAt: { gte: todayStart } } }),
        prisma.conversation.count({ where: { tenantId, status: 'open', createdAt: { gte: yesterdayStart, lt: todayStart } } }),
        prisma.contact.count({ where: { tenantId, createdAt: { gte: todayStart } } }),
        prisma.contact.count({ where: { tenantId, createdAt: { gte: yesterdayStart, lt: todayStart } } }),
        prisma.deal.findMany({ where: { tenantId, status: 'open' }, select: { value: true } }),
        prisma.message.count({ where: { conversation: { tenantId }, senderType: 'agent', createdAt: { gte: todayStart } } }),
        prisma.message.count({ where: { conversation: { tenantId }, senderType: 'agent', createdAt: { gte: yesterdayStart, lt: todayStart } } }),
      ])

      const openDealsValue = openDealsRows.reduce((sum, d) => sum + Number(d.value || 0), 0)

      return NextResponse.json({
        activeConversations: {
          current: openConvCur,
          previous: newConvToday - newConvYesterday,
        },
        newContactsToday: {
          current: newContactsToday,
          previous: newContactsYesterday,
        },
        openDealsValue,
        openDealsCount: openDealsRows.length,
        messagesSentToday: {
          current: messagesToday,
          previous: messagesYesterday,
        },
      })
    }

    if (type === 'series') {
      const rangeDays = Number(searchParams.get('range') || '30')
      const startDate = new Date()
      startDate.setDate(startDate.getDate() - (rangeDays - 1))
      startDate.setHours(0, 0, 0, 0)

      const messages = await prisma.message.findMany({
        where: {
          conversation: { tenantId },
          createdAt: { gte: startDate }
        },
        select: { createdAt: true, senderType: true },
        orderBy: { createdAt: 'asc' }
      })

      // Formulate buckets
      const keys: string[] = []
      const buckets = new Map<string, { incoming: number; outgoing: number }>()

      for (let i = rangeDays - 1; i >= 0; i--) {
        const d = new Date()
        d.setDate(d.getDate() - i)
        const key = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        keys.push(key)
        buckets.set(key, { incoming: 0, outgoing: 0 })
      }

      for (const msg of messages) {
        const key = msg.createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        const bucket = buckets.get(key)
        if (!bucket) continue
        if (msg.senderType === 'customer') {
          bucket.incoming += 1
        } else {
          bucket.outgoing += 1
        }
      }

      const points = keys.map(day => ({
        day,
        ...(buckets.get(day) ?? { incoming: 0, outgoing: 0 })
      }))

      return NextResponse.json(points)
    }

    if (type === 'donut') {
      const [stages, deals] = await Promise.all([
        prisma.pipelineStage.findMany({
          where: { pipeline: { tenantId } },
          select: { id: true, name: true, color: true },
          orderBy: { position: 'asc' }
        }),
        prisma.deal.findMany({
          where: { tenantId, status: 'open' },
          select: { stageId: true, value: true }
        })
      ])

      const byStage = new Map<string, { count: number; total: number }>()
      for (const d of deals) {
        const row = byStage.get(d.stageId) ?? { count: 0, total: 0 }
        row.count += 1
        row.total += Number(d.value || 0)
        byStage.set(d.stageId, row)
      }

      const slices = stages
        .map((s) => ({
          id: s.id,
          name: s.name,
          color: s.color || '#64748b',
          dealCount: byStage.get(s.id)?.count ?? 0,
          totalValue: byStage.get(s.id)?.total ?? 0,
        }))
        .filter((s) => s.totalValue > 0 || s.dealCount > 0)

      return NextResponse.json({
        stages: slices,
        totalValue: slices.reduce((sum, s) => sum + s.totalValue, 0),
      })
    }

    if (type === 'response') {
      const fourteenDaysAgo = new Date()
      fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 13)
      fourteenDaysAgo.setHours(0, 0, 0, 0)

      const messages = await prisma.message.findMany({
        where: {
          conversation: { tenantId },
          createdAt: { gte: fourteenDaysAgo }
        },
        select: { conversationId: true, senderType: true, createdAt: true },
        orderBy: [
          { conversationId: 'asc' },
          { createdAt: 'asc' }
        ]
      })

      interface Sample {
        customerAt: Date
        responseAt: Date
      }
      const samples: Sample[] = []

      let currentConv = ''
      let pendingCustomer: Date | null = null
      for (const msg of messages) {
        if (msg.conversationId !== currentConv) {
          currentConv = msg.conversationId
          pendingCustomer = null
        }
        if (msg.senderType === 'customer') {
          if (!pendingCustomer) pendingCustomer = msg.createdAt
        } else if (pendingCustomer) {
          samples.push({ customerAt: pendingCustomer, responseAt: msg.createdAt })
          pendingCustomer = null
        }
      }

      const now = new Date()
      // Local week calculations helper
      const getMonday = (d: Date) => {
        const date = new Date(d)
        const day = date.getDay()
        const diff = date.getDate() - day + (day === 0 ? -6 : 1)
        return new Date(date.setDate(diff))
      }
      
      const thisWeekStart = getMonday(now)
      thisWeekStart.setHours(0,0,0,0)
      const lastWeekStart = new Date(thisWeekStart)
      lastWeekStart.setDate(lastWeekStart.getDate() - 7)

      const byDow = new Map<number, number[]>()
      for (let i = 0; i < 7; i++) byDow.set(i, [])
      const thisWeekMins: number[] = []
      const lastWeekMins: number[] = []

      for (const s of samples) {
        const diffMin = (s.responseAt.getTime() - s.customerAt.getTime()) / 60_000
        if (diffMin < 0) continue
        const dow = (s.customerAt.getDay() + 6) % 7 // Monday-first index
        byDow.get(dow)!.push(diffMin)
        if (s.customerAt >= thisWeekStart) {
          thisWeekMins.push(diffMin)
        } else if (s.customerAt >= lastWeekStart && s.customerAt < thisWeekStart) {
          lastWeekMins.push(diffMin)
        }
      }

      const avg = (arr: number[]) =>
        arr.length === 0 ? null : arr.reduce((a, b) => a + b, 0) / arr.length

      const buckets = Array.from({ length: 7 }, (_, dow) => {
        const dowSamples = byDow.get(dow) ?? []
        return {
          dow,
          avgMinutes: avg(dowSamples),
          samples: dowSamples.length,
        }
      })

      return NextResponse.json({
        buckets,
        thisWeekAvg: avg(thisWeekMins),
        lastWeekAvg: avg(lastWeekMins),
      })
    }

    if (type === 'activity') {
      const limit = Number(searchParams.get('limit') || '20')

      const [msgs, contacts, deals, broadcasts, autoLogs] = await Promise.all([
        prisma.message.findMany({
          where: { conversation: { tenantId }, senderType: 'customer' },
          select: { id: true, contentText: true, createdAt: true, conversationId: true, conversation: { select: { contact: { select: { name: true, phone: true } } } } },
          orderBy: { createdAt: 'desc' },
          take: 10
        }),
        prisma.contact.findMany({
          where: { tenantId },
          select: { id: true, name: true, phone: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 10
        }),
        prisma.deal.findMany({
          where: { tenantId },
          select: { id: true, title: true, updatedAt: true, stage: { select: { name: true } } },
          orderBy: { updatedAt: 'desc' },
          take: 10
        }),
        prisma.broadcast.findMany({
          where: { tenantId },
          select: { id: true, name: true, status: true, totalRecipients: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 5
        }),
        prisma.automationLog.findMany({
          where: { tenantId },
          select: { id: true, triggerEvent: true, status: true, createdAt: true, automation: { select: { name: true } }, contact: { select: { name: true, phone: true } } },
          orderBy: { createdAt: 'desc' },
          take: 10
        })
      ])

      const items: any[] = []

      for (const m of msgs) {
        const who = m.conversation?.contact?.name || m.conversation?.contact?.phone || 'Unknown'
        items.push({
          id: `msg-${m.id}`,
          kind: 'message',
          text: `New message from ${who}`,
          at: m.createdAt.toISOString(),
          href: `/inbox?c=${m.conversationId}`,
        })
      }

      for (const c of contacts) {
        items.push({
          id: `contact-${c.id}`,
          kind: 'contact',
          text: `New contact: ${c.name || c.phone}`,
          at: c.createdAt.toISOString(),
          href: '/contacts',
        })
      }

      for (const d of deals) {
        items.push({
          id: `deal-${d.id}`,
          kind: 'deal',
          text: d.stage?.name
            ? `Deal "${d.title}" in ${d.stage.name}`
            : `Deal "${d.title}" updated`,
          at: d.updatedAt.toISOString(),
          href: '/pipelines',
        })
      }

      for (const b of broadcasts) {
        const label = b.status === 'sent'
          ? `sent to ${b.totalRecipients} contacts`
          : `${b.status} (${b.totalRecipients} recipients)`
        items.push({
          id: `broadcast-${b.id}`,
          kind: 'broadcast',
          text: `Broadcast "${b.name}" ${label}`,
          at: b.createdAt.toISOString(),
          href: '/campaigns',
        })
      }

      for (const l of autoLogs) {
        const who = l.contact?.name || l.contact?.phone || 'a contact'
        const autoName = l.automation?.name || 'Automation'
        items.push({
          id: `auto-${l.id}`,
          kind: 'automation',
          text: `Automation "${autoName}" ${l.status === 'failed' ? 'failed for' : 'triggered for'} ${who}`,
          at: l.createdAt.toISOString(),
        })
      }

      const sorted = items
        .sort((a, b) => (a.at > b.at ? -1 : a.at < b.at ? 1 : 0))
        .slice(0, limit)

      return NextResponse.json(sorted)
    }

    return NextResponse.json({ error: 'Invalid dashboard type query' }, { status: 400 })

  } catch (error: any) {
    console.error('Dashboard GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
