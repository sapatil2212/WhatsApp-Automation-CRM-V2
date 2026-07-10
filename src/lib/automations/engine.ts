/* eslint-disable @typescript-eslint/no-explicit-any */
import type { AutomationTriggerType } from '@/types'
import { prisma } from '@/lib/prisma'
import { engineSendText, engineSendTemplate } from './meta-send'

// ------------------------------------------------------------
// Public API
// ------------------------------------------------------------

export interface AutomationContext {
  message_text?: string
  conversation_id?: string
  vars?: Record<string, unknown>
  tag_id?: string
  agent_id?: string
}

export interface DispatchInput {
  userId: string
  triggerType: AutomationTriggerType
  contactId?: string | null
  context?: AutomationContext
}

export async function runAutomationsForTrigger(input: DispatchInput): Promise<void> {
  try {
    const automations = await prisma.automation.findMany({
      where: {
        userId: input.userId,
        triggerType: input.triggerType,
        isActive: true
      }
    })

    if (!automations || automations.length === 0) return

    for (const automation of automations) {
      if (!triggerMatches(automation, input.context || {})) continue
      try {
        await executeAutomation(automation, input)
      } catch (err) {
        console.error('[automations] execute failed:', automation.id, err)
      }
    }
  } catch (err) {
    console.error('[automations] dispatch failed:', err)
  }
}

export async function resumePendingExecution(pending: {
  id: string
  automation_id: string
  user_id: string
  contact_id: string | null
  log_id: string | null
  parent_step_id: string | null
  branch: 'yes' | 'no' | null
  next_step_position: number
  context: AutomationContext
}): Promise<void> {
  try {
    const automation = await prisma.automation.findUnique({
      where: { id: pending.automation_id }
    })

    if (!automation) {
      console.warn('[automations] resume failed: automation not found', pending.automation_id)
      return
    }

    const input: DispatchInput = {
      userId: pending.user_id,
      triggerType: automation.triggerType as AutomationTriggerType,
      contactId: pending.contact_id,
      context: pending.context,
    }

    await executeAutomation(automation, input, {
      logId: pending.log_id,
      parentStepId: pending.parent_step_id,
      branch: pending.branch,
      startAtPosition: pending.next_step_position,
    })
  } catch (err) {
    console.error('[automations] resume execution failed:', err)
  } finally {
    await prisma.automationPendingExecution.deleteMany({
      where: { id: pending.id }
    }).catch(() => {})
  }
}

// ------------------------------------------------------------
// Execution Core
// ------------------------------------------------------------

interface ResumeState {
  logId: string | null
  parentStepId: string | null
  branch: 'yes' | 'no' | null
  startAtPosition: number
}

