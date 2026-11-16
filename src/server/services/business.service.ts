/**
 * Business vertical configuration and enquiry rules.
 *
 * Mirrors `ClinicConfigService` for every non-healthcare segment. The two are
 * deliberately kept structurally parallel — same method names, same DTO field
 * names where the concepts match — so the Phase 2 consolidation is a merge
 * rather than a rewrite.
 */

import { ConflictError, NotFoundError, ValidationError, type Page, type TenantDb } from '../kernel';
import {
  toBusinessAiLogDto,
  toBusinessAiSettingsDto,
  toBusinessEnquiryDto,
  toBusinessFaqDto,
  toBusinessProfileDto,
  toBusinessServiceDto,
  toBusinessStaffDto,
  type BusinessAiLogDto,
  type BusinessAiSettingsDto,
  type BusinessEnquiryDto,
  type BusinessFaqDto,
  type BusinessProfileDto,
  type BusinessServiceDto,
  type BusinessSetupDto,
  type BusinessStaffDto,
} from '../dtos/business.dto';
import { BusinessRepository } from '../repositories/business.repository';
import { ContactRepository } from '../repositories/contact.repository';
import type {
  CreateEnquiryBody,
  ImportBusinessFaqsBody,
  ListEnquiriesQuery,
  SetEnquiryStatusBody,
  UpsertBusinessAiSettingsBody,
  UpsertBusinessBody,
  UpsertBusinessFaqBody,
  UpsertBusinessServiceBody,
  UpsertBusinessStaffBody,
} from '../validators/business.validator';

export interface BusinessServiceDeps {
  businesses: BusinessRepository;
  contacts: Pick<ContactRepository, 'exists'>;
}

export class BusinessConfigService {
  constructor(
    private readonly deps: BusinessServiceDeps,
    private readonly userId: string,
  ) {}

  static create(db: TenantDb, userId: string): BusinessConfigService {
    return new BusinessConfigService(
      { businesses: new BusinessRepository(db), contacts: new ContactRepository(db) },
      userId,
    );
  }

  private async requireBusiness(): Promise<{ id: string }> {
    const business = await this.deps.businesses.find();
    if (!business) {
      throw new NotFoundError('Business profile', {
        details: { hint: 'Complete the business setup step first.' },
      });
    }
    return business;
  }

  async get(): Promise<BusinessProfileDto | null> {
    const business = await this.deps.businesses.find();
    return business ? toBusinessProfileDto(business) : null;
  }

  async getSetup(): Promise<BusinessSetupDto> {
    const business = await this.deps.businesses.require();
    const [services, staff, faqs, aiSettings] = await Promise.all([
      this.deps.businesses.listServices(business.id),
      this.deps.businesses.listStaff(business.id),
      this.deps.businesses.listFaqs(business.id),
      this.deps.businesses.findAiSettings(business.id),
    ]);

    return {
      business: toBusinessProfileDto(business),
      services: services.map(toBusinessServiceDto),
      staff: staff.map(toBusinessStaffDto),
      faqs: faqs.map(toBusinessFaqDto),
      aiSettings: aiSettings ? toBusinessAiSettingsDto(aiSettings) : null,
    };
  }

  async upsert(body: UpsertBusinessBody): Promise<BusinessProfileDto> {
    const { businessType, ...rest } = body;
    return toBusinessProfileDto(
      await this.deps.businesses.upsert({ userId: this.userId, businessType, data: rest }),
    );
  }

  // ── services ──────────────────────────────────────────────────────

  async listServices(activeOnly = false): Promise<BusinessServiceDto[]> {
    const business = await this.requireBusiness();
    return (await this.deps.businesses.listServices(business.id, activeOnly)).map(toBusinessServiceDto);
  }

  async createService(body: UpsertBusinessServiceBody): Promise<BusinessServiceDto> {
    const business = await this.requireBusiness();
    return toBusinessServiceDto(
      await this.deps.businesses.createService(business.id, {
        name: body.name,
        description: body.description,
        price: body.price ?? null,
        durationMinutes: body.durationMinutes ?? null,
        category: body.category,
        isActive: body.isActive,
      }),
    );
  }

