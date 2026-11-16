/**
 * Business vertical persistence (hotels, education, salons, …).
 *
 * `BusinessProfile` carries `tenantId`; services, staff, FAQs, AI settings and
 * enquiries are guarded through the `business` relation. `BusinessAILog` is the
 * exception — its `businessId` column has no relation field in the schema, so
 * the guard uses the `scalarParent` strategy and rewrites reads to
 * `businessId IN (this tenant's business ids)`. That model was absent from the
 * old compat endpoint's isolation list entirely, so its AI logs were readable
 * across tenants.
 *
 * `BusinessAISettings` is `@unique` on `businessId`, so `upsert` works here —
 * unlike the healthcare equivalent, whose settings save always failed.
 */

import type { Prisma } from '@prisma/client';

import { scoped, type Page, type PaginationQuery, type TenantDb } from '../kernel';
import { BaseRepository } from './base.repository';

const contactSelect = { id: true, phone: true, name: true } satisfies Prisma.ContactSelect;

const businessSelect = {
  id: true,
  businessType: true,
  businessName: true,
  phone: true,
  whatsappNumber: true,
  email: true,
  website: true,
  address: true,
  city: true,
  state: true,
  pincode: true,
  googleMapLink: true,
  instagramUrl: true,
  facebookUrl: true,
  description: true,
  aiKnowledgeBase: true,
  institutionType: true,
  propertyType: true,
  workingHours: true,
  dateExceptions: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.BusinessProfileSelect;

const serviceSelect = {
  id: true,
  name: true,
  description: true,
  price: true,
  durationMinutes: true,
  category: true,
  isActive: true,
} satisfies Prisma.BusinessServiceSelect;

const staffSelect = {
  id: true,
  name: true,
  role: true,
  specialization: true,
  qualification: true,
  phone: true,
  isActive: true,
  extraInfo: true,
} satisfies Prisma.BusinessStaffSelect;

const faqSelect = {
  id: true,
  question: true,
  answer: true,
  keywords: true,
} satisfies Prisma.BusinessFAQSelect;

const aiSettingsSelect = {
  aiEnabled: true,
  aiTone: true,
  supportedLanguages: true,
  greetingMessage: true,
  afterHoursMessage: true,
  escalationKeywords: true,
  humanHandoverEnabled: true,
  inboundRoutingMode: true,
} satisfies Prisma.BusinessAISettingsSelect;

const enquirySelect = {
  id: true,
  enquiryType: true,
  preferredDate: true,
  preferredTime: true,
  notes: true,
  status: true,
  source: true,
  createdAt: true,
  contactName: true,
  contactPhone: true,
  contact: { select: contactSelect },
} satisfies Prisma.BusinessEnquirySelect;

export type BusinessProfileRow = Prisma.BusinessProfileGetPayload<{ select: typeof businessSelect }>;
export type BusinessServiceRow = Prisma.BusinessServiceGetPayload<{ select: typeof serviceSelect }>;
export type BusinessStaffRow = Prisma.BusinessStaffGetPayload<{ select: typeof staffSelect }>;
export type BusinessFaqRow = Prisma.BusinessFAQGetPayload<{ select: typeof faqSelect }>;
export type BusinessAiSettingsRow = Prisma.BusinessAISettingsGetPayload<{
  select: typeof aiSettingsSelect;
}>;
export type BusinessEnquiryRow = Prisma.BusinessEnquiryGetPayload<{ select: typeof enquirySelect }>;

export class BusinessRepository extends BaseRepository {
  protected readonly resourceName = 'Business profile';

  constructor(db: TenantDb) {
    super(db);
  }

  /** `BusinessProfile.userId` is `@unique`. */
  async find(): Promise<BusinessProfileRow | null> {
    return this.db.businessProfile.findFirst({ select: businessSelect });
  }

  async require(): Promise<BusinessProfileRow> {
    return this.requireFound(await this.find());
  }

  async upsert(input: {
    userId: string;
    businessType: string;
    data: Omit<Prisma.BusinessProfileUpdateManyMutationInput, 'tenantId' | 'userId'>;
  }): Promise<BusinessProfileRow> {
    const existing = await this.db.businessProfile.findFirst({ select: { id: true } });
    if (existing) {
      await this.db.businessProfile.updateMany({ where: { id: existing.id }, data: input.data });
      return this.require();
    }
    return this.db.businessProfile.create({
      data: scoped({
        userId: input.userId,
        businessType: input.businessType,
        ...input.data,
      } as Prisma.BusinessProfileUncheckedCreateInput),
      select: businessSelect,
    });
  }

  // ── services ──────────────────────────────────────────────────────

  async listServices(businessId: string, activeOnly = false): Promise<BusinessServiceRow[]> {
    return this.db.businessService.findMany({
      where: { businessId, ...(activeOnly ? { isActive: true } : {}) },
      select: serviceSelect,
      orderBy: { name: 'asc' },
    });
  }

  async createService(
    businessId: string,
    data: Omit<Prisma.BusinessServiceUncheckedCreateInput, 'businessId'>,
  ): Promise<BusinessServiceRow> {
    return this.db.businessService.create({ data: { ...data, businessId }, select: serviceSelect });
  }

  async updateService(
    businessId: string,
    serviceId: string,
    data: Prisma.BusinessServiceUpdateManyMutationInput,
  ): Promise<BusinessServiceRow> {
    this.requireAffected(
      await this.db.businessService.updateMany({ where: { id: serviceId, businessId }, data }),
    );
    return this.requireFound(
      await this.db.businessService.findFirst({
        where: { id: serviceId, businessId },
        select: serviceSelect,
      }),
    );
  }

  async deleteService(businessId: string, serviceId: string): Promise<void> {
    this.requireAffected(
      await this.db.businessService.deleteMany({ where: { id: serviceId, businessId } }),
    );
  }

  // ── staff ─────────────────────────────────────────────────────────

  async listStaff(businessId: string, activeOnly = false): Promise<BusinessStaffRow[]> {
    return this.db.businessStaff.findMany({
      where: { businessId, ...(activeOnly ? { isActive: true } : {}) },
      select: staffSelect,
      orderBy: { name: 'asc' },
    });
  }

  async createStaff(
    businessId: string,
    data: Omit<Prisma.BusinessStaffUncheckedCreateInput, 'businessId'>,
  ): Promise<BusinessStaffRow> {
    return this.db.businessStaff.create({ data: { ...data, businessId }, select: staffSelect });
  }

  async updateStaff(
    businessId: string,
    staffId: string,
    data: Prisma.BusinessStaffUpdateManyMutationInput,
  ): Promise<BusinessStaffRow> {
    this.requireAffected(
      await this.db.businessStaff.updateMany({ where: { id: staffId, businessId }, data }),
    );
    return this.requireFound(
      await this.db.businessStaff.findFirst({ where: { id: staffId, businessId }, select: staffSelect }),
    );
  }

  async deleteStaff(businessId: string, staffId: string): Promise<void> {
    this.requireAffected(
      await this.db.businessStaff.deleteMany({ where: { id: staffId, businessId } }),
    );
  }

  // ── FAQs ──────────────────────────────────────────────────────────

  async listFaqs(businessId: string): Promise<BusinessFaqRow[]> {
    return this.db.businessFAQ.findMany({
      where: { businessId },
      select: faqSelect,
      orderBy: { createdAt: 'asc' },
    });
  }

  async createFaq(
    businessId: string,
    data: { question: string; answer: string; keywords: string | null },
  ): Promise<BusinessFaqRow> {
    return this.db.businessFAQ.create({ data: { ...data, businessId }, select: faqSelect });
  }

  async updateFaq(
    businessId: string,
    faqId: string,
    data: Prisma.BusinessFAQUpdateManyMutationInput,
  ): Promise<BusinessFaqRow> {
    this.requireAffected(
      await this.db.businessFAQ.updateMany({ where: { id: faqId, businessId }, data }),
    );
    return this.requireFound(
      await this.db.businessFAQ.findFirst({ where: { id: faqId, businessId }, select: faqSelect }),
    );
  }

  async deleteFaq(businessId: string, faqId: string): Promise<void> {
    this.requireAffected(await this.db.businessFAQ.deleteMany({ where: { id: faqId, businessId } }));
  }

  async importFaqs(
    businessId: string,
    faqs: Array<{ question: string; answer: string; keywords: string | null }>,
    mode: 'append' | 'replace',
  ): Promise<number> {
    return this.db.$transaction(async (tx) => {
      if (mode === 'replace') {
        await tx.businessFAQ.deleteMany({ where: { businessId } });
      }
      const result = await tx.businessFAQ.createMany({
        data: faqs.map((faq) => ({ ...faq, businessId })),
      });
      return result.count;
    });
  }

  // ── AI settings ───────────────────────────────────────────────────

  async findAiSettings(businessId: string): Promise<BusinessAiSettingsRow | null> {
    return this.db.businessAISettings.findFirst({ where: { businessId }, select: aiSettingsSelect });
  }

  async upsertAiSettings(
    businessId: string,
    data: Omit<Prisma.BusinessAISettingsUncheckedCreateInput, 'businessId' | 'id'>,
  ): Promise<BusinessAiSettingsRow> {
    await this.db.businessAISettings.upsert({
      where: { businessId },
      create: { ...data, businessId },
      update: data,
      select: { id: true },
    });
    return this.requireFound(await this.findAiSettings(businessId));
  }

  // ── enquiries ─────────────────────────────────────────────────────

  async listEnquiries(
    businessId: string,
    pagination: PaginationQuery,
    status?: string,
  ): Promise<Page<BusinessEnquiryRow>> {
    const where: Prisma.BusinessEnquiryWhereInput = { businessId, ...(status ? { status } : {}) };
    return this.paginate(
      ({ skip, take }) =>
        this.db.businessEnquiry.findMany({
          where,
          select: enquirySelect,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          skip,
          take,
        }),
      () => this.db.businessEnquiry.count({ where }),
      pagination,
    );
  }

  async createEnquiry(
    businessId: string,
    data: Omit<Prisma.BusinessEnquiryUncheckedCreateInput, 'businessId'>,
  ): Promise<BusinessEnquiryRow> {
    return this.db.businessEnquiry.create({ data: { ...data, businessId }, select: enquirySelect });
  }

  async findEnquiry(businessId: string, enquiryId: string): Promise<BusinessEnquiryRow | null> {
    return this.db.businessEnquiry.findFirst({
      where: { id: enquiryId, businessId },
      select: enquirySelect,
    });
  }

  async setEnquiryStatus(
    businessId: string,
    enquiryId: string,
    status: string,
  ): Promise<BusinessEnquiryRow> {
    this.requireAffected(
      await this.db.businessEnquiry.updateMany({ where: { id: enquiryId, businessId }, data: { status } }),
    );
    return this.requireFound(
      await this.db.businessEnquiry.findFirst({
        where: { id: enquiryId, businessId },
        select: enquirySelect,
      }),
    );
  }

  // ── AI logs (scalarParent-guarded) ─────────────────────────────────

  /**
   * The guard rewrites `where` to `businessId IN (tenant's business ids)`, so
   * the explicit `businessId` here narrows within the tenant rather than
   * providing the isolation.
   */
  async listAiLogs(businessId: string, pagination: PaginationQuery) {
    const where: Prisma.BusinessAILogWhereInput = { businessId };
    return this.paginate(
      ({ skip, take }) =>
        this.db.businessAILog.findMany({
          where,
          select: {
            id: true,
            userMessage: true,
            aiResponse: true,
            detectedIntent: true,
            confidenceScore: true,
            createdAt: true,
            contact: { select: contactSelect },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          skip,
          take,
        }),
      () => this.db.businessAILog.count({ where }),
      pagination,
    );
  }

  async recordAiLog(input: {
    businessId: string;
    contactId: string | null;
    userMessage: string | null;
    aiResponse: string | null;
    detectedIntent: string | null;
    confidenceScore: number | null;
  }): Promise<void> {
    await this.db.businessAILog.create({ data: input });
  }

  async countAiLogs(businessId: string, since: Date): Promise<number> {
    return this.db.businessAILog.count({ where: { businessId, createdAt: { gte: since } } });
  }
}