async function executeAutomation(
  automation: any,
  input: DispatchInput,
  resume?: ResumeState,
): Promise<void> {
  const userId = input.userId
  const contactId = input.contactId ?? null
  const context = input.context ?? {}

  const profile = await prisma.profile.findUnique({
    where: { userId }
  })
  if (!profile || !profile.tenantId) {
    throw new Error('Tenant configuration not found for user profile')
  }
  const tenantId = profile.tenantId

  let logId = resume?.logId ?? null
  const stepsExecuted: any[] = []

  if (logId) {
    const log = await prisma.automationLog.findUnique({
      where: { id: logId }
    })
    if (log && log.stepsExecuted) {
      stepsExecuted.push(...(log.stepsExecuted as any))
    }
  } else {
    const log = await prisma.automationLog.create({
      data: {
        tenantId,
        automationId: automation.id,
        userId,
        contactId,
        triggerEvent: input.triggerType,
        stepsExecuted: [] as any,
        status: 'success',
      }
    })
    logId = log.id
  }

  await prisma.automation.update({
    where: { id: automation.id },
    data: {
      executionCount: { increment: 1 },
      lastExecutedAt: new Date(),
    }
  })

  const steps = await prisma.automationStep.findMany({
    where: { automationId: automation.id },
    orderBy: { position: 'asc' }
  })

  const stepsByParent = new Map<string, any[]>()
  steps.forEach((s) => {
    const pId = s.parentStepId || 'root'
    const arr = stepsByParent.get(pId) ?? []
    arr.push(s)
    stepsByParent.set(pId, arr)
  })

  let currentParentId: string | null = resume?.parentStepId ?? null
  let currentBranch: 'yes' | 'no' | null = resume?.branch ?? null
  let startIdx = resume?.startAtPosition ?? 0

  while (logId) {
    const siblings = (stepsByParent.get(currentParentId || 'root') ?? []).filter(
      (s) => s.branch === currentBranch,
    )

    if (startIdx >= siblings.length) {
      if (!currentParentId) break
      
      const parent = steps.find((s) => s.id === currentParentId)
      if (!parent) break

      currentParentId = parent.parentStepId ?? null
      currentBranch = parent.branch as 'yes' | 'no' | null
      startIdx = parent.position + 1
      continue
    }

    const step = siblings[startIdx]
    const stepResult: any = {
      step_id: step.id,
      step_type: step.stepType,
      status: 'success',
    }

    try {
      if (step.stepType === 'send_message') {
        const cfg = step.stepConfig as any
        const convId = context.conversation_id || (await resolveConversationId(userId, contactId))
        if (!convId) throw new Error('no conversation found for contact')
        await engineSendText({
          userId,
          conversationId: convId,
          contactId: contactId!,
          text: cfg.text,
        })
      } else if (step.stepType === 'send_template') {
        const cfg = step.stepConfig as any
        const convId = context.conversation_id || (await resolveConversationId(userId, contactId))
        if (!convId) throw new Error('no conversation found for contact')
        await engineSendTemplate({
          userId,
          conversationId: convId,
          contactId: contactId!,
          templateName: cfg.template_name,
          language: cfg.language,
          params: cfg.params,
        })
      } else if (step.stepType === 'send_webhook') {
        const cfg = step.stepConfig as any
        await fetch(cfg.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            automation_id: automation.id,
            step_id: step.id,
            contact_id: contactId,
            context,
          }),
        })
      } else if (step.stepType === 'add_tag') {
        const cfg = step.stepConfig as any
        if (!contactId) throw new Error('no contact in execution context')
        const hasTag = await prisma.contactTag.findFirst({
          where: { contactId, tagId: cfg.tag_id }
        })
        if (!hasTag) {
          await prisma.contactTag.create({
            data: { contactId, tagId: cfg.tag_id }
          })
        }
      } else if (step.stepType === 'remove_tag') {
        const cfg = step.stepConfig as any
        if (!contactId) throw new Error('no contact in execution context')
        await prisma.contactTag.deleteMany({
          where: { contactId, tagId: cfg.tag_id }
        })
      } else if (step.stepType === 'update_contact_field') {
        const cfg = step.stepConfig as any
        if (!contactId) throw new Error('no contact in execution context')
        if (cfg.field_source === 'built_in') {
          await prisma.contact.update({
            where: { id: contactId },
            data: { [cfg.field_name]: cfg.field_value, updatedAt: new Date() }
          })
        } else {
          await prisma.contactCustomValue.upsert({
            where: {
              contactId_customFieldId: {
                contactId,
                customFieldId: cfg.custom_field_id
              }
            },
            create: {
              contactId,
              customFieldId: cfg.custom_field_id,
              value: cfg.field_value
            },
            update: {
              value: cfg.field_value
            }
          })
        }
      } else if (step.stepType === 'create_deal') {
        const cfg = step.stepConfig as any
        if (!contactId) throw new Error('no contact in execution context')
        const convId = context.conversation_id || (await resolveConversationId(userId, contactId))
        await prisma.deal.create({
          data: {
            tenantId,
            userId,
            pipelineId: cfg.pipeline_id,
            stageId: cfg.stage_id,
            contactId,
            conversationId: convId,
            title: cfg.deal_title || 'New Deal',
            value: cfg.deal_value ? Number(cfg.deal_value) : 0,
            currency: 'USD',
            status: 'active'
          }
        })
      } else if (step.stepType === 'assign_conversation') {
        const cfg = step.stepConfig as any
        const convId = context.conversation_id || (await resolveConversationId(userId, contactId))
        if (!convId) throw new Error('no conversation found for contact')
        await prisma.conversation.update({
          where: { id: convId },
          data: {
            assignedAgentId: cfg.agent_id,
            updatedAt: new Date()
          }
        })
      } else if (step.stepType === 'wait') {
        const cfg = step.stepConfig as any
        const waitMs = cfg.duration * (cfg.unit === 'minutes' ? 60 : cfg.unit === 'hours' ? 3600 : 86400) * 1000
        
        await prisma.automationPendingExecution.create({
          data: {
            tenantId,
            automationId: automation.id,
            userId,
            contactId,
            logId,
            parentStepId: step.id,
            branch: step.branch,
            nextStepPosition: startIdx + 1,
            context: context as any,
            runAt: new Date(Date.now() + waitMs),
          }
        })
        
        stepResult.status = 'parked'
        stepsExecuted.push(stepResult)
        await saveExecutionProgress(logId, stepsExecuted, 'success')
        return
      } else if (step.stepType === 'condition') {
        const cfg = step.stepConfig as any
        const passes = await evaluateCondition(cfg, contactId, context)
        stepResult.branch_chosen = passes ? 'yes' : 'no'
        
        currentParentId = step.id
        currentBranch = passes ? 'yes' : 'no'
        startIdx = 0
        stepsExecuted.push(stepResult)
        continue
      }
    } catch (err: any) {
      stepResult.status = 'failed'
      stepResult.error = err.message || String(err)
      stepsExecuted.push(stepResult)
      
      await saveExecutionProgress(logId, stepsExecuted, 'failed')
      throw err
    }

    stepsExecuted.push(stepResult)
    startIdx += 1
  }

  if (logId) {
    await saveExecutionProgress(logId, stepsExecuted, 'success')
  }
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

