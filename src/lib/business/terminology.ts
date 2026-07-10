export interface BusinessTerminology {
  segment: string;
  businessNameLabel: string;
  businessSetupLabel: string;
  staffLabel: string;
  staffPluralLabel: string;
  serviceLabel: string;
  servicePluralLabel: string;
  bookingLabel: string;
  bookingPluralLabel: string;
  dashboardTitle: string;
  clientLabel: string;
  clientPluralLabel: string;
  specializationLabel: string;
}

export const SEGMENTS: Record<string, BusinessTerminology> = {
  beauty: {
    segment: "beauty",
    businessNameLabel: "Salon / Spa Name",
    businessSetupLabel: "Salon Setup",
    staffLabel: "Stylist / Beautician",
    staffPluralLabel: "Stylists & Beauticians",
    serviceLabel: "Salon Service",
    servicePluralLabel: "Salon Services",
    bookingLabel: "Salon Booking",
    bookingPluralLabel: "Salon Bookings",
    dashboardTitle: "Salon Booking & Automation Dashboard",
    clientLabel: "Customer",
    clientPluralLabel: "Customers",
    specializationLabel: "Specialty (e.g. Hair, Nails, Makeup)",
  },
  wellness: {
    segment: "wellness",
    businessNameLabel: "Wellness Center Name",
    businessSetupLabel: "Center Setup",
    staffLabel: "Trainer / Coach",
    staffPluralLabel: "Trainers & Coaches",
    serviceLabel: "Class / Service",
    servicePluralLabel: "Classes & Services",
    bookingLabel: "Class Booking",
    bookingPluralLabel: "Class Bookings",
    dashboardTitle: "Wellness Booking & Automation Dashboard",
    clientLabel: "Member",
    clientPluralLabel: "Members",
    specializationLabel: "Specialization (e.g. Yoga, Nutrition)",
  },
  trades: {
    segment: "trades",
    businessNameLabel: "Company Name",
    businessSetupLabel: "Business Setup",
    staffLabel: "Technician / Worker",
    staffPluralLabel: "Technicians & Staff",
    serviceLabel: "Job Type / Service",
    servicePluralLabel: "Services Offered",
    bookingLabel: "Job Booking",
    bookingPluralLabel: "Job Bookings",
    dashboardTitle: "Jobs Booking & Automation Dashboard",
    clientLabel: "Customer",
    clientPluralLabel: "Customers",
    specializationLabel: "Role / Trade (e.g. Electrician, Plumber)",
  },
  professional: {
    segment: "professional",
    businessNameLabel: "Firm Name",
    businessSetupLabel: "Practice Setup",
    staffLabel: "Consultant / Expert",
    staffPluralLabel: "Consultants & Experts",
    serviceLabel: "Service Offered",
    servicePluralLabel: "Services Offered",
    bookingLabel: "Consultation",
    bookingPluralLabel: "Consultation Bookings",
    dashboardTitle: "Consultation Booking & Automation Dashboard",
    clientLabel: "Client",
    clientPluralLabel: "Clients",
    specializationLabel: "Area of Expertise (e.g. Tax, Legal)",
  },
  automotive: {
    segment: "automotive",
    businessNameLabel: "Garage / Shop Name",
    businessSetupLabel: "Garage Setup",
    staffLabel: "Mechanic / Technician",
    staffPluralLabel: "Mechanics & Technicians",
    serviceLabel: "Service / Repair",
    servicePluralLabel: "Services Offered",
    bookingLabel: "Service Booking",
    bookingPluralLabel: "Service Bookings",
    dashboardTitle: "Auto Service Booking & Automation Dashboard",
    clientLabel: "Vehicle Owner",
    clientPluralLabel: "Vehicle Owners",
    specializationLabel: "Specialization (e.g. Engine, Brakes)",
  },
  education: {
    segment: "education",
    businessNameLabel: "Academy / School Name",
    businessSetupLabel: "School Setup",
    staffLabel: "Tutor / Instructor",
    staffPluralLabel: "Tutors & Instructors",
    serviceLabel: "Course / Subject",
    servicePluralLabel: "Courses Offered",
    bookingLabel: "Lesson Booking",
    bookingPluralLabel: "Lesson Bookings",
    dashboardTitle: "Academy Booking & Automation Dashboard",
    clientLabel: "Student",
    clientPluralLabel: "Students",
    specializationLabel: "Subjects / Specialty",
  },
  hospitality: {
    segment: "hospitality",
    businessNameLabel: "Hotel / Property Name",
    businessSetupLabel: "Property Setup",
    staffLabel: "Host / Representative",
    staffPluralLabel: "Hosts & Staff",
    serviceLabel: "Room / Package Type",
    servicePluralLabel: "Rooms & Packages",
    bookingLabel: "Reservation",
    bookingPluralLabel: "Reservations",
    dashboardTitle: "Reservations & Automation Dashboard",
    clientLabel: "Guest",
    clientPluralLabel: "Guests",
    specializationLabel: "Role (e.g. Front Desk, Concierge)",
  },
  pet: {
    segment: "pet",
    businessNameLabel: "Pet Center Name",
    businessSetupLabel: "Center Setup",
    staffLabel: "Groomer / Handler",
    staffPluralLabel: "Handlers & Groomers",
    serviceLabel: "Pet Service",
    servicePluralLabel: "Grooming & Pet Services",
    bookingLabel: "Booking",
    bookingPluralLabel: "Grooming Bookings",
    dashboardTitle: "Pet Services Booking & Automation Dashboard",
    clientLabel: "Pet Owner",
    clientPluralLabel: "Pet Owners",
    specializationLabel: "Specialty (e.g. Dog Grooming)",
  },
  business: {
    segment: "business",
    businessNameLabel: "Business Name",
    businessSetupLabel: "Business Setup",
    staffLabel: "Staff Member",
    staffPluralLabel: "AI Agents & Staff",
    serviceLabel: "Service Offered",
    servicePluralLabel: "Services Offered",
    bookingLabel: "Booking",
    bookingPluralLabel: "Bookings",
    dashboardTitle: "AI Booking & Automation Dashboard",
    clientLabel: "Client",
    clientPluralLabel: "Clients",
    specializationLabel: "Role / Specialty",
  },
};

export function getBusinessSegment(businessType: string | null | undefined): string {
  if (!businessType) return "business";
  const type = businessType.toLowerCase().trim();
  if (type.includes("beauty")) return "beauty";
  if (type.includes("wellness")) return "wellness";
  if (type.includes("trades")) return "trades";
  if (type.includes("professional")) return "professional";
  if (type.includes("automotive")) return "automotive";
  if (type.includes("medical") || type.includes("allied health")) return "healthcare";
  if (type.includes("education") || type.includes("training")) return "education";
  if (type.includes("hospitality")) return "hospitality";
  if (type.includes("pet")) return "pet";
  return "business";
}

export function getTerminology(segment: string | null | undefined): BusinessTerminology {
  if (!segment) return SEGMENTS.business;
  return SEGMENTS[segment] || SEGMENTS.business;
}