  async updateService(serviceId: string, body: UpsertBusinessServiceBody): Promise<BusinessServiceDto> {
    const business = await this.requireBusiness();
    return toBusinessServiceDto(
      await this.deps.businesses.updateService(business.id, serviceId, {
        name: body.name,
        description: body.description,
        price: body.price ?? null,
        durationMinutes: body.durationMinutes ?? null,
        category: body.category,
        isActive: body.isActive,
      }),
    );
  }

  async deleteService(serviceId: string): Promise<void> {
    const business = await this.requireBusiness();
    await this.deps.businesses.deleteService(business.id, serviceId);
  }

  // ── staff ─────────────────────────────────────────────────────────

  async listStaff(activeOnly = false): Promise<BusinessStaffDto[]> {
    const business = await this.requireBusiness();
    return (await this.deps.businesses.listStaff(business.id, activeOnly)).map(toBusinessStaffDto);
  }

  async createStaff(body: UpsertBusinessStaffBody): Promise<BusinessStaffDto> {
    const business = await this.requireBusiness();
    return toBusinessStaffDto(
      await this.deps.businesses.createStaff(business.id, {
        name: body.name,
        role: body.role,
        specialization: body.specialization,
        qualification: body.qualification,
        phone: body.phone,
        isActive: body.isActive,
      }),
    );
  }

  async updateStaff(staffId: string, body: UpsertBusinessStaffBody): Promise<BusinessStaffDto> {
    const business = await this.requireBusiness();
    return toBusinessStaffDto(
      await this.deps.businesses.updateStaff(business.id, staffId, {
        name: body.name,
        role: body.role,
        specialization: body.specialization,
        qualification: body.qualification,
        phone: body.phone,
        isActive: body.isActive,
      }),
    );
  }

  async deleteStaff(staffId: string): Promise<void> {
    const business = await this.requireBusiness();
    await this.deps.businesses.deleteStaff(business.id, staffId);
  }

  // ── FAQs ──────────────────────────────────────────────────────────

  async listFaqs(): Promise<BusinessFaqDto[]> {
    const business = await this.requireBusiness();
    return (await this.deps.businesses.listFaqs(business.id)).map(toBusinessFaqDto);
  }

  async createFaq(body: UpsertBusinessFaqBody): Promise<BusinessFaqDto> {
    const business = await this.requireBusiness();
    return toBusinessFaqDto(
      await this.deps.businesses.createFaq(business.id, {
        question: body.question,
        answer: body.answer,
        keywords: serialiseKeywords(body.keywords),
      }),
    );
  }

  async updateFaq(faqId: string, body: UpsertBusinessFaqBody): Promise<BusinessFaqDto> {
    const business = await this.requireBusiness();
    return toBusinessFaqDto(
      await this.deps.businesses.updateFaq(business.id, faqId, {
        question: body.question,
        answer: body.answer,
        keywords: serialiseKeywords(body.keywords),
      }),
    );
  }

  async deleteFaq(faqId: string): Promise<void> {
    const business = await this.requireBusiness();
    await this.deps.businesses.deleteFaq(business.id, faqId);
  }

  async importFaqs(body: ImportBusinessFaqsBody): Promise<{ imported: number; mode: string }> {
    const business = await this.requireBusiness();
    const imported = await this.deps.businesses.importFaqs(
      business.id,
      body.faqs.map((faq) => ({
        question: faq.question,
        answer: faq.answer,
        keywords: serialiseKeywords(faq.keywords),
      })),
      body.mode,
    );
    return { imported, mode: body.mode };
  }

  // ── AI settings ───────────────────────────────────────────────────

  async getAiSettings(): Promise<BusinessAiSettingsDto | null> {
    const business = await this.requireBusiness();
    const settings = await this.deps.businesses.findAiSettings(business.id);
    return settings ? toBusinessAiSettingsDto(settings) : null;
  }