function triggerMatches(automation: any, ctx: AutomationContext): boolean {
  if (automation.triggerType === 'keyword_match' || automation.trigger_type === 'keyword_match') {
    const cfg = (automation.triggerConfig || automation.trigger_config) as any
    const msg = (ctx.message_text ?? '').toLowerCase().trim()
    if (!msg) return false

    if (cfg.matchType === 'exact') {
      return cfg.keywords.some((kw: string) => msg === kw.toLowerCase().trim())
    }
    return cfg.keywords.some((kw: string) => {
      const escaped = kw.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'i').test(msg)
    })
  }
  return true
}

async function resolveConversationId(userId: string, contactId: string | null): Promise<string | null> {
  if (!contactId) return null
  const conv = await prisma.conversation.findFirst({
    where: { userId, contactId },
    select: { id: true }
  })
  return conv?.id ?? null
}

async function evaluateCondition(
  cfg: any,
  contactId: string | null,
  context: AutomationContext,
): Promise<boolean> {
  if (!contactId) return false

  if (cfg.condition_type === 'tag') {
    const count = await prisma.contactTag.count({
      where: { contactId, tagId: cfg.tag_id }
    })
    const hasTag = count > 0
    return cfg.operator === 'has' ? hasTag : !hasTag
  }

  if (cfg.condition_type === 'message_content') {
    const msg = (context.message_text ?? '').toLowerCase()
    const kw = (cfg.operand || '').toLowerCase()
    const match = msg.includes(kw)
    return cfg.operator === 'contains' ? match : !match
  }

  if (cfg.condition_type === 'contact_field') {
    const contact = (await prisma.contact.findUnique({
      where: { id: contactId }
    })) as any

    if (!contact) return false

    let value = ''
    if (cfg.field_source === 'built_in') {
      value = String(contact[cfg.operand] ?? '')
    } else {
      const valRow = await prisma.contactCustomValue.findUnique({
        where: {
          contactId_customFieldId: {
            contactId,
            customFieldId: cfg.custom_field_id!
          }
        }
      })
      value = valRow?.value ?? ''
    }

    const testValue = cfg.field_value || ''
    switch (cfg.operator) {
      case 'equals':
        return value.toLowerCase() === testValue.toLowerCase()
      case 'not_equals':
        return value.toLowerCase() !== testValue.toLowerCase()
      case 'contains':
        return value.toLowerCase().includes(testValue.toLowerCase())
      case 'not_contains':
        return !value.toLowerCase().includes(testValue.toLowerCase())
      default:
        return false
    }
  }

  return false
}

async function saveExecutionProgress(
  logId: string,
  steps: any[],
  fallbackStatus: 'success' | 'failed',
): Promise<void> {
  const hasFailure = steps.some((s) => s.status === 'failed')
  const status = hasFailure ? 'failed' : fallbackStatus

  const errStep = steps.find((s) => s.status === 'failed')
  const errorMessage = errStep?.error ?? null

  await prisma.automationLog.update({
    where: { id: logId },
    data: {
      stepsExecuted: steps,
      status,
      errorMessage,
    }
  })
}
