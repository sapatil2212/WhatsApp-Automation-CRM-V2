"use client";

import { useEffect, useState } from "react";

import { toast } from "sonner";
import {
  Building2,
  Clock,
  UserRound,
  Stethoscope,
  HelpCircle,
  Brain,
  Plus,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Save,
  Sparkles,
  Download,
  Upload,
  FileText,
  AlertCircle,
  Loader2,
  Layers,
  CheckCircle2,
  Link2,
} from "lucide-react";
import { DepartmentsManager } from "@/components/healthcare/departments-manager";
import { DoctorsDirectory } from "@/components/healthcare/doctors-directory";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { AiSetupImport, type SetupSection } from "@/components/setup/ai-setup-import";
import { AiTrainingStep } from "@/components/setup/ai-training-step";
import { BookingLinkCard } from "@/components/booking/booking-link-card";
import type { ExtractedSetup } from "@/lib/ai/setup-extract";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

const DAYS_OF_WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export default function ClinicSetupWizard() {
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [clinicId, setClinicId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [showLink, setShowLink] = useState(false);
  // Last saved knowledge text, so the AI Training step can show unsaved changes.
  const [savedKb, setSavedKb] = useState("");

  // Deep link: /healthcare/setup?step=ai-training (the old AI Knowledge Base page redirects here).
  useEffect(() => {
    const step = new URLSearchParams(window.location.search).get("step");
    const map: Record<string, number> = { "ai-training": 8, faqs: 5, "ai-settings": 6 };
    if (step && map[step]) setCurrentStep(map[step]);
  }, []);

  // --- Step 1 State: Clinic Info ---
  const [clinicInfo, setClinicInfo] = useState({
    clinic_name: "",
    clinic_type: "",
    clinic_description: "",
    phone: "",
    whatsapp_number: "",
    email: "",
    website: "",
    address: "",
    city: "",
    state: "",
    pincode: "",
    google_map_link: "",
    instagram_url: "",
    facebook_url: "",
    ai_knowledge_base: "",
  });

  // --- Step 2 State: Working Hours & Exceptions ---
  const [timings, setTimings] = useState<any[]>(
    DAYS_OF_WEEK.map((day) => ({
      day_name: day,
      opening_time: "09:00",
      closing_time: "18:00",
      is_closed: day === "Sunday",
      lunch_break_start: "13:00",
      lunch_break_end: "14:00",
    }))
  );
  const [clinicExceptions, setClinicExceptions] = useState<any[]>([]);
  const [newClinicException, setNewClinicException] = useState({
    date: "",
    is_closed: true,
    opening_time: "09:00",
    closing_time: "18:00",
    reason: "",
  });

  // --- Step 3 State: Doctors ---
  const [doctors, setDoctors] = useState<any[]>([
    {
      doctor_name: "",
      specialization: "",
      qualification: "",
      experience: "",
      available_days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
      available_start_time: "09:00",
      available_end_time: "17:00",
      consultation_fee: 50,
      languages_spoken: "English",
      profile_photo: "",
      weekly_slots: {},
      date_exceptions: [],
    },
  ]);
  const [newCustomSlots, setNewCustomSlots] = useState<Record<number, { start_time: string; end_time: string }>>({});

  // Helper: slot generator function
  const generateTimeSlots = (startTime: string, endTime: string, durationMinutes: number) => {
    const slots: { start_time: string; end_time: string; is_active: boolean }[] = [];
    if (!startTime || !endTime) return slots;
    let [startH, startM] = startTime.split(':').map(Number);
    const [endH, endM] = endTime.split(':').map(Number);
    let startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;
    while (startMinutes + durationMinutes <= endMinutes) {
      const nextMinutes = startMinutes + durationMinutes;
      const sH = Math.floor(startMinutes / 60).toString().padStart(2, '0');
      const sM = (startMinutes % 60).toString().padStart(2, '0');
      const eH = Math.floor(nextMinutes / 60).toString().padStart(2, '0');
      const eM = (nextMinutes % 60).toString().padStart(2, '0');
      slots.push({
        start_time: `${sH}:${sM}`,
        end_time: `${eH}:${eM}`,
        is_active: true
      });
      startMinutes = nextMinutes;
    }
    return slots;
  };

  // --- Step 4 State: Services ---
  const [services, setServices] = useState<any[]>([
    {
      service_name: "",
      description: "",
      starting_price: 30,
      duration: 30,
      is_active: true,
    },
  ]);
  const [bulkText, setBulkText] = useState("");
  const [importing, setImporting] = useState(false);
  const [showImporter, setShowImporter] = useState(false);

  // --- Step 5 State: FAQs ---
  const [faqs, setFaqs] = useState<any[]>([
    {
      question: "",
      answer: "",
      keywords: "",
    },
  ]);
  const [faqBulkText, setFaqBulkText] = useState("");
  const [faqImporting, setFaqImporting] = useState(false);
  const [showFaqImporter, setShowFaqImporter] = useState(false);

  // --- Step 6 State: AI Settings ---
  const [aiSettings, setAiSettings] = useState({
    ai_enabled: true,
    ai_tone: "polite and professional",
    supported_languages: ["English"],
    greeting_message: "Hello! Welcome to our clinic. How can we help you today?",
    after_hours_message: "Thank you for reaching out. Our clinic is currently closed, but a representative will get back to you during working hours.",
    escalation_keywords: "human, agent, representative, help",
    emergency_keywords: "emergency, chest pain, bleeding, accident, heart, dying",
    human_handover_enabled: true,
  });

  // Load existing clinic data on mount
  useEffect(() => {
    async function loadClinicData() {
      try {
        const res = await fetch('/api/healthcare/setup');
        if (!res.ok) {
          console.error('Failed to load clinic data:', await res.json());
          return;
        }
        const json = await res.json();
        const { clinic, timings: timingRows, doctors: doctorRows, services: serviceRows, faqs: faqRows, ai_settings: aiSettingsRow } = json;

        if (clinic) {
          setClinicId(clinic.id);
          setClinicInfo({
            clinic_name: clinic.clinic_name || "",
            clinic_type: clinic.clinic_type || "",
            clinic_description: clinic.clinic_description || "",
            phone: clinic.phone || "",
            whatsapp_number: clinic.whatsapp_number || "",
            email: clinic.email || "",
            website: clinic.website || "",
            address: clinic.address || "",
            city: clinic.city || "",
            state: clinic.state || "",
            pincode: clinic.pincode || "",
            google_map_link: clinic.google_map_link || "",
            instagram_url: clinic.instagram_url || "",
            facebook_url: clinic.facebook_url || "",
            ai_knowledge_base: clinic.ai_knowledge_base || "",
          });
          setSavedKb(clinic.ai_knowledge_base || "");
          setClinicExceptions(clinic.date_exceptions || []);

          if (timingRows && timingRows.length > 0) {
            setTimings(
              DAYS_OF_WEEK.map((day) => {
                const match = timingRows.find((t: any) => t.day_name === day);
                return match || {
                  day_name: day,
                  opening_time: "09:00",
                  closing_time: "18:00",
                  is_closed: day === "Sunday",
                  lunch_break_start: "13:00",
                  lunch_break_end: "14:00",
                };
              })
            );
          }

          if (doctorRows && doctorRows.length > 0) {
            setDoctors(doctorRows.map((d: any) => ({
              ...d,
              weekly_slots: d.weekly_slots || {},
              date_exceptions: d.date_exceptions || [],
            })));
          }

          if (serviceRows && serviceRows.length > 0) setServices(serviceRows);
          if (faqRows && faqRows.length > 0) setFaqs(faqRows);

          if (aiSettingsRow) {
            setAiSettings({
              ai_enabled: aiSettingsRow.ai_enabled ?? true,
              ai_tone: aiSettingsRow.ai_tone || "polite and professional",
              supported_languages: aiSettingsRow.supported_languages || ["English"],
              greeting_message: aiSettingsRow.greeting_message || "",
              after_hours_message: aiSettingsRow.after_hours_message || "",
              escalation_keywords: aiSettingsRow.escalation_keywords || "",
              emergency_keywords: aiSettingsRow.emergency_keywords || "",
              human_handover_enabled: aiSettingsRow.human_handover_enabled ?? true,
            });
          }
        }
      } catch (err) {
        console.error("Error loading clinic data:", err);
      } finally {
        setLoading(false);
      }
    }

    loadClinicData();
  }, [reloadKey]);

  const handleClinicInfoChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setClinicInfo({ ...clinicInfo, [e.target.name]: e.target.value });
  };

  const handleTimingChange = (index: number, field: string, value: any) => {
    const updated = [...timings];
    updated[index] = { ...updated[index], [field]: value };
    setTimings(updated);
  };

  // Doctors are edited in <DoctorsDirectory /> (own API); `doctors` is kept
  // only so the AI import can skip names that already exist.

  // --- Services Handlers ---
  const handleServiceChange = (index: number, field: string, value: any) => {
    const updated = [...services];
    updated[index] = { ...updated[index], [field]: value };
    setServices(updated);
  };

  const addService = () => {
    setServices([
      ...services,
      {
        service_name: "",
        description: "",
        starting_price: 30,
        duration: 30,
        is_active: true,
      },
    ]);
  };

  const removeService = (index: number) => {
    if (services.length === 1) {
      toast.warning("Must configure at least one service.");
      return;
    }
    setServices(services.filter((_, i) => i !== index));
  };

  const downloadSampleCSV = () => {
    const csvContent = "service_name,starting_price,duration,description\n" +
      "Teeth Cleaning,80,30,Professional scaling and polishing to remove plaque and tartar\n" +
      "Root Canal Treatment,350,60,Endodontic therapy to treat infected tooth pulp\n" +
      "Dental Crown,500,45,Custom-fitted porcelain crown to restore tooth structure and appearance\n" +
      "Consultation & X-Ray,50,15,Comprehensive oral checkup with digital dental X-rays\n";
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "sample_services.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const downloadSampleTXT = () => {
    const txtContent = "Below is our standard clinic service catalog:\n\n" +
      "1. Consultation & Diagnosis: A basic diagnostic checkup. Starts at ₹50. Duration is 15 minutes.\n" +
      "2. Teeth Whitening: Bleaching treatment to whiten teeth. Cost is ₹150 and takes 45 minutes.\n" +
      "3. Composite Filling: Repairing cavity with tooth-colored filling. Starts from ₹90. Duration: 30 mins.\n" +
      "4. Tooth Extraction: Simple extraction of damaged tooth. Price is ₹120. Takes 30 minutes.\n";
    const blob = new Blob([txtContent], { type: "text/plain;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "sample_services.txt");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setBulkText(text);
      toast.success(`Loaded content from ${file.name}`);
    };
    reader.onerror = () => {
      toast.error("Failed to read file.");
    };
    reader.readAsText(file);
  };

  const handleAIImport = async () => {
    if (!bulkText.trim()) {
      toast.error("Please paste some text or upload a file first.");
      return;
    }

    setImporting(true);
    try {
      const response = await fetch("/api/healthcare/import-services", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text: bulkText }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.error || "Failed to analyze services.");
      }

      const data = await response.json();
      const newServices = data.services || [];

      if (newServices.length === 0) {
        toast.warning("AI did not detect any services in the text. Try adjusting your text.");
        return;
      }

      setServices((prev) => {
        const cleanPrev = prev.filter((s) => s.service_name.trim() !== "");
        return [
          ...cleanPrev,
          ...newServices.map((ns: any) => ({
            service_name: ns.service_name,
            description: ns.description || "",
            starting_price: ns.starting_price || 0,
            duration: ns.duration || 30,
            is_active: true,
          })),
        ];
      });

      toast.success(`Successfully parsed and imported ${newServices.length} services!`);
      setBulkText("");
      setShowImporter(false);
    } catch (err: any) {
      toast.error(`Import error: ${err.message || err}`);
      console.error(err);
    } finally {
      setImporting(false);
    }
  };

  // --- FAQs Handlers ---
  const handleFaqChange = (index: number, field: string, value: any) => {
    const updated = [...faqs];
    updated[index] = { ...updated[index], [field]: value };
    setFaqs(updated);
  };

  const addFaq = () => {
    setFaqs([
      ...faqs,
      {
        question: "",
        answer: "",
        keywords: "",
      },
    ]);
  };

  const removeFaq = (index: number) => {
    if (faqs.length === 1) {
      toast.warning("Must configure at least one FAQ.");
      return;
    }
    setFaqs(faqs.filter((_, i) => i !== index));
  };

  const downloadSampleFAQCSV = () => {
    const csvContent = "question,answer,keywords\n" +
      "What are the clinic working hours?,\"Our clinic is open Monday to Saturday from 9:00 AM to 6:00 PM. We are closed on Sundays.\",hours,timings,opening,schedule\n" +
      "Do you offer root canal treatments?,\"Yes, we offer complete endodontic root canal treatments starting at ₹350 depending on the tooth.\",root canal,treatment,endodontics\n" +
      "Where are you located?,\"We are located at 123 Health Ave, Suite 10, New York, NY 10001. Check our Google Maps link for directions.\",location,address,maps,directions\n" +
      "Who is the lead doctor?,\"Our lead dentist is Dr. Patil, who specializes in Orthodontics and Oral Surgery.\",doctor,dentist,patil,staff\n";
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "sample_faqs.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const downloadSampleFAQTXT = () => {
    const txtContent = "Frequently Asked Questions Guide:\n\n" +
      "Q: Do you accept insurance?\n" +
      "A: Yes, we accept major dental insurance plans including Delta, Aetna, Cigna, and MetLife. Trigger Keywords: insurance, billing, payment\n\n" +
      "Q: How can I book an appointment?\n" +
      "A: You can book an appointment directly here on WhatsApp by typing 'book appointment' or sharing preferred timings. Trigger Keywords: book, appointment, schedule, booking\n\n" +
      "Q: What is the consultation fee?\n" +
      "A: The general consultation checkup is ₹50. Trigger Keywords: fee, checkup, price, cost\n";
    const blob = new Blob([txtContent], { type: "text/plain;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "sample_faqs.txt");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleFaqFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setFaqBulkText(text);
      toast.success(`Loaded FAQ content from ${file.name}`);
    };
    reader.onerror = () => {
      toast.error("Failed to read file.");
    };
    reader.readAsText(file);
  };

  const handleAIFAQImport = async () => {
    if (!faqBulkText.trim()) {
      toast.error("Please paste some text or upload a file first.");
      return;
    }

    setFaqImporting(true);
    try {
      const response = await fetch("/api/healthcare/import-faqs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text: faqBulkText }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.error || "Failed to analyze FAQs.");
      }

      const data = await response.json();
      const newFaqs = data.faqs || [];

      if (newFaqs.length === 0) {
        toast.warning("AI did not detect any FAQs in the text. Try adjusting your text.");
        return;
      }

      setFaqs((prev) => {
        const cleanPrev = prev.filter((f) => f.question.trim() !== "" || f.answer.trim() !== "");
        return [
          ...cleanPrev,
          ...newFaqs.map((nf: any) => ({
            question: nf.question,
            answer: nf.answer,
            keywords: nf.keywords || "",
          })),
        ];
      });

      toast.success(`Successfully parsed and imported ${newFaqs.length} FAQs!`);
      setFaqBulkText("");
      setShowFaqImporter(false);
    } catch (err: any) {
      toast.error(`Import error: ${err.message || err}`);
      console.error(err);
    } finally {
      setFaqImporting(false);
    }
  };

  // --- AI Settings Handlers ---
  const handleAISettingsChange = (name: string, value: any) => {
    setAiSettings({ ...aiSettings, [name]: value });
  };

  // --- AI document import: merge approved sections and save them ---
  const applyAiSetup = async (data: ExtractedSetup, sections: Set<SetupSection>) => {
    const post = async (step: number, payload: Record<string, unknown>) => {
      const res = await fetch('/api/healthcare/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step, data: payload }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Saving step ${step} failed`);
      return json;
    };
    const keep = (v: string | undefined, fallback: string) => (v && v.trim() ? v : fallback);
    try {
      let id = clinicId;
      if (sections.has('profile') || sections.has('knowledge') || !id) {
        const p = data.profile;
        const info = {
          ...clinicInfo,
          clinic_name: keep(sections.has('profile') ? p.name : '', clinicInfo.clinic_name) || 'My Clinic',
          clinic_type: keep(sections.has('profile') ? p.type : '', clinicInfo.clinic_type),
          clinic_description: keep(sections.has('profile') ? p.description : '', clinicInfo.clinic_description),
          phone: keep(sections.has('profile') ? p.phone : '', clinicInfo.phone),
          whatsapp_number: keep(sections.has('profile') ? p.whatsapp_number : '', clinicInfo.whatsapp_number),
          email: keep(sections.has('profile') ? p.email : '', clinicInfo.email),
          website: keep(sections.has('profile') ? p.website : '', clinicInfo.website),
          address: keep(sections.has('profile') ? p.address : '', clinicInfo.address),
          city: keep(sections.has('profile') ? p.city : '', clinicInfo.city),
          state: keep(sections.has('profile') ? p.state : '', clinicInfo.state),
          pincode: keep(sections.has('profile') ? p.pincode : '', clinicInfo.pincode),
          google_map_link: keep(sections.has('profile') ? p.google_map_link : '', clinicInfo.google_map_link),
          instagram_url: keep(sections.has('profile') ? p.instagram_url : '', clinicInfo.instagram_url),
          facebook_url: keep(sections.has('profile') ? p.facebook_url : '', clinicInfo.facebook_url),
          ai_knowledge_base: sections.has('knowledge') && data.knowledge
            ? [clinicInfo.ai_knowledge_base, data.knowledge].filter(Boolean).join('\n\n')
            : clinicInfo.ai_knowledge_base,
        };
        const json = await post(1, info);
        id = json.clinic_id ?? id;
        if (id) setClinicId(id);
      }
      if (!id) throw new Error('Could not create the clinic profile.');

      if (sections.has('timings') && data.timings.length) {
        await post(2, { clinic_id: id, timings: data.timings, date_exceptions: clinicExceptions });
      }
      if (sections.has('people') && data.people.length) {
        const existing = doctors.filter((d) => d.doctor_name?.trim());
        const names = new Set(existing.map((d) => d.doctor_name.trim().toLowerCase()));
        const added = data.people
          .filter((p) => !names.has(p.name.toLowerCase()))
          .map((p) => ({
            doctor_name: p.name,
            specialization: p.department || p.role || '',
            qualification: p.qualification,
            experience: p.experience,
            available_days: p.available_days.length ? p.available_days : ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
            available_start_time: p.available_start_time || '09:00',
            available_end_time: p.available_end_time || '17:00',
            consultation_fee: p.fee || 0,
            languages_spoken: p.languages || 'English',
            profile_photo: '',
            weekly_slots: {},
            date_exceptions: [],
          }));
        if (added.length) await post(3, { clinic_id: id, doctors: added });
      }
      if (sections.has('services') && data.services.length) {
        const existing = services.filter((x) => x.service_name?.trim());
        const names = new Set(existing.map((x) => x.service_name.trim().toLowerCase()));
        const added = data.services
          .filter((x) => !names.has(x.name.toLowerCase()))
          .map((x) => ({ service_name: x.name, description: x.description, starting_price: x.price, duration: x.duration, is_active: true }));
        if (added.length) await post(4, { clinic_id: id, services: [...existing, ...added] });
      }
      if (sections.has('faqs') && data.faqs.length) {
        const existing = faqs.filter((f) => f.question?.trim() && f.answer?.trim());
        const qs = new Set(existing.map((f) => f.question.trim().toLowerCase()));
        const added = data.faqs.filter((f) => !qs.has(f.question.toLowerCase())).map((f) => ({ question: f.question, answer: f.answer, keywords: '' }));
        if (added.length) await post(5, { clinic_id: id, faqs: [...existing, ...added] });
      }
      toast.success('Business details imported and saved. Review each step to fine-tune.');
      setReloadKey((k) => k + 1);
    } catch (err: any) {
      toast.error(err?.message || 'Import failed');
    }
  };

  // --- Save / Step submission ---
  const handleSaveStep = async () => {
    setSaving(true);
    try {
      const successMessages: Record<number, string> = {
        1: 'Clinic Information saved successfully!',
        2: 'Working hours and holidays saved successfully!',
        3: 'Doctors directory saved.',
        7: 'Departments saved.',
        4: 'Services registered successfully!',
        5: 'FAQs saved successfully!',
        6: 'AI Healthcare Automation onboarding setup complete!',
        8: 'AI knowledge saved. The WhatsApp AI uses it from the next message.',
      };

      const nextStep = stepsList[currentPos + 1]?.num;
      // Departments & doctors save live through their own APIs.
      if (currentStep === 7 || currentStep === 3) {
        if (!clinicId) { setSaving(false); return; }
        toast.success(successMessages[currentStep]);
        if (nextStep) setCurrentStep(nextStep);
        return;
      }

      let body: any = { step: currentStep };

      if (currentStep === 1) {
        if (!clinicInfo.clinic_name) {
          toast.error('Clinic Name is required.');
          setSaving(false);
          return;
        }
        body.data = { ...clinicInfo };
      } else if (currentStep === 2) {
        if (!clinicId) { setSaving(false); return; }
        body.data = { clinic_id: clinicId, timings, date_exceptions: clinicExceptions };
      } else if (currentStep === 4) {
        if (!clinicId) { setSaving(false); return; }
        body.data = { clinic_id: clinicId, services };
      } else if (currentStep === 5) {
        if (!clinicId) { setSaving(false); return; }
        body.data = { clinic_id: clinicId, faqs };
      } else if (currentStep === 6) {
        if (!clinicId) { setSaving(false); return; }
        body.data = { clinic_id: clinicId, ai_settings: aiSettings };
      } else if (currentStep === 8) {
        // Knowledge text lives on the clinic profile, so it saves via step 1.
        if (!clinicId) { setSaving(false); return; }
        body = { step: 1, data: { ...clinicInfo } };
      }

      const res = await fetch('/api/healthcare/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const json = await res.json();

      if (!res.ok) {
        toast.error(json.error || 'Failed to save. Please try again.');
        return;
      }

      // For step 1, capture the returned clinic_id
      if (currentStep === 1 && json.clinic_id) {
        setClinicId(json.clinic_id);
      }
      if (currentStep === 1 || currentStep === 8) setSavedKb(clinicInfo.ai_knowledge_base);

      toast.success(successMessages[currentStep]);
      if (nextStep) setCurrentStep(nextStep);
    } catch (err: any) {
      toast.error(`Error saving setup: ${err.message}`);
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-9 w-72 animate-pulse rounded-lg bg-muted" />
        <div className="h-20 animate-pulse rounded-2xl bg-muted/60" />
        <div className="h-14 animate-pulse rounded-2xl bg-muted/60" />
        <div className="h-96 animate-pulse rounded-2xl bg-muted/50" />
      </div>
    );
  }

  // `num` is the save key the setup API understands (and 7 = departments,
  // which saves through its own API); the array order is what users see.
  const stepsList = [
    { num: 1, label: "Clinic Info", icon: Building2 },
    { num: 7, label: "Departments", icon: Layers },
    { num: 3, label: "Doctors", icon: UserRound },
    { num: 2, label: "Clinic Hours", icon: Clock },
    { num: 4, label: "Services", icon: Stethoscope },
    { num: 5, label: "FAQs", icon: HelpCircle },
    { num: 8, label: "AI Training", icon: Sparkles },
    { num: 6, label: "AI Settings", icon: Brain },
  ];
  const currentPos = Math.max(0, stepsList.findIndex((x) => x.num === currentStep));
  const currentMeta = stepsList[currentPos];

  // What "done" means for each step, so the checklist shows real progress.
  const filled = (v: unknown) => typeof v === "string" && v.trim().length > 0;
  const stepDone: Record<number, boolean | null> = {
    1: Boolean(clinicId) && filled(clinicInfo.clinic_name) && (filled(clinicInfo.phone) || filled(clinicInfo.whatsapp_number)) && (filled(clinicInfo.address) || filled(clinicInfo.city)),
    7: null, // optional; managed in its own panel
    3: doctors.some((d) => filled(d.doctor_name)),
    2: timings.some((d) => !d.is_closed),
    4: services.some((s) => filled(s.service_name)),
    5: faqs.some((q) => filled(q.question) && filled(q.answer)),
    6: Boolean(aiSettings.ai_enabled) && filled(aiSettings.greeting_message),
    8: filled(savedKb),
  };
  const required = stepsList.filter((s) => stepDone[s.num] !== null);
  const doneCount = required.filter((s) => stepDone[s.num]).length;
  const progress = Math.round((doneCount / required.length) * 100);
  const nextTodo = stepsList.find((s) => stepDone[s.num] === false);

  return (
    <div className="space-y-5">
      {/* Page Title */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Business Setup</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Configure business information once, and let the AI handle WhatsApp inquiries and bookings.
          </p>
        </div>
        {clinicId && (
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setShowLink((v) => !v)} aria-expanded={showLink}>
            <Link2 className="size-3.5" /> {showLink ? "Hide booking link" : "Booking link"}
          </Button>
        )}
      </div>

      {showLink && clinicId && <BookingLinkCard />}
      <AiSetupImport isHealthcare onApply={applyAiSetup} />

      <div className="grid items-start gap-4 lg:grid-cols-[250px_minmax(0,1fr)]">
        {/* Checklist */}
        <aside className="space-y-3 lg:sticky lg:top-4">
          <div className="rounded-2xl border border-border/70 bg-card p-3.5">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Setup progress</p>
              <span className="text-[12px] font-semibold tabular-nums">{progress}%</span>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-muted">
              <div className="h-1.5 rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              {doneCount === required.length ? "All set. The AI has everything it needs." : `${doneCount} of ${required.length} steps complete${nextTodo ? ` · next: ${nextTodo.label}` : ""}`}
            </p>
          </div>

          <nav className="rounded-2xl border border-border/70 bg-card p-1.5" aria-label="Setup steps">
            <ol className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
              {stepsList.map((step, pos) => {
                const Icon = step.icon;
                const isActive = step.num === currentStep;
                const locked = !clinicId && step.num !== 1;
                const done = stepDone[step.num];
                return (
                  <li key={step.num} className="shrink-0">
                    <button
                      type="button"
                      aria-current={isActive ? "step" : undefined}
                      onClick={() => {
                        if (!locked) setCurrentStep(step.num);
                        else toast.error("Save the business information first.");
                      }}
                      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors ${
                        isActive ? "bg-primary/10 font-medium text-primary" : locked ? "cursor-not-allowed text-muted-foreground/60" : "text-foreground/90 hover:bg-accent"
                      }`}
                    >
                      <span
                        className={`flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                          done ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : isActive ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {done ? <CheckCircle2 className="size-3.5" /> : pos + 1}
                      </span>
                      <Icon className="size-3.5 shrink-0 opacity-70" />
                      <span className="min-w-0 flex-1 truncate whitespace-nowrap">{step.label}</span>
                      {done === null && <span className="hidden text-[10px] text-muted-foreground lg:inline">Optional</span>}
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>
        </aside>

        <div className="min-w-0">      {/* Step body */}
      <Card className="gap-0 overflow-visible rounded-2xl border border-border/70 bg-card py-0 shadow-none ring-0">
        <CardHeader className="border-b border-border/70 px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <currentMeta.icon className="size-4" />
            </span>
            <div className="min-w-0">
              <CardTitle className="text-[15px] font-semibold text-foreground">
                Step {currentPos + 1} of {stepsList.length} · {currentMeta.label}
              </CardTitle>
              <CardDescription className="mt-0.5 text-[12px] text-muted-foreground">
                {currentStep === 1 && "Basic details regarding location, name, and contact details."}
                {currentStep === 2 && "Clinic opening times and holidays / closure dates (doctor slots come from each doctor's schedule)."}
                {currentStep === 3 && "Add doctors, assign departments, and set each doctor's weekly sessions, slot length and breaks."}
                {currentStep === 7 && "Create the departments your clinic offers. Patients choose a department first when booking."}
                {currentStep === 4 && "Define business services, starting prices, and standard durations."}
                {currentStep === 5 && "Configure general FAQs to answer client WhatsApp questions instantly."}
                {currentStep === 6 && "Instruct AI how to respond to clients, emergencies, or escalate conversations."}
                {currentStep === 8 && "Everything else the AI should know to answer like your front desk. Test it on the right before saving."}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 px-5 py-5">
          {/* STEP 1: Clinic Information */}
          {currentStep === 1 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="clinic_name" className="text-[12px] font-medium text-foreground/90">Business Name *</Label>
                <Input
                  id="clinic_name"
                  name="clinic_name"
                  value={clinicInfo.clinic_name}
                  onChange={handleClinicInfoChange}
                  className="h-8 bg-background text-[13px] md:text-[13px]"
                  placeholder="E.g. ChatNexGen Support Agency"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="clinic_type" className="text-[12px] font-medium text-foreground/90">Business Category / Industry</Label>
                <Input
                  id="clinic_type"
                  name="clinic_type"
                  value={clinicInfo.clinic_type}
                  onChange={handleClinicInfoChange}
                  className="h-8 bg-background text-[13px] md:text-[13px]"
                  placeholder="E.g. Real Estate, Digital Marketing, Retail"
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="clinic_description" className="text-[12px] font-medium text-foreground/90">Business Description</Label>
                <Textarea
                  id="clinic_description"
                  name="clinic_description"
                  value={clinicInfo.clinic_description}
                  onChange={handleClinicInfoChange}
                  className="min-h-[72px] bg-background text-[13px] md:text-[13px]"
                  placeholder="A short snippet explaining the business focus for AI prompt building..."
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="phone" className="text-[12px] font-medium text-foreground/90">Landline / Phone</Label>
                <Input
                  id="phone"
                  name="phone"
                  value={clinicInfo.phone}
                  onChange={handleClinicInfoChange}
                  className="h-8 bg-background text-[13px] md:text-[13px]"
                  placeholder="+1 555-0199"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="whatsapp_number" className="text-[12px] font-medium text-foreground/90">WhatsApp Public Number</Label>
                <Input
                  id="whatsapp_number"
                  name="whatsapp_number"
                  value={clinicInfo.whatsapp_number}
                  onChange={handleClinicInfoChange}
                  className="h-8 bg-background text-[13px] md:text-[13px]"
                  placeholder="+1 555-0100"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-[12px] font-medium text-foreground/90">Clinic Email</Label>
                <Input
                  id="email"
                  name="email"
                  value={clinicInfo.email}
                  onChange={handleClinicInfoChange}
                  className="h-8 bg-background text-[13px] md:text-[13px]"
                  placeholder="info@clinic.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="website" className="text-[12px] font-medium text-foreground/90">Website URL</Label>
                <Input
                  id="website"
                  name="website"
                  value={clinicInfo.website}
                  onChange={handleClinicInfoChange}
                  className="h-8 bg-background text-[13px] md:text-[13px]"
                  placeholder="https://clinic.com"
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="address" className="text-[12px] font-medium text-foreground/90">Street Address</Label>
                <Input
                  id="address"
                  name="address"
                  value={clinicInfo.address}
                  onChange={handleClinicInfoChange}
                  className="h-8 bg-background text-[13px] md:text-[13px]"
                  placeholder="123 Health Ave, Suite 10"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="city" className="text-[12px] font-medium text-foreground/90">City</Label>
                <Input
                  id="city"
                  name="city"
                  value={clinicInfo.city}
                  onChange={handleClinicInfoChange}
                  className="h-8 bg-background text-[13px] md:text-[13px]"
                  placeholder="New York"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="state" className="text-[12px] font-medium text-foreground/90">State / Region</Label>
                <Input
                  id="state"
                  name="state"
                  value={clinicInfo.state}
                  onChange={handleClinicInfoChange}
                  className="h-8 bg-background text-[13px] md:text-[13px]"
                  placeholder="NY"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pincode" className="text-[12px] font-medium text-foreground/90">Pincode / Postal Code</Label>
                <Input
                  id="pincode"
                  name="pincode"
                  value={clinicInfo.pincode}
                  onChange={handleClinicInfoChange}
                  className="h-8 bg-background text-[13px] md:text-[13px]"
                  placeholder="10001"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="google_map_link" className="text-[12px] font-medium text-foreground/90">Google Business / Maps Link (GMB)</Label>
                <Input
                  id="google_map_link"
                  name="google_map_link"
                  value={clinicInfo.google_map_link}
                  onChange={handleClinicInfoChange}
                  className="h-8 bg-background text-[13px] md:text-[13px]"
                  placeholder="https://g.page/... or https://goo.gl/maps/..."
                />
              </div>

              {/* AI Training Sources */}
              <div className="md:col-span-2 mt-2 pt-4 border-t border-border">
                <div className="flex items-center gap-2 mb-1">
                  <Sparkles className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  <h3 className="text-[13px] font-semibold text-foreground">AI Training Sources</h3>
                </div>
                <p className="text-xs text-muted-foreground">
                  Add your public links so the AI can reference them and answer customers like an expert about your business.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="instagram_url" className="text-[12px] font-medium text-foreground/90">Instagram Profile</Label>
                <Input
                  id="instagram_url"
                  name="instagram_url"
                  value={clinicInfo.instagram_url}
                  onChange={handleClinicInfoChange}
                  className="h-8 bg-background text-[13px] md:text-[13px]"
                  placeholder="https://instagram.com/yourbusiness"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="facebook_url" className="text-[12px] font-medium text-foreground/90">Facebook Page</Label>
                <Input
                  id="facebook_url"
                  name="facebook_url"
                  value={clinicInfo.facebook_url}
                  onChange={handleClinicInfoChange}
                  className="h-8 bg-background text-[13px] md:text-[13px]"
                  placeholder="https://facebook.com/yourbusiness"
                />
              </div>
            </div>
          )}

          {/* STEP 2: Working Hours */}
          {currentStep === 2 && (
            <div className="space-y-4">
              <div className="grid grid-cols-12 gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider pb-2 border-b border-border">
                <div className="col-span-3">Day</div>
                <div className="col-span-2">Open Status</div>
                <div className="col-span-3">Business Hours</div>
                <div className="col-span-4">Lunch Break</div>
              </div>
              {timings.map((time, idx) => (
                <div key={time.day_name} className="grid grid-cols-12 gap-2 items-center py-2 border-b border-border last:border-0">
                  <div className="col-span-3 text-sm font-medium text-foreground">{time.day_name}</div>
                  <div className="col-span-2">
                    <Switch
                      checked={!time.is_closed}
                      onCheckedChange={(checked) => handleTimingChange(idx, "is_closed", !checked)}
                    />
                    <span className="text-xs text-muted-foreground ml-2">{time.is_closed ? "Closed" : "Open"}</span>
                  </div>
                  <div className="col-span-3 flex items-center gap-1.5">
                    <Input
                      disabled={time.is_closed}
                      type="time"
                      value={time.opening_time || "09:00"}
                      onChange={(e) => handleTimingChange(idx, "opening_time", e.target.value)}
                      className="h-8 bg-background px-2.5 text-[13px] md:text-[13px]"
                    />
                    <span className="text-muted-foreground">-</span>
                    <Input
                      disabled={time.is_closed}
                      type="time"
                      value={time.closing_time || "18:00"}
                      onChange={(e) => handleTimingChange(idx, "closing_time", e.target.value)}
                      className="h-8 bg-background px-2.5 text-[13px] md:text-[13px]"
                    />
                  </div>
                  <div className="col-span-4 flex items-center gap-1.5">
                    <Input
                      disabled={time.is_closed}
                      type="time"
                      value={time.lunch_break_start || "13:00"}
                      onChange={(e) => handleTimingChange(idx, "lunch_break_start", e.target.value)}
                      className="h-8 bg-background px-2.5 text-[13px] md:text-[13px]"
                    />
                    <span className="text-muted-foreground">-</span>
                    <Input
                      disabled={time.is_closed}
                      type="time"
                      value={time.lunch_break_end || "14:00"}
                      onChange={(e) => handleTimingChange(idx, "lunch_break_end", e.target.value)}
                      className="h-8 bg-background px-2.5 text-[13px] md:text-[13px]"
                    />
                  </div>
                </div>
              ))}

              {/* Holidays & Date Exceptions Section */}
              <div className="border-t border-border pt-6 mt-6 space-y-4">
                <div>
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-primary">Clinic Holidays & Schedule Exceptions</h3>
                  <p className="text-muted-foreground text-xs mt-1">Specify custom dates when the clinic is closed or has special working hours.</p>
                </div>
                
                {/* Add exception form */}
                <div className="grid grid-cols-1 md:grid-cols-5 gap-3 p-4 bg-background border border-border rounded-xl items-end">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Date</Label>
                    <Input
                      type="date"
                      value={newClinicException.date}
                      onChange={(e) => setNewClinicException({ ...newClinicException, date: e.target.value })}
                      className="h-8 bg-background text-[13px] md:text-[13px]"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Label / Holiday Name</Label>
                    <Input
                      placeholder="e.g. Christmas, Staff Day"
                      value={newClinicException.reason}
                      onChange={(e) => setNewClinicException({ ...newClinicException, reason: e.target.value })}
                      className="h-8 bg-background text-[13px] md:text-[13px]"
                    />
                  </div>
                  <div className="space-y-1 pb-1">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={newClinicException.is_closed}
                        onCheckedChange={(checked) => setNewClinicException({ ...newClinicException, is_closed: checked })}
                      />
                      <span className="text-xs text-foreground/90">Closed All Day</span>
                    </div>
                  </div>
                  
                  {!newClinicException.is_closed && (
                    <>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Open Time</Label>
                        <Input
                          type="time"
                          value={newClinicException.opening_time}
                          onChange={(e) => setNewClinicException({ ...newClinicException, opening_time: e.target.value })}
                          className="h-8 bg-background text-[13px] md:text-[13px]"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Close Time</Label>
                        <Input
                          type="time"
                          value={newClinicException.closing_time}
                          onChange={(e) => setNewClinicException({ ...newClinicException, closing_time: e.target.value })}
                          className="h-8 bg-background text-[13px] md:text-[13px]"
                        />
                      </div>
                    </>
                  )}
                  
                  <Button
                    type="button"
                    onClick={() => {
                      if (!newClinicException.date) {
                        toast.error("Please select a date.");
                        return;
                      }
                      if (clinicExceptions.some((e) => e.date === newClinicException.date)) {
                        toast.error("An exception already exists for this date.");
                        return;
                      }
                      setClinicExceptions([...clinicExceptions, { ...newClinicException }]);
                      setNewClinicException({
                        date: "",
                        is_closed: true,
                        opening_time: "09:00",
                        closing_time: "18:00",
                        reason: "",
                      });
                      toast.success("Exception added!");
                    }}
                    className="h-8 text-xs md:col-span-1"
                  >
                    Add Exception
                  </Button>
                </div>
                
                {/* List exceptions */}
                {clinicExceptions.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {clinicExceptions.map((ex, exIdx) => (
                      <div key={ex.date} className="flex justify-between items-center p-3 bg-background border border-border rounded-xl">
                        <div className="space-y-1">
                          <span className="text-xs font-bold text-foreground block">{new Date(ex.date).toLocaleDateString('en-US', { dateStyle: 'medium' })}</span>
                          <div className="flex gap-2 items-center">
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${ex.is_closed ? "bg-rose-500/10 text-rose-400 border border-rose-500/20" : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"}`}>
                              {ex.is_closed ? "Closed" : `Open: ${ex.opening_time} - ${ex.closing_time}`}
                            </span>
                            {ex.reason && <span className="text-xs text-muted-foreground">({ex.reason})</span>}
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => setClinicExceptions(clinicExceptions.filter((_, i) => i !== exIdx))}
                          className="h-8 w-8 text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10 rounded-lg animate-fade-in"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground italic">No exceptions or holidays registered yet.</p>
                )}
              </div>
            </div>
          )}

          {/* STEP 2 (UI): Departments */}
          {currentStep === 7 && <DepartmentsManager />}

          {/* STEP 3 (UI): Doctors Directory — saved per doctor via /api/healthcare/doctors */}
          {currentStep === 3 && <DoctorsDirectory key={reloadKey} />}

          {/* STEP 4: Services */}
          {currentStep === 4 && (
            <div className="space-y-4">
              {/* AI Bulk Importer Accordion/Card */}
              <div className="space-y-3 rounded-xl border border-border/70 bg-background p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="bg-emerald-500/10 p-2 rounded-lg text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                      <Sparkles className="h-4 w-4" />
                    </div>
                    <div>
                      <h4 className="text-[13px] font-semibold text-foreground">AI Bulk Services Importer</h4>
                      <p className="text-xs text-muted-foreground">
                        Paste unstructured text (PDF/Word/Excel) or upload .txt/.csv to automatically populate services.
                      </p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="border-border text-xs text-foreground/90 hover:bg-accent"
                    onClick={() => setShowImporter(!showImporter)}
                  >
                    {showImporter ? "Hide AI Importer" : "Use AI Importer"}
                  </Button>
                </div>

                {showImporter && (
                  <div className="space-y-4 pt-3 border-t border-border animate-fade-in">
                    {/* Sample Downloads */}
                    <div className="flex flex-wrap items-center justify-between gap-3 bg-background p-3 rounded-lg border border-border">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <AlertCircle className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                        <span>Not sure what format to use? Guidance templates:</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 gap-1.5 border border-border text-xs text-foreground/90 hover:bg-accent hover:text-foreground"
                          onClick={downloadSampleCSV}
                        >
                          <Download className="h-3 w-3" /> Download Sample CSV
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 gap-1.5 border border-border text-xs text-foreground/90 hover:bg-accent hover:text-foreground"
                          onClick={downloadSampleTXT}
                        >
                          <Download className="h-3 w-3" /> Download Sample TXT
                        </Button>
                      </div>
                    </div>

                    {/* File Upload / Paste Split */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {/* Left side: Upload card */}
                      <div className="md:col-span-1 border border-dashed border-border rounded-xl p-4 flex flex-col items-center justify-center bg-background hover:bg-accent/50 transition-colors relative group">
                        <input
                          type="file"
                          accept=".txt,.csv"
                          onChange={handleFileUpload}
                          className="absolute inset-0 opacity-0 cursor-pointer"
                        />
                        <div className="bg-card p-3 rounded-full mb-3 text-muted-foreground group-hover:text-primary transition-colors border border-border">
                          <Upload className="h-5 w-5" />
                        </div>
                        <span className="text-xs font-semibold text-foreground/90">Upload Text or CSV</span>
                        <span className="text-[10px] text-muted-foreground mt-1">Drag & drop or click</span>
                      </div>

                      {/* Right side: Pasting textarea */}
                      <div className="md:col-span-2 space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Paste Services Text below *</Label>
                        <Textarea
                          value={bulkText}
                          onChange={(e) => setBulkText(e.target.value)}
                          placeholder="Paste menu catalog, pricing table, or plain description of services...&#10;Example:&#10;- Teeth whitening ₹150, 45 mins. Professional cosmetic bleaching&#10;- Routine Dental scaling at ₹80 taking 30 minutes"
                          className="bg-background border-slate-850 text-foreground min-h-[110px] text-xs leading-relaxed"
                        />
                      </div>
                    </div>

                    {/* Analyze Action */}
                    <div className="flex justify-end pt-2 border-t border-border">
                      <Button
                        type="button"
                        disabled={importing}
                        onClick={handleAIImport}
                        className="h-8 gap-1.5 px-3 text-xs"
                      >
                        {importing ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            AI Analyzing Content...
                          </>
                        ) : (
                          <>
                            <Sparkles className="h-3.5 w-3.5 text-yellow-300" />
                            Analyze & Import with AI
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
              {services.map((svc, idx) => (
                <div key={idx} className="relative space-y-3 rounded-xl border border-border/70 bg-background p-4">
                  <button
                    type="button"
                    onClick={() => removeService(idx)}
                    className="absolute top-4 right-4 text-muted-foreground hover:text-rose-500 transition-colors"
                  >
                    <Trash2 className="h-5 w-5" />
                  </button>
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-primary">Service #{idx + 1}</h3>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="md:col-span-2 space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Service Name *</Label>
                      <Input
                        value={svc.service_name}
                        onChange={(e) => handleServiceChange(idx, "service_name", e.target.value)}
                        className="h-8 bg-background text-[13px] md:text-[13px]"
                        placeholder="E.g. Teeth Cleaning"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Starting Price (₹)</Label>
                      <Input
                        type="number"
                        value={svc.starting_price}
                        onChange={(e) => handleServiceChange(idx, "starting_price", parseFloat(e.target.value) || 0)}
                        className="h-8 bg-background text-[13px] md:text-[13px]"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Duration (Minutes)</Label>
                      <Input
                        type="number"
                        value={svc.duration}
                        onChange={(e) => handleServiceChange(idx, "duration", parseInt(e.target.value) || 30)}
                        className="h-8 bg-background text-[13px] md:text-[13px]"
                      />
                    </div>
                    <div className="md:col-span-3 space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Description</Label>
                      <Input
                        value={svc.description || ""}
                        onChange={(e) => handleServiceChange(idx, "description", e.target.value)}
                        className="h-8 bg-background text-[13px] md:text-[13px]"
                        placeholder="Brief summary..."
                      />
                    </div>
                    <div className="flex items-center gap-2 mt-7 ml-2">
                      <Switch
                        checked={svc.is_active}
                        onCheckedChange={(checked) => handleServiceChange(idx, "is_active", checked)}
                      />
                      <span className="text-xs text-foreground/90">Active</span>
                    </div>
                  </div>
                </div>
              ))}
              <Button onClick={addService} type="button" variant="outline" className="border-dashed border-border text-muted-foreground hover:text-foreground w-full">
                <Plus className="h-4 w-4 mr-1" /> Add Service
              </Button>
            </div>
          )}

          {/* STEP 5: FAQs */}
          {currentStep === 5 && (
            <div className="space-y-4">
              {/* AI Bulk FAQs Importer */}
              <div className="space-y-3 rounded-xl border border-border/70 bg-background p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="bg-emerald-500/10 p-2 rounded-lg text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                      <Sparkles className="h-4 w-4" />
                    </div>
                    <div>
                      <h4 className="text-[13px] font-semibold text-foreground">AI Bulk FAQs Importer</h4>
                      <p className="text-xs text-muted-foreground">
                        Paste unstructured text (PDF/Word/Excel) or upload .txt/.csv to automatically populate FAQs.
                      </p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="border-border text-xs text-foreground/90 hover:bg-accent"
                    onClick={() => setShowFaqImporter(!showFaqImporter)}
                  >
                    {showFaqImporter ? "Hide AI Importer" : "Use AI Importer"}
                  </Button>
                </div>

                {showFaqImporter && (
                  <div className="space-y-4 pt-3 border-t border-border animate-fade-in">
                    {/* Sample Downloads */}
                    <div className="flex flex-wrap items-center justify-between gap-3 bg-background p-3 rounded-lg border border-border">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <AlertCircle className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                        <span>Not sure what format to use? Guidance templates:</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 gap-1.5 border border-border text-xs text-foreground/90 hover:bg-accent hover:text-foreground"
                          onClick={downloadSampleFAQCSV}
                        >
                          <Download className="h-3 w-3" /> Download Sample CSV
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 gap-1.5 border border-border text-xs text-foreground/90 hover:bg-accent hover:text-foreground"
                          onClick={downloadSampleFAQTXT}
                        >
                          <Download className="h-3 w-3" /> Download Sample TXT
                        </Button>
                      </div>
                    </div>

                    {/* File Upload / Paste Split */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {/* Left side: Upload card */}
                      <div className="md:col-span-1 border border-dashed border-border rounded-xl p-4 flex flex-col items-center justify-center bg-background hover:bg-accent/50 transition-colors relative group">
                        <input
                          type="file"
                          accept=".txt,.csv"
                          onChange={handleFaqFileUpload}
                          className="absolute inset-0 opacity-0 cursor-pointer"
                        />
                        <div className="bg-card p-3 rounded-full mb-3 text-muted-foreground group-hover:text-primary transition-colors border border-border">
                          <Upload className="h-5 w-5" />
                        </div>
                        <span className="text-xs font-semibold text-foreground/90">Upload Text or CSV</span>
                        <span className="text-[10px] text-muted-foreground mt-1">Drag & drop or click</span>
                      </div>

                      {/* Right side: Pasting textarea */}
                      <div className="md:col-span-2 space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Paste FAQs Text below *</Label>
                        <Textarea
                          value={faqBulkText}
                          onChange={(e) => setFaqBulkText(e.target.value)}
                          placeholder="Paste lists of Q&As, website text, or documents...&#10;Example:&#10;Q: What are the timings?&#10;A: Open Mon-Sat 9AM-6PM.&#10;&#10;Q: Do you accept card?&#10;A: Yes, we accept all cards."
                          className="bg-background border-slate-850 text-foreground min-h-[110px] text-xs leading-relaxed"
                        />
                      </div>
                    </div>

                    {/* Analyze Action */}
                    <div className="flex justify-end pt-2 border-t border-border">
                      <Button
                        type="button"
                        disabled={faqImporting}
                        onClick={handleAIFAQImport}
                        className="h-8 gap-1.5 px-3 text-xs"
                      >
                        {faqImporting ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            AI Analyzing Content...
                          </>
                        ) : (
                          <>
                            <Sparkles className="h-3.5 w-3.5 text-yellow-300" />
                            Analyze & Import with AI
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
              {faqs.map((faq, idx) => (
                <div key={idx} className="relative space-y-3 rounded-xl border border-border/70 bg-background p-4">
                  <button
                    type="button"
                    onClick={() => removeFaq(idx)}
                    className="absolute top-4 right-4 text-muted-foreground hover:text-rose-500 transition-colors"
                  >
                    <Trash2 className="h-5 w-5" />
                  </button>
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-primary">FAQ #{idx + 1}</h3>
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground font-medium">Question *</Label>
                      <Input
                        value={faq.question}
                        onChange={(e) => handleFaqChange(idx, "question", e.target.value)}
                        className="h-8 bg-background text-[13px] md:text-[13px]"
                        placeholder="E.g. Is Dr. Patil available today?"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground font-medium">Answer *</Label>
                      <Textarea
                        value={faq.answer}
                        onChange={(e) => handleFaqChange(idx, "answer", e.target.value)}
                        className="bg-background border-border text-foreground min-h-[60px]"
                        placeholder="E.g. Please share preferred doctor name."
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground font-medium">Trigger Keywords (Comma Separated)</Label>
                      <Input
                        value={faq.keywords || ""}
                        onChange={(e) => handleFaqChange(idx, "keywords", e.target.value)}
                        className="h-8 bg-background text-[13px] md:text-[13px]"
                        placeholder="E.g. doctor, schedule, available, timings"
                      />
                    </div>
                  </div>
                </div>
              ))}
              <Button onClick={addFaq} type="button" variant="outline" className="border-dashed border-border text-muted-foreground hover:text-foreground w-full">
                <Plus className="h-4 w-4 mr-1" /> Add FAQ
              </Button>
            </div>
          )}

          {/* STEP 8: AI Training (knowledge text + live test) */}
          {currentStep === 8 && (
            <AiTrainingStep
              value={clinicInfo.ai_knowledge_base}
              saved={savedKb}
              onChange={(v) => setClinicInfo({ ...clinicInfo, ai_knowledge_base: v })}
            />
          )}

          {/* STEP 6: AI Settings */}
          {currentStep === 6 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="md:col-span-2 flex items-center justify-between p-4 bg-background rounded-xl border border-border">
                <div className="space-y-0.5">
                  <Label className="text-sm font-semibold text-foreground">Enable AI Automated Replies</Label>
                  <p className="text-xs text-muted-foreground">Enable AI auto-response for incoming WhatsApp messages.</p>
                </div>
                <Switch
                  checked={aiSettings.ai_enabled}
                  onCheckedChange={(checked) => handleAISettingsChange("ai_enabled", checked)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ai_tone" className="text-[12px] font-medium text-foreground/90">AI Personality / Tone</Label>
                <Input
                  id="ai_tone"
                  value={aiSettings.ai_tone}
                  onChange={(e) => handleAISettingsChange("ai_tone", e.target.value)}
                  className="h-8 bg-background text-[13px] md:text-[13px]"
                  placeholder="E.g. polite and professional"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-[12px] font-medium text-foreground/90">Supported Languages</Label>
                <Input
                  value={aiSettings.supported_languages.join(", ")}
                  onChange={(e) => handleAISettingsChange("supported_languages", e.target.value.split(",").map(lang => lang.trim()).filter(Boolean))}
                  className="h-8 bg-background text-[13px] md:text-[13px]"
                  placeholder="E.g. English, Spanish"
                />
              </div>

              <div className="md:col-span-2 space-y-2">
                <Label htmlFor="greeting_message" className="text-[12px] font-medium text-foreground/90">Greeting Message</Label>
                <Textarea
                  id="greeting_message"
                  value={aiSettings.greeting_message}
                  onChange={(e) => handleAISettingsChange("greeting_message", e.target.value)}
                  className="bg-background border-border text-foreground min-h-[70px]"
                  placeholder="First automated greeting sent to new patients..."
                />
              </div>

              <div className="md:col-span-2 space-y-2">
                <Label htmlFor="after_hours_message" className="text-[12px] font-medium text-foreground/90">After Hours / Closed Message</Label>
                <Textarea
                  id="after_hours_message"
                  value={aiSettings.after_hours_message}
                  onChange={(e) => handleAISettingsChange("after_hours_message", e.target.value)}
                  className="bg-background border-border text-foreground min-h-[70px]"
                  placeholder="Reply sent when patient queries during off hours..."
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-[12px] font-medium text-foreground/90">Human Handover Keywords (Comma Separated)</Label>
                <Input
                  value={aiSettings.escalation_keywords}
                  onChange={(e) => handleAISettingsChange("escalation_keywords", e.target.value)}
                  className="h-8 bg-background text-[13px] md:text-[13px]"
                  placeholder="E.g. human, agent, operator"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-[12px] font-medium text-foreground/90">Emergency Stop Keywords (Comma Separated)</Label>
                <Input
                  value={aiSettings.emergency_keywords}
                  onChange={(e) => handleAISettingsChange("emergency_keywords", e.target.value)}
                  className="h-8 bg-background text-[13px] md:text-[13px]"
                  placeholder="E.g. heart attack, bleeding, emergency"
                />
              </div>

              <div className="md:col-span-2 flex items-center justify-between p-4 bg-background rounded-xl border border-border">
                <div className="space-y-0.5">
                  <Label className="text-sm font-semibold text-foreground">Enable Human Handover Notification</Label>
                  <p className="text-xs text-muted-foreground">Insert notes in CRM and notify human agents when AI detects fallback conditions.</p>
                </div>
                <Switch
                  checked={aiSettings.human_handover_enabled}
                  onCheckedChange={(checked) => handleAISettingsChange("human_handover_enabled", checked)}
                />
              </div>
            </div>
          )}
        </CardContent>

        {/* Action Buttons */}
        <div className="sticky bottom-0 z-10 flex items-center justify-between gap-2 rounded-b-2xl border-t border-border/70 bg-card/95 px-5 py-3 backdrop-blur supports-[backdrop-filter]:bg-card/80">
          <Button
            disabled={currentPos === 0 || saving}
            onClick={() => setCurrentStep(stepsList[currentPos - 1].num)}
            variant="outline"
            size="sm"
            className="gap-1"
          >
            <ChevronLeft className="size-3.5" /> Back
          </Button>

          <Button size="sm" disabled={saving} onClick={handleSaveStep} className="min-w-[110px]">
            {saving ? (
              <span className="flex items-center gap-1.5">
                <Loader2 className="size-3.5 animate-spin" />
                Saving...
              </span>
            ) : currentPos === stepsList.length - 1 ? (
              <span className="flex items-center gap-1.5">
                <Save className="size-3.5" /> Complete setup
              </span>
            ) : currentStep === 7 || currentStep === 3 ? (
              <span className="flex items-center gap-1.5">
                Next <ChevronRight className="size-3.5" />
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                Save & Next <ChevronRight className="size-3.5" />
              </span>
            )}
          </Button>
        </div>
      </Card>
        </div>
      </div>
    </div>
  );
}
