import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

/**
 * Creates a scoped Prisma client that enforces tenant isolation.
 * Automatically injects the tenantId into where filters and data writes.
 */
export function getTenantPrisma(tenantId: string) {
  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          // List of models that have a tenantId field and should be isolated
          const isolatedModels = [
            'Profile',
            'TenantConfiguration',
            'Contact',
            'Tag',
            'ContactNote',
            'Conversation',
            'WhatsappConfig',
            'MessageTemplate',
            'Pipeline',
            'Deal',
            'Broadcast',
            'Automation',
            'AutomationLog',
            'AutomationPendingExecution',
            'Flow',
            'FlowRun',
            'Clinic',
            'BusinessProfile',
            'PortfolioItem'
          ]

          if (isolatedModels.includes(model)) {
            // Read operations
            if (['findFirst', 'findMany', 'count', 'findFirstOrThrow', 'aggregate', 'groupBy'].includes(operation)) {
              const anyArgs = args as any
              anyArgs.where = { ...anyArgs.where, tenantId }
            }
            // Update / Delete operations
            else if (['update', 'updateMany', 'delete', 'deleteMany'].includes(operation)) {
              const anyArgs = args as any
              anyArgs.where = { ...anyArgs.where, tenantId }
            }
            // Create operations
            else if (operation === 'create') {
              const anyArgs = args as any
              anyArgs.data = { ...anyArgs.data, tenantId }
            }
            // Upsert operations
            else if (operation === 'upsert') {
              const anyArgs = args as any
              anyArgs.create = { ...anyArgs.create, tenantId }
              anyArgs.update = { ...anyArgs.update, tenantId }
            }
          }
          return query(args)
        },
      },
    },
  })
}
export type TenantPrismaClient = ReturnType<typeof getTenantPrisma>