  async upsertAiSettings(body: UpsertBusinessAiSettingsBody): Promise<BusinessAiSettingsDto> {
    const business = await this.requireBusiness();

    // Same invariant as the clinic: keywords with handover off do nothing, so a
    // customer asking for a human would be silently ignored.
    if (body.escalationKeywords.length > 0 && !body.humanHandoverEnabled) {
      throw new ValidationError(
        'Escalation keywords require human handover to be enabled, otherwise they have no effect.',
        { details: { field: 'humanHandoverEnabled' } },
      );
    }

    return toBusinessAiSettingsDto(
      await this.deps.businesses.upsertAiSettings(business.id, {
        aiEnabled: body.aiEnabled,
        aiTone: body.aiTone,
        supportedLanguages: body.supportedLanguages,
        greetingMessage: body.greetingMessage,
        afterHoursMessage: body.afterHoursMessage,
        escalationKeywords: body.escalationKeywords,
        humanHandoverEnabled: body.humanHandoverEnabled,
        inboundRoutingMode: body.inboundRoutingMode,
      }),
    );
  }

  // ── enquiries ─────────────────────────────────────────────────────

  async listEnquiries(query: ListEnquiriesQuery): Promise<Page<BusinessEnquiryDto>> {
    const business = await this.requireBusiness();
    const page = await this.deps.businesses.listEnquiries(
      business.id,
      { page: query.page, pageSize: query.pageSize },
      query.status,
    );
    return { ...page, items: page.items.map(toBusinessEnquiryDto) };
  }

  async createEnquiry(body: CreateEnquiryBody): Promise<BusinessEnquiryDto> {
    const business = await this.requireBusiness();

    if (body.contactId && !(await this.deps.contacts.exists(body.contactId))) {
      throw new NotFoundError('Contact');
    }

    return toBusinessEnquiryDto(
      await this.deps.businesses.createEnquiry(business.id, {
        contactId: body.contactId ?? null,
        contactName: body.contactName,
        contactPhone: body.contactPhone,
        enquiryType: body.enquiryType,
        preferredDate: body.preferredDate ?? null,
        preferredTime: body.preferredTime ?? null,
        notes: body.notes,
        status: 'pending',
        source: 'whatsapp',
      }),
    );
  }

  /**
   * `confirmed` and `cancelled` are terminal — reopening one would misrepresent
   * an enquiry the customer has already been answered about.
   */
  async setEnquiryStatus(enquiryId: string, body: SetEnquiryStatusBody): Promise<BusinessEnquiryDto> {
    const business = await this.requireBusiness();

    const existing = await this.deps.businesses.findEnquiry(business.id, enquiryId);
    if (!existing) throw new NotFoundError('Enquiry');

    const current = toBusinessEnquiryDto(existing).status;
    if (current === body.status) {
      return toBusinessEnquiryDto(existing);
    }
    if (current !== 'pending') {
      throw new ConflictError(`A ${current} enquiry can no longer change status.`, {
        details: { from: current, to: body.status },
      });
    }

    return toBusinessEnquiryDto(
      await this.deps.businesses.setEnquiryStatus(business.id, enquiryId, body.status),
    );
  }

  // ── AI logs ───────────────────────────────────────────────────────

  async listAiLogs(page: number, pageSize: number): Promise<Page<BusinessAiLogDto>> {
    const business = await this.requireBusiness();
    const result = await this.deps.businesses.listAiLogs(business.id, { page, pageSize });
    return { ...result, items: result.items.map(toBusinessAiLogDto) };
  }
}

/** Commas would corrupt the comma-separated column, so they are stripped. */
function serialiseKeywords(keywords: string[]): string | null {
  const cleaned = keywords
    .map((keyword) => keyword.replace(/,/g, ' ').trim())
    .filter((keyword) => keyword.length > 0);
  return cleaned.length > 0 ? cleaned.join(',') : null;
}
