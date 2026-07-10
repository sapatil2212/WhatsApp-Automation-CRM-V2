"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getTerminology } from "@/lib/business/terminology";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import {
  Building2,
  Clock,
  UserRound,
  Package,
  HelpCircle,
  Brain,
  Plus,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Save,
  Sparkles,
  Loader2,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

const DAYS_OF_WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export default function BusinessSetupWizard() {
  const params = useParams();
  const businessSegment = params.businessSegment as string;
  const term = getTerminology(businessSegment);

  const db = createClient();
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [businessId, setBusinessId] = useState<string | null>(null);

  // --- Step 1 State: Business Info ---
  const [businessInfo, setBusinessInfo] = useState({
    business_name: "",
    business_type: "",
    description: "",
    phone: "",
    whatsapp_number: "",
    email: "",
    website: "",
    address: "",
    city: "",
    state: "",
    pincode: "",
  });

  // --- Step 2 State: Working Hours ---
  const [workingHours, setWorkingHours] = useState<any[]>(
    DAYS_OF_WEEK.map((day) => ({
      day_name: day,
      opening_time: "09:00",
      closing_time: "18:00",
      is_closed: day === "Sunday",
    }))
  );

  // --- Step 3 State: Staff ---
  const [staffList, setStaffList] = useState<any[]>([
    { name: "", role: "", specialization: "", qualification: "" },
  ]);

  // --- Step 4 State: Services ---
  const [servicesList, setServicesList] = useState<any[]>([
    { name: "", description: "", price: 20, duration_minutes: 30 },
  ]);

  // --- Step 5 State: FAQs ---
  const [faqsList, setFaqsList] = useState<any[]>([
    { question: "", answer: "", keywords: "" },
  ]);

  // --- Step 6 State: AI Settings ---
  const [aiSettings, setAiSettings] = useState({
    ai_enabled: true,
    ai_tone: "polite and professional",
    greeting_message: "",
    after_hours_message: "",
  });

  useEffect(() => {
    async function loadData() {
      try {
        const { data: business } = await db
          .from("business_profiles")
          .select("*")
          .maybeSingle();

        if (business) {
          setBusinessId(business.id);
          setBusinessInfo({
            business_name: business.business_name || "",
            business_type: business.business_type || "",
            description: business.description || "",
            phone: business.phone || "",
            whatsapp_number: business.whatsapp_number || "",
            email: business.email || "",
            website: business.website || "",
            address: business.address || "",
            city: business.city || "",
            state: business.state || "",
            pincode: business.pincode || "",
          });

          if (business.working_hours) {
            setWorkingHours(business.working_hours);
          }

          // Fetch Staff
          const { data: staff } = await db
            .from("business_staff")
            .select("*")
            .eq("business_id", business.id);
          if (staff && staff.length > 0) setStaffList(staff);

          // Fetch Services
          const { data: services } = await db
            .from("business_services")
            .select("*")
            .eq("business_id", business.id);
          if (services && services.length > 0) setServicesList(services);

          // Fetch FAQs
          const { data: faqs } = await db
            .from("business_faqs")
            .select("*")
            .eq("business_id", business.id);
          if (faqs && faqs.length > 0) setFaqsList(faqs);

          // Fetch AI Settings
          const { data: ai } = await db
            .from("business_ai_settings")
            .select("*")
            .eq("business_id", business.id)
            .maybeSingle();
          if (ai) {
            setAiSettings({
              ai_enabled: ai.ai_enabled ?? true,
              ai_tone: ai.ai_tone || "polite and professional",
              greeting_message: ai.greeting_message || "",
              after_hours_message: ai.after_hours_message || "",
            });
          }
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [businessSegment]);

  const handleNext = () => setCurrentStep((prev) => Math.min(prev + 1, 6));
  const handlePrev = () => setCurrentStep((prev) => Math.max(prev - 1, 1));

  const handleSave = async () => {
    setSaving(true);
    try {
      // 1. Create or Update Business Profile
      let activeBusinessId = businessId;
      const businessPayload = {
        business_name: businessInfo.business_name,
        business_type: businessInfo.business_type || term.segment,
        description: businessInfo.description,
        phone: businessInfo.phone,
        whatsapp_number: businessInfo.whatsapp_number,
        email: businessInfo.email,
        website: businessInfo.website,
        address: businessInfo.address,
        city: businessInfo.city,
        state: businessInfo.state,
        pincode: businessInfo.pincode,
        working_hours: workingHours,
      };

      if (activeBusinessId) {
        const { error } = await db
          .from("business_profiles")
          .update(businessPayload)
          .eq("id", activeBusinessId);
        if (error) throw error;
      } else {
        const { data, error } = await db
          .from("business_profiles")
          .insert(businessPayload)
          .select()
          .single();
        if (error) throw error;
        activeBusinessId = data.id;
        setBusinessId(data.id);
      }

      // 2. Save Staff Members
      // Delete existing and insert new
      await db.from("business_staff").delete().eq("business_id", activeBusinessId);
      const staffToInsert = staffList
        .filter((s) => s.name.trim())
        .map((s) => ({
          business_id: activeBusinessId,
          name: s.name,
          role: s.role || null,
          specialization: s.specialization || null,
          qualification: s.qualification || null,
        }));
      if (staffToInsert.length > 0) {
        const { error } = await db.from("business_staff").insert(staffToInsert);
        if (error) throw error;
      }

      // 3. Save Services
      await db.from("business_services").delete().eq("business_id", activeBusinessId);
      const servicesToInsert = servicesList
        .filter((s) => s.name.trim())
        .map((s) => ({
          business_id: activeBusinessId,
          name: s.name,
          description: s.description || null,
          price: Number(s.price) || null,
          duration_minutes: Number(s.duration_minutes) || null,
        }));
      if (servicesToInsert.length > 0) {
        const { error } = await db.from("business_services").insert(servicesToInsert);
        if (error) throw error;
      }

      // 4. Save FAQs
      await db.from("business_faqs").delete().eq("business_id", activeBusinessId);
      const faqsToInsert = faqsList
        .filter((f) => f.question.trim() && f.answer.trim())
        .map((f) => ({
          business_id: activeBusinessId,
          question: f.question,
          answer: f.answer,
          keywords: f.keywords || null,
        }));
      if (faqsToInsert.length > 0) {
        const { error } = await db.from("business_faqs").insert(faqsToInsert);
        if (error) throw error;
      }

      // 5. Save AI Settings
      const { data: existingAi } = await db
        .from("business_ai_settings")
        .select("id")
        .eq("business_id", activeBusinessId)
        .maybeSingle();

      const aiPayload = {
        business_id: activeBusinessId,
        ai_enabled: aiSettings.ai_enabled,
        ai_tone: aiSettings.ai_tone,
        greeting_message: aiSettings.greeting_message,
        after_hours_message: aiSettings.after_hours_message,
      };

      if (existingAi) {
        const { error } = await db
          .from("business_ai_settings")
          .update(aiPayload)
          .eq("id", existingAi.id);
        if (error) throw error;
      } else {
        const { error } = await db.from("business_ai_settings").insert(aiPayload);
        if (error) throw error;
      }

      toast.success("Business profile saved successfully!");
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to save configuration.");
    } finally {
      setSaving(false);
    }
  };

  const addStaff = () => setStaffList([...staffList, { name: "", role: "", specialization: "", qualification: "" }]);
  const removeStaff = (index: number) => setStaffList(staffList.filter((_, i) => i !== index));

  const addService = () => setServicesList([...servicesList, { name: "", description: "", price: 20, duration_minutes: 30 }]);
  const removeService = (index: number) => setServicesList(servicesList.filter((_, i) => i !== index));

  const addFaq = () => setFaqsList([...faqsList, { question: "", answer: "", keywords: "" }]);
  const removeFaq = (index: number) => setFaqsList(faqsList.filter((_, i) => i !== index));

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const steps = [
    { title: "Business Info", icon: Building2 },
    { title: "Working Hours", icon: Clock },
    { title: term.staffPluralLabel, icon: UserRound },
    { title: term.servicePluralLabel, icon: Package },
    { title: "AI FAQ Details", icon: HelpCircle },
    { title: "AI Settings", icon: Brain },
  ];

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Step indicators */}
      <div className="flex justify-between items-center bg-slate-900/40 p-4 rounded-xl border border-slate-800">
        {steps.map((s, idx) => {
          const StepIcon = s.icon;
          const isCompleted = idx + 1 < currentStep;
          const isActive = idx + 1 === currentStep;
          return (
            <button
              key={s.title}
              onClick={() => setCurrentStep(idx + 1)}
              className="flex flex-col items-center gap-1.5 focus:outline-none transition-colors"
            >
              <div
                className={`h-9 w-9 rounded-full flex items-center justify-center border text-xs font-bold transition-all ${
                  isCompleted
                    ? "bg-primary border-primary text-primary-foreground"
                    : isActive
                    ? "bg-slate-800 border-primary text-white"
                    : "border-slate-800 bg-slate-950 text-slate-500"
                }`}
              >
                <StepIcon className="h-4 w-4" />
              </div>
              <span
                className={`text-[10px] hidden md:block font-medium ${
                  isActive ? "text-white font-bold" : "text-slate-500"
                }`}
              >
                {s.title}
              </span>
            </button>
          );
        })}
      </div>

      <Card className="border-slate-800 bg-slate-900/60 backdrop-blur-md">
        <CardHeader>
          <CardTitle className="text-xl text-white font-bold flex items-center gap-2">
            {steps[currentStep - 1].title} Setup
          </CardTitle>
          <CardDescription className="text-xs text-slate-400">
            Configure {steps[currentStep - 1].title.toLowerCase()} for {term.businessNameLabel.split('/')[0].trim()}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-white">
          {/* Step 1: Business Details */}
          {currentStep === 1 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="text-xs">{term.businessNameLabel}</Label>
                <Input
                  value={businessInfo.business_name}
                  onChange={(e) => setBusinessInfo({ ...businessInfo, business_name: e.target.value })}
                  placeholder="e.g. Bella Salon & Spa"
                  className="h-9 border-slate-800 bg-slate-950 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Business Type Category</Label>
                <Input
                  disabled
                  value={businessSegment.toUpperCase()}
                  className="h-9 border-slate-850 bg-slate-950/40 text-xs text-slate-400"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Contact Phone</Label>
                <Input
                  value={businessInfo.phone}
                  onChange={(e) => setBusinessInfo({ ...businessInfo, phone: e.target.value })}
                  placeholder="Phone"
                  className="h-9 border-slate-800 bg-slate-950 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">WhatsApp Number</Label>
                <Input
                  value={businessInfo.whatsapp_number}
                  onChange={(e) => setBusinessInfo({ ...businessInfo, whatsapp_number: e.target.value })}
                  placeholder="WhatsApp Number"
                  className="h-9 border-slate-800 bg-slate-950 text-xs"
                />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label className="text-xs">Business Description (Context for AI bot)</Label>
                <Textarea
                  value={businessInfo.description}
                  onChange={(e) => setBusinessInfo({ ...businessInfo, description: e.target.value })}
                  placeholder="Tell clients who you are, what services you specialize in, and standard policies..."
                  className="min-h-[100px] border-slate-800 bg-slate-950 text-xs"
                />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label className="text-xs">Street Address</Label>
                <Input
                  value={businessInfo.address}
                  onChange={(e) => setBusinessInfo({ ...businessInfo, address: e.target.value })}
                  placeholder="Address"
                  className="h-9 border-slate-800 bg-slate-950 text-xs"
                />
              </div>
            </div>
          )}

          {/* Step 2: Working Hours */}
          {currentStep === 2 && (
            <div className="space-y-3">
              {workingHours.map((t, idx) => (
                <div
                  key={t.day_name}
                  className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-3 bg-slate-950/40 rounded-lg border border-slate-850"
                >
                  <div className="w-24 text-sm font-semibold">{t.day_name}</div>
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-1.5 cursor-pointer text-xs">
                      <input
                        type="checkbox"
                        checked={t.is_closed}
                        onChange={(e) => {
                          const updated = [...workingHours];
                          updated[idx].is_closed = e.target.checked;
                          setWorkingHours(updated);
                        }}
                        className="rounded border-slate-800 bg-slate-950 text-primary focus:ring-0 cursor-pointer"
                      />
                      Closed
                    </label>

                    {!t.is_closed && (
                      <div className="flex items-center gap-2">
                        <Input
                          type="time"
                          value={t.opening_time}
                          onChange={(e) => {
                            const updated = [...workingHours];
                            updated[idx].opening_time = e.target.value;
                            setWorkingHours(updated);
                          }}
                          className="h-8 w-24 border-slate-800 bg-slate-950 text-xs px-2"
                        />
                        <span className="text-xs text-slate-500">to</span>
                        <Input
                          type="time"
                          value={t.closing_time}
                          onChange={(e) => {
                            const updated = [...workingHours];
                            updated[idx].closing_time = e.target.value;
                            setWorkingHours(updated);
                          }}
                          className="h-8 w-24 border-slate-800 bg-slate-950 text-xs px-2"
                        />
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Step 3: Staff */}
          {currentStep === 3 && (
            <div className="space-y-4">
              {staffList.map((staff, index) => (
                <div key={index} className="flex gap-3 items-end p-4 bg-slate-950/30 rounded-lg border border-slate-800 relative">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 flex-1">
                    <div className="space-y-1">
                      <Label className="text-xs">{term.staffLabel} Name</Label>
                      <Input
                        value={staff.name}
                        onChange={(e) => {
                          const list = [...staffList];
                          list[index].name = e.target.value;
                          setStaffList(list);
                        }}
                        placeholder="Name"
                        className="h-9 border-slate-800 bg-slate-950 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{term.specializationLabel}</Label>
                      <Input
                        value={staff.specialization}
                        onChange={(e) => {
                          const list = [...staffList];
                          list[index].specialization = e.target.value;
                          setStaffList(list);
                        }}
                        placeholder="Specialization"
                        className="h-9 border-slate-800 bg-slate-950 text-xs"
                      />
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => removeStaff(index)}
                    className="h-9 w-9 text-slate-500 hover:text-red-400 border border-slate-800"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" onClick={addStaff} className="w-full border-slate-800 hover:bg-slate-800">
                <Plus className="h-4 w-4 mr-2" /> Add {term.staffLabel}
              </Button>
            </div>
          )}

          {/* Step 4: Services */}
          {currentStep === 4 && (
            <div className="space-y-4">
              {servicesList.map((service, index) => (
                <div key={index} className="flex gap-3 items-end p-4 bg-slate-950/30 rounded-lg border border-slate-800">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 flex-1">
                    <div className="space-y-1">
                      <Label className="text-xs">Service Name</Label>
                      <Input
                        value={service.name}
                        onChange={(e) => {
                          const list = [...servicesList];
                          list[index].name = e.target.value;
                          setServicesList(list);
                        }}
                        placeholder="Service Name"
                        className="h-9 border-slate-800 bg-slate-950 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Price ($ / local)</Label>
                      <Input
                        type="number"
                        value={service.price}
                        onChange={(e) => {
                          const list = [...servicesList];
                          list[index].price = e.target.value;
                          setServicesList(list);
                        }}
                        placeholder="Price"
                        className="h-9 border-slate-800 bg-slate-950 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Duration (minutes)</Label>
                      <Input
                        type="number"
                        value={service.duration_minutes}
                        onChange={(e) => {
                          const list = [...servicesList];
                          list[index].duration_minutes = e.target.value;
                          setServicesList(list);
                        }}
                        placeholder="Duration"
                        className="h-9 border-slate-800 bg-slate-950 text-xs"
                      />
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => removeService(index)}
                    className="h-9 w-9 text-slate-500 hover:text-red-400 border border-slate-800"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" onClick={addService} className="w-full border-slate-800 hover:bg-slate-800">
                <Plus className="h-4 w-4 mr-2" /> Add Service
              </Button>
            </div>
          )}

          {/* Step 5: FAQs */}
          {currentStep === 5 && (
            <div className="space-y-4">
              {faqsList.map((faq, index) => (
                <div key={index} className="flex gap-3 items-end p-4 bg-slate-950/30 rounded-lg border border-slate-800">
                  <div className="grid grid-cols-1 gap-3 flex-1">
                    <div className="space-y-1">
                      <Label className="text-xs">Question</Label>
                      <Input
                        value={faq.question}
                        onChange={(e) => {
                          const list = [...faqsList];
                          list[index].question = e.target.value;
                          setFaqsList(list);
                        }}
                        placeholder="e.g. Do you allow walk-ins?"
                        className="h-9 border-slate-800 bg-slate-950 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Answer</Label>
                      <Textarea
                        value={faq.answer}
                        onChange={(e) => {
                          const list = [...faqsList];
                          list[index].answer = e.target.value;
                          setFaqsList(list);
                        }}
                        placeholder="Answer details..."
                        className="min-h-[60px] border-slate-800 bg-slate-950 text-xs"
                      />
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => removeFaq(index)}
                    className="h-9 w-9 text-slate-500 hover:text-red-400 border border-slate-800"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" onClick={addFaq} className="w-full border-slate-800 hover:bg-slate-800">
                <Plus className="h-4 w-4 mr-2" /> Add FAQ Q&A
              </Button>
            </div>
          )}

          {/* Step 6: AI Settings */}
          {currentStep === 6 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-slate-950/40 rounded-lg border border-slate-850">
                <div>
                  <div className="text-sm font-semibold">Enable AI Autopilot</div>
                  <div className="text-xs text-slate-500">Allow AI chatbot to automatically answer questions and book appointments.</div>
                </div>
                <Switch
                  checked={aiSettings.ai_enabled}
                  onCheckedChange={(val) => setAiSettings({ ...aiSettings, ai_enabled: val })}
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">AI Assistant Tone</Label>
                <Input
                  value={aiSettings.ai_tone}
                  onChange={(e) => setAiSettings({ ...aiSettings, ai_tone: e.target.value })}
                  placeholder="e.g. friendly and casual, or formal and precise"
                  className="h-9 border-slate-800 bg-slate-950 text-xs"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">AI Greeting Message</Label>
                <Textarea
                  value={aiSettings.greeting_message}
                  onChange={(e) => setAiSettings({ ...aiSettings, greeting_message: e.target.value })}
                  placeholder="Hi! Thanks for contacting us. How can we help you book or find info today?"
                  className="min-h-[80px] border-slate-800 bg-slate-950 text-xs"
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Navigation buttons */}
      <div className="flex justify-between items-center">
        <Button
          variant="outline"
          disabled={currentStep === 1}
          onClick={handlePrev}
          className="border-slate-800 text-white hover:bg-slate-800"
        >
          <ChevronLeft className="h-4 w-4 mr-1" /> Previous
        </Button>

        {currentStep < 6 ? (
          <Button onClick={handleNext}>
            Next <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        ) : (
          <Button onClick={handleSave} disabled={saving} className="bg-emerald-500 hover:bg-emerald-400 text-white">
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving Setup...
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" /> Save Configuration
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
