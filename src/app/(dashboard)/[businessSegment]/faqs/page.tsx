"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useParams } from "next/navigation";
import { getTerminology } from "@/lib/business/terminology";
import { toast } from "sonner";
import { Plus, Trash2, Edit2, Loader2, HelpCircle, MessageSquare } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";

export default function FaqsManagement() {
  const params = useParams();
  const businessSegment = params.businessSegment as string;
  const term = getTerminology(businessSegment);

  const db = createClient();
  const [loading, setLoading] = useState(true);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [faqsList, setFaqsList] = useState<any[]>([]);

  // Modal states
  const [isOpen, setIsOpen] = useState(false);
  const [editingFaq, setEditingFaq] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [faqToDelete, setFaqToDelete] = useState<string | null>(null);

  // Form states
  const [form, setForm] = useState({
    question: "",
    answer: "",
    keywords: "",
  });

  const loadFaqs = async (bId: string) => {
    const { data, error } = await db
      .from("business_faqs")
      .select("*")
      .eq("business_id", bId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error loading FAQs:", error);
      toast.error("Failed to load FAQs list.");
    } else {
      setFaqsList(data || []);
    }
  };

  useEffect(() => {
    async function loadData() {
      try {
        const { data: business } = await db
          .from("business_profiles")
          .select("id")
          .maybeSingle();

        if (business) {
          setBusinessId(business.id);
          await loadFaqs(business.id);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [businessSegment]);

  const handleOpenAdd = () => {
    setEditingFaq(null);
    setForm({
      question: "",
      answer: "",
      keywords: "",
    });
    setIsOpen(true);
  };

  const handleOpenEdit = (faq: any) => {
    setEditingFaq(faq);
    setForm({
      question: faq.question || "",
      answer: faq.answer || "",
      keywords: faq.keywords || "",
    });
    setIsOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessId) return;

    setSaving(true);
    try {
      const payload = {
        business_id: businessId,
        question: form.question.trim(),
        answer: form.answer.trim(),
        keywords: form.keywords.trim() || null,
      };

      if (editingFaq) {
        const { error } = await db
          .from("business_faqs")
          .update(payload)
          .eq("id", editingFaq.id);
        if (error) throw error;
        toast.success("FAQ updated successfully.");
      } else {
        const { error } = await db
          .from("business_faqs")
          .insert(payload);
        if (error) throw error;
        toast.success("FAQ created successfully.");
      }

      setIsOpen(false);
      await loadFaqs(businessId);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to save FAQ.");
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!faqToDelete || !businessId) return;
    try {
      const { error } = await db
        .from("business_faqs")
        .delete()
        .eq("id", faqToDelete);

      if (error) throw error;
      toast.success("FAQ deleted successfully.");
      setDeleteOpen(false);
      await loadFaqs(businessId);
    } catch (err: any) {
      toast.error(err.message || "Failed to delete FAQ.");
    }
  };

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <HelpCircle className="h-6 w-6 text-primary" />
            AI Knowledge Base & FAQs
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Program the Q&A pairs the AI assistant uses to answer customer enquiries automatically on WhatsApp.
          </p>
        </div>
        <Button onClick={handleOpenAdd} className="bg-primary text-primary-foreground hover:bg-primary/95">
          <Plus className="h-4 w-4 mr-2" /> Add FAQ Q&A
        </Button>
      </div>

      {/* FAQs List */}
      <div className="space-y-4">
        {faqsList.length === 0 ? (
          <Card className="border-slate-800 bg-slate-900/60 p-12 text-center">
            <MessageSquare className="h-12 w-12 text-slate-700 mx-auto mb-3" />
            <p className="text-sm text-slate-400">No FAQs found. Train your bot by adding some questions!</p>
          </Card>
        ) : (
          faqsList.map((faq) => (
            <Card key={faq.id} className="border-slate-800 bg-slate-900/60 hover:border-slate-700 transition-all">
              <CardHeader className="flex flex-row items-start justify-between pb-2">
                <div className="space-y-1.5 flex-1 pr-4">
                  <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                    Q
                  </span>
                  <CardTitle className="text-sm font-bold text-white leading-snug">{faq.question}</CardTitle>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleOpenEdit(faq)}
                    className="h-8 w-8 text-slate-400 hover:text-white"
                  >
                    <Edit2 className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      setFaqToDelete(faq.id);
                      setDeleteOpen(true);
                    }}
                    className="h-8 w-8 text-slate-400 hover:text-red-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-2 text-xs space-y-3">
                <div className="text-slate-350 leading-relaxed bg-slate-950/30 border border-slate-850 p-3 rounded-lg">
                  <span className="font-semibold text-emerald-400 block mb-1">AI ANSWER:</span>
                  {faq.answer}
                </div>
                {faq.keywords && (
                  <div className="text-[10px] text-slate-500">
                    Keywords: <span className="font-mono text-slate-400">{faq.keywords}</span>
                  </div>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Add / Edit Dialog */}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="border-slate-800 bg-slate-900 text-white max-w-md">
          <DialogHeader>
            <DialogTitle>{editingFaq ? "Edit FAQ" : "Add FAQ"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-1">
              <Label className="text-xs">Question</Label>
              <Input
                required
                value={form.question}
                onChange={(e) => setForm({ ...form, question: e.target.value })}
                placeholder="e.g. What are your salon hours on holidays?"
                className="h-9 border-slate-800 bg-slate-950 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Answer</Label>
              <Textarea
                required
                value={form.answer}
                onChange={(e: any) => setForm({ ...form, answer: e.target.value })}
                placeholder="Write the precise answer the chatbot should reply with..."
                className="min-h-[100px] border-slate-800 bg-slate-950 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Trigger Keywords (comma separated)</Label>
              <Input
                value={form.keywords}
                onChange={(e) => setForm({ ...form, keywords: e.target.value })}
                placeholder="e.g. hours, schedule, holiday, weekend"
                className="h-9 border-slate-800 bg-slate-950 text-xs"
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setIsOpen(false)} className="text-xs">
                Cancel
              </Button>
              <Button type="submit" disabled={saving} className="text-xs">
                {saving ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <ConfirmationDialog
        isOpen={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete FAQ"
        description="Are you sure you want to remove this FAQ from the AI knowledge base?"
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}
