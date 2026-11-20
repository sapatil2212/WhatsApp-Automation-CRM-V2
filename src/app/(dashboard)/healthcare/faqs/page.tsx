"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Brain,
  Sparkles,
  UploadCloud,
  FileText,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Search,
  Plus,
  Trash2,
  Edit,
  Loader2,
  CheckSquare,
  Square,
  Send,
  Save,
  RefreshCw,
  Clock,
  MapPin,
  Phone,
  Stethoscope,
  DollarSign,
  Info,
  BookOpen,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

interface ClinicFAQ {
  id: string;
  clinicId?: string;
  question: string;
  answer: string;
  keywords?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

interface ExtractedFAQ {
  question: string;
  answer: string;
  keywords?: string;
}

interface ExtractedAnalysisData {
  fileName: string;
  fileSizeBytes: number;
  fileSizeFormatted: string;
  charCount: number;
  businessDetails: {
    clinicName: string;
    tagline?: string;
    phone?: string;
    email?: string;
    address?: string;
    workingHours?: string;
    specialties?: string[];
  };
  doctors: Array<{
    name: string;
    specialization?: string;
    qualification?: string;
    timing?: string;
    consultationFee?: string;
  }>;
  services: Array<{
    name: string;
    price?: string;
    description?: string;
  }>;
  knowledgeBaseText: string;
  faqs: ExtractedFAQ[];
  modelUsed?: string;
}

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export default function AIKnowledgeBasePage() {
  const [activeTab, setActiveTab] = useState("scanner");
  const [loading, setLoading] = useState(true);
  const [savingKb, setSavingKb] = useState(false);

  // Clinic & Knowledge Base state
  const [clinic, setClinic] = useState<any>(null);
  const [knowledgeBaseText, setKnowledgeBaseText] = useState("");
  const [faqs, setFaqs] = useState<ClinicFAQ[]>([]);
  const [stats, setStats] = useState({
    faqCount: 0,
    kbCharacters: 0,
    kbWords: 0,
    doctorsCount: 0,
    servicesCount: 0,
  });

  // Scanner & Upload state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState("");
  const [extractedData, setExtractedData] = useState<ExtractedAnalysisData | null>(null);
  const [editableExtractedKb, setEditableExtractedKb] = useState("");
  const [selectedFaqIndexes, setSelectedFaqIndexes] = useState<Set<number>>(new Set());
  const [savingExtracted, setSavingExtracted] = useState(false);
  const [replaceExistingFaqs, setReplaceExistingFaqs] = useState(false);
  const [updateContactDetails, setUpdateContactDetails] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // FAQ Management states
  const [searchQuery, setSearchQuery] = useState("");
  const [isFaqModalOpen, setIsFaqModalOpen] = useState(false);
  const [editingFaq, setEditingFaq] = useState<ClinicFAQ | null>(null);
  const [faqForm, setFaqForm] = useState({ question: "", answer: "", keywords: "" });
  const [savingFaq, setSavingFaq] = useState(false);

  // AI Playground state
  const [testQuery, setTestQuery] = useState("");
  const [testHistory, setTestHistory] = useState<Array<{ role: "user" | "ai"; text: string }>>([
    {
      role: "ai",
      text: "Hello! I am your clinic's WhatsApp AI Receptionist. Ask me any question (timings, consultation charges, doctor schedules, or policies) to test what I've learned from your Knowledge Base!",
    },
  ]);
  const [testingAi, setTestingAi] = useState(false);

  // Load clinic knowledge base and FAQs
  const fetchKnowledgeData = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/healthcare/knowledge-base", { cache: "no-store" });
      if (!res.ok) {
        throw new Error("Failed to load clinic knowledge base.");
      }
      const data = await res.json();
      setClinic(data.clinic || null);
      setKnowledgeBaseText(data.clinic?.aiKnowledgeBase || "");
      setFaqs(data.faqs || []);
      setStats(
        data.stats || {
          faqCount: (data.faqs || []).length,
          kbCharacters: (data.clinic?.aiKnowledgeBase || "").length,
          kbWords: (data.clinic?.aiKnowledgeBase || "").trim()
            ? (data.clinic?.aiKnowledgeBase || "").trim().split(/\s+/).length
            : 0,
          doctorsCount: 0,
          servicesCount: 0,
        }
      );
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to load Knowledge Base.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchKnowledgeData();
  }, []);

  // Save Knowledge Base directly
  const handleSaveKnowledgeBase = async () => {
    setSavingKb(true);
    try {
      const res = await fetch("/api/healthcare/knowledge-base", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aiKnowledgeBase: knowledgeBaseText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update Knowledge Base");

      toast.success("Knowledge Base saved successfully! WhatsApp AI updated.");
      await fetchKnowledgeData();
    } catch (err: any) {
      toast.error(err.message || "Could not save Knowledge Base.");
    } finally {
      setSavingKb(false);
    }
  };

  // Document File Picker
  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelected(e.dataTransfer.files[0]);
    }
  };

  const handleFileSelected = (file: File) => {
    if (file.size > MAX_FILE_SIZE) {
      toast.error(
        `File exceeds 50MB limit (Selected: ${(file.size / 1024 / 1024).toFixed(1)}MB). Please choose a file up to 50MB.`
      );
      return;
    }
    setSelectedFile(file);
    setExtractedData(null);
  };

  // Run AI Document Scan
  const handleScanDocument = async () => {
    if (!selectedFile) {
      toast.error("Please select a document to scan.");
      return;
    }

    setAnalyzing(true);
    setAnalysisProgress("Uploading and parsing document content (up to 50MB)...");

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const timer = setTimeout(() => {
        setAnalysisProgress("Extracting medical & business ground truth with AI...");
      }, 3500);

      const timer2 = setTimeout(() => {
        setAnalysisProgress("Synthesizing doctor schedules, pricing tables & FAQs...");
      }, 8500);

      const res = await fetch("/api/healthcare/knowledge-base/upload", {
        method: "POST",
        body: formData,
      });

      clearTimeout(timer);
      clearTimeout(timer2);

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to scan and analyze document.");
      }

      setExtractedData(data);
      setEditableExtractedKb(data.knowledgeBaseText || "");
      setSelectedFaqIndexes(new Set((data.faqs || []).map((_: any, i: number) => i)));

      toast.success(
        `Analysis complete! Found ${data.faqs?.length || 0} FAQs, ${(data.doctors || []).length} doctors, and ${(data.services || []).length} services.`
      );
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Document analysis failed.");
    } finally {
      setAnalyzing(false);
      setAnalysisProgress("");
    }
  };

  // Save Extracted Knowledge into DB
  const handleSaveExtractedToKnowledgeBase = async () => {
    if (!extractedData) return;

    setSavingExtracted(true);
    try {
      const chosenFaqs = extractedData.faqs.filter((_, i) => selectedFaqIndexes.has(i));

      const payload = {
        knowledgeBaseText: editableExtractedKb.trim(),
        faqs: chosenFaqs,
        replaceFaqs: replaceExistingFaqs,
        businessDetails: updateContactDetails ? extractedData.businessDetails : undefined,
      };

      const res = await fetch("/api/healthcare/knowledge-base/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save Knowledge Base.");

      toast.success(
        `Saved successfully! ${chosenFaqs.length} FAQs and comprehensive ground-truth synced to your WhatsApp AI.`
      );
      setExtractedData(null);
      setSelectedFile(null);
      await fetchKnowledgeData();
      setActiveTab("knowledge-base");
    } catch (err: any) {
      toast.error(err.message || "Failed to save to database.");
    } finally {
      setSavingExtracted(false);
    }
  };

  // Toggle FAQ selection
  const toggleSelectAllFaqs = () => {
    if (!extractedData) return;
    if (selectedFaqIndexes.size === extractedData.faqs.length) {
      setSelectedFaqIndexes(new Set());
    } else {
      setSelectedFaqIndexes(new Set(extractedData.faqs.map((_, i) => i)));
    }
  };

  const toggleFaqIndex = (idx: number) => {
    const next = new Set(selectedFaqIndexes);
    if (next.has(idx)) {
      next.delete(idx);
    } else {
      next.add(idx);
    }
    setSelectedFaqIndexes(next);
  };

  // FAQ CRUD handlers
  const handleOpenAddFaq = () => {
    setEditingFaq(null);
    setFaqForm({ question: "", answer: "", keywords: "" });
    setIsFaqModalOpen(true);
  };

  const handleOpenEditFaq = (faq: ClinicFAQ) => {
    setEditingFaq(faq);
    setFaqForm({
      question: faq.question,
      answer: faq.answer,
      keywords: faq.keywords || "",
    });
    setIsFaqModalOpen(true);
  };

  const handleSaveSingleFaq = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!faqForm.question.trim() || !faqForm.answer.trim()) {
      toast.error("Both Question and Answer are required.");
      return;
    }

    setSavingFaq(true);
    try {
      if (editingFaq) {
        const res = await fetch(`/api/healthcare/knowledge-base/faqs/${editingFaq.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(faqForm),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to update FAQ");
        toast.success("FAQ updated successfully!");
      } else {
        const res = await fetch("/api/healthcare/knowledge-base/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            knowledgeBaseText: knowledgeBaseText || "",
            faqs: [faqForm],
            replaceFaqs: false,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to add FAQ");
        toast.success("FAQ created successfully!");
      }

      setIsFaqModalOpen(false);
      await fetchKnowledgeData();
    } catch (err: any) {
      toast.error(err.message || "Failed to save FAQ.");
    } finally {
      setSavingFaq(false);
    }
  };

  const handleDeleteFaq = async (id: string) => {
    if (!confirm("Are you sure you want to delete this FAQ?")) return;
    try {
      const res = await fetch(`/api/healthcare/knowledge-base/faqs/${id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete FAQ");

      toast.success("FAQ deleted.");
      await fetchKnowledgeData();
    } catch (err: any) {
      toast.error(err.message || "Could not delete FAQ.");
    }
  };

  // AI Sandbox Playground test
  const handleTestAiQuery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testQuery.trim() || testingAi) return;

    const userMsg = testQuery.trim();
    setTestQuery("");
    setTestHistory((prev) => [...prev, { role: "user", text: userMsg }]);
    setTestingAi(true);

    try {
      const res = await fetch("/api/healthcare/knowledge-base/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMsg,
          // If testing extracted draft, pass editableExtractedKb, otherwise db kb
          knowledgeBaseText: extractedData ? editableExtractedKb : knowledgeBaseText,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to test AI response.");

      setTestHistory((prev) => [...prev, { role: "ai", text: data.reply || "No reply generated." }]);
    } catch (err: any) {
      setTestHistory((prev) => [
        ...prev,
        { role: "ai", text: `⚠️ Error testing AI: ${err.message || "Could not contact model."}` },
      ]);
    } finally {
      setTestingAi(false);
    }
  };

  // Filter FAQs
  const filteredFaqs = faqs.filter(
    (f) =>
      f.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
      f.answer.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (f.keywords || "").toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex-1 space-y-6 p-4 md:p-8 max-w-7xl mx-auto">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border/40 pb-5">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 px-2.5 py-0.5 text-xs font-medium">
              <Sparkles className="h-3.5 w-3.5 mr-1" /> WhatsApp AI Ground Truth
            </Badge>
            <Badge variant="secondary" className="text-xs">
              Tenant Scoped
            </Badge>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
            AI Knowledge Base & WhatsApp Brain
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            Upload any clinic or business document (PDF, Word, Excel, CSV, TXT up to 50MB). Our AI auto-extracts your
            doctors, services, fees, operating hours, and policies — transforming them into authoritative ground truth
            for your WhatsApp receptionist.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchKnowledgeData} disabled={loading} className="gap-1.5">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={() => setActiveTab("playground")}
            className="gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm"
          >
            <Brain className="h-4 w-4" />
            Test Live AI
          </Button>
        </div>
      </div>

      {/* Metrics Summary Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="bg-card/50 shadow-none border-border/60">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Live Ground Truth</p>
              <h3 className="text-xl font-bold mt-0.5">{stats.kbWords} words</h3>
              <p className="text-[11px] text-muted-foreground">{stats.kbCharacters.toLocaleString()} characters</p>
            </div>
            <div className="p-2.5 bg-primary/10 rounded-lg text-primary">
              <BookOpen className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/50 shadow-none border-border/60">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Active FAQs</p>
              <h3 className="text-xl font-bold mt-0.5">{stats.faqCount}</h3>
              <p className="text-[11px] text-muted-foreground">Instant matching Q&As</p>
            </div>
            <div className="p-2.5 bg-emerald-500/10 rounded-lg text-emerald-500">
              <HelpCircle className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/50 shadow-none border-border/60">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Max Upload Limit</p>
              <h3 className="text-xl font-bold mt-0.5">50 MB</h3>
              <p className="text-[11px] text-muted-foreground">Any document format</p>
            </div>
            <div className="p-2.5 bg-blue-500/10 rounded-lg text-blue-500">
              <UploadCloud className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/50 shadow-none border-border/60">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground">AI Synchronization</p>
              <h3 className="text-xl font-bold mt-0.5 text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4" /> Live
              </h3>
              <p className="text-[11px] text-muted-foreground">WhatsApp Auto-Responder</p>
            </div>
            <div className="p-2.5 bg-purple-500/10 rounded-lg text-purple-500">
              <Brain className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Tabs Workspace */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="bg-muted/70 p-1 border border-border/40 grid grid-cols-2 md:grid-cols-4 max-w-2xl">
          <TabsTrigger value="scanner" className="gap-1.5 text-xs md:text-sm">
            <UploadCloud className="h-4 w-4" />
            Document Scanner
          </TabsTrigger>
          <TabsTrigger value="knowledge-base" className="gap-1.5 text-xs md:text-sm">
            <BookOpen className="h-4 w-4" />
            Knowledge Base
          </TabsTrigger>
          <TabsTrigger value="faqs" className="gap-1.5 text-xs md:text-sm">
            <HelpCircle className="h-4 w-4" />
            FAQ Library ({stats.faqCount})
          </TabsTrigger>
          <TabsTrigger value="playground" className="gap-1.5 text-xs md:text-sm">
            <Brain className="h-4 w-4" />
            AI Playground
          </TabsTrigger>
        </TabsList>

        {/* ─── TAB 1: DOCUMENT SCANNER (UP TO 50MB) ─────────────────────────── */}
        <TabsContent value="scanner" className="space-y-6 focus-visible:outline-none">
          <Card className="border-border/60">
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-primary" />
                    Auto-Analyze Business Documents (Up to 50MB)
                  </CardTitle>
                  <CardDescription>
                    Upload clinic brochures, rate charts, hospital guides, doctor schedules, or standard operating
                    procedures. The AI reads every detail with expert clinical precision.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs bg-muted/50">
                    PDF • DOCX • XLS • XLSX • CSV • TXT
                  </Badge>
                  <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 text-xs">
                    50MB Max
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Drag and Drop Zone */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragOver(true);
                }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={handleFileDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
                  isDragOver
                    ? "border-primary bg-primary/5 scale-[1.005]"
                    : selectedFile
                    ? "border-emerald-500/50 bg-emerald-500/5"
                    : "border-border/80 hover:border-primary/50 hover:bg-muted/40"
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.md,.json"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      handleFileSelected(e.target.files[0]);
                    }
                  }}
                />

                <div className="flex flex-col items-center justify-center space-y-3">
                  <div className="p-4 rounded-full bg-primary/10 text-primary">
                    <UploadCloud className="h-8 w-8" />
                  </div>
                  {selectedFile ? (
                    <div>
                      <p className="font-semibold text-base text-foreground flex items-center justify-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                        {selectedFile.name}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        File size: {(selectedFile.size / 1024 / 1024).toFixed(2)} MB • Ready for expert scanning
                      </p>
                    </div>
                  ) : (
                    <div>
                      <p className="font-semibold text-base text-foreground">
                        Drop your document here, or <span className="text-primary underline">browse</span>
                      </p>
                      <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
                        Supports any document up to 50MB. Scans pricing, doctor profiles, treatments, timings, and
                        policies with zero manual copy-pasting.
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Action Button & Progress */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2">
                <div className="text-xs text-muted-foreground flex items-center gap-2">
                  <Info className="h-4 w-4 text-muted-foreground/80 shrink-0" />
                  <span>The AI strictly respects ground-truth details and does not invent unmentioned facts.</span>
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto">
                  {selectedFile && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSelectedFile(null);
                        setExtractedData(null);
                      }}
                      disabled={analyzing}
                      className="text-xs text-muted-foreground"
                    >
                      Clear
                    </Button>
                  )}
                  <Button
                    onClick={handleScanDocument}
                    disabled={!selectedFile || analyzing}
                    className="w-full sm:w-auto gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-medium"
                  >
                    {analyzing ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {analysisProgress || "Scanning Document..."}
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4" />
                        Scan & Auto-Extract Knowledge
                      </>
                    )}
                  </Button>
                </div>
              </div>

              {/* Extracted Results Panel */}
              {extractedData && (
                <div className="mt-8 space-y-6 border-t border-border/60 pt-6 animate-in fade-in-50 duration-300">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-muted/40 p-4 rounded-xl border border-border/60">
                    <div>
                      <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 mb-1">
                        Extraction Successful
                      </Badge>
                      <h3 className="text-base font-semibold text-foreground">
                        {extractedData.businessDetails.clinicName || "Clinic Knowledge Extracted"}
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        Scanned from <span className="font-medium text-foreground">{extractedData.fileName}</span> (
                        {extractedData.fileSizeFormatted}) • {extractedData.charCount.toLocaleString()} characters analyzed
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        onClick={handleSaveExtractedToKnowledgeBase}
                        disabled={savingExtracted}
                        className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
                      >
                        {savingExtracted ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Saving to Knowledge Base...
                          </>
                        ) : (
                          <>
                            <Save className="h-4 w-4" />
                            Save to Knowledge Base & Sync AI
                          </>
                        )}
                      </Button>
                    </div>
                  </div>

                  {/* Highlights Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Clinic Identity Card */}
                    <Card className="bg-card/40 border-border/60">
                      <CardHeader className="p-4 pb-2">
                        <CardTitle className="text-sm font-semibold flex items-center gap-2">
                          <MapPin className="h-4 w-4 text-primary" />
                          Business Identity & Contact
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-4 pt-1 space-y-1.5 text-xs text-muted-foreground">
                        {extractedData.businessDetails.tagline && (
                          <p className="italic text-foreground/80">&ldquo;{extractedData.businessDetails.tagline}&rdquo;</p>
                        )}
                        {extractedData.businessDetails.phone && (
                          <p className="flex items-center gap-1.5">
                            <Phone className="h-3 w-3 text-primary" />
                            <span className="text-foreground">{extractedData.businessDetails.phone}</span>
                          </p>
                        )}
                        {extractedData.businessDetails.workingHours && (
                          <p className="flex items-center gap-1.5">
                            <Clock className="h-3 w-3 text-primary" />
                            <span>{extractedData.businessDetails.workingHours}</span>
                          </p>
                        )}
                        {extractedData.businessDetails.address && (
                          <p className="text-[11px]">{extractedData.businessDetails.address}</p>
                        )}
                      </CardContent>
                    </Card>

                    {/* Doctors & Team */}
                    <Card className="bg-card/40 border-border/60">
                      <CardHeader className="p-4 pb-2">
                        <CardTitle className="text-sm font-semibold flex items-center gap-2">
                          <Stethoscope className="h-4 w-4 text-emerald-500" />
                          Doctors & Specialists ({extractedData.doctors.length})
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-4 pt-1 text-xs space-y-2 max-h-40 overflow-y-auto">
                        {extractedData.doctors.length === 0 ? (
                          <p className="text-muted-foreground italic">No individual doctor profiles listed.</p>
                        ) : (
                          extractedData.doctors.map((d, i) => (
                            <div key={i} className="border-b border-border/40 pb-1.5 last:border-0 last:pb-0">
                              <p className="font-semibold text-foreground">{d.name}</p>
                              <p className="text-[11px] text-muted-foreground">
                                {d.specialization} {d.qualification ? `• ${d.qualification}` : ""}
                              </p>
                              {d.timing && <p className="text-[10px] text-primary">{d.timing}</p>}
                            </div>
                          ))
                        )}
                      </CardContent>
                    </Card>

                    {/* Services & Pricing */}
                    <Card className="bg-card/40 border-border/60">
                      <CardHeader className="p-4 pb-2">
                        <CardTitle className="text-sm font-semibold flex items-center gap-2">
                          <DollarSign className="h-4 w-4 text-blue-500" />
                          Services & Pricing ({extractedData.services.length})
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-4 pt-1 text-xs space-y-2 max-h-40 overflow-y-auto">
                        {extractedData.services.length === 0 ? (
                          <p className="text-muted-foreground italic">General services detected in knowledge base.</p>
                        ) : (
                          extractedData.services.map((s, i) => (
                            <div key={i} className="flex items-center justify-between border-b border-border/40 pb-1.5 last:border-0 last:pb-0">
                              <span className="font-medium text-foreground">{s.name}</span>
                              <Badge variant="outline" className="text-[10px] font-mono">
                                {s.price || "Contact Clinic"}
                              </Badge>
                            </div>
                          ))
                        )}
                      </CardContent>
                    </Card>
                  </div>

                  {/* Ground Truth Markdown Textarea */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-semibold flex items-center gap-2">
                        <BookOpen className="h-4 w-4 text-primary" />
                        Synthesized Ground-Truth Knowledge Base (Editable)
                      </Label>
                      <span className="text-xs text-muted-foreground">
                        {editableExtractedKb.length.toLocaleString()} characters
                      </span>
                    </div>
                    <Textarea
                      value={editableExtractedKb}
                      onChange={(e) => setEditableExtractedKb(e.target.value)}
                      rows={10}
                      className="font-mono text-xs leading-relaxed bg-background resize-y"
                      placeholder="Synthesized clinic knowledge base text..."
                    />
                    <p className="text-[11px] text-muted-foreground">
                      This text becomes the absolute ground-truth context injected into your WhatsApp AI assistant.
                    </p>
                  </div>

                  {/* Extracted FAQs Review */}
                  <div className="space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <Label className="text-sm font-semibold flex items-center gap-2">
                          <HelpCircle className="h-4 w-4 text-emerald-500" />
                          Extracted FAQs ({extractedData.faqs.length})
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          {selectedFaqIndexes.size} of {extractedData.faqs.length} FAQs selected to import
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button variant="outline" size="sm" onClick={toggleSelectAllFaqs} className="text-xs h-8">
                          {selectedFaqIndexes.size === extractedData.faqs.length ? (
                            <>
                              <Square className="h-3.5 w-3.5 mr-1" /> Deselect All
                            </>
                          ) : (
                            <>
                              <CheckSquare className="h-3.5 w-3.5 mr-1" /> Select All
                            </>
                          )}
                        </Button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-96 overflow-y-auto pr-1">
                      {extractedData.faqs.map((faq, idx) => {
                        const isSelected = selectedFaqIndexes.has(idx);
                        return (
                          <div
                            key={idx}
                            onClick={() => toggleFaqIndex(idx)}
                            className={`p-3.5 rounded-lg border transition-all cursor-pointer ${
                              isSelected
                                ? "bg-primary/5 border-primary/40 shadow-sm"
                                : "bg-card/40 border-border/50 opacity-60 hover:opacity-100"
                            }`}
                          >
                            <div className="flex items-start gap-2.5">
                              <div className="mt-0.5">
                                {isSelected ? (
                                  <CheckSquare className="h-4 w-4 text-primary" />
                                ) : (
                                  <Square className="h-4 w-4 text-muted-foreground" />
                                )}
                              </div>
                              <div className="space-y-1 flex-1">
                                <p className="font-semibold text-xs text-foreground">{faq.question}</p>
                                <p className="text-xs text-muted-foreground leading-relaxed">{faq.answer}</p>
                                {faq.keywords && (
                                  <div className="flex flex-wrap gap-1 mt-1 pt-1 border-t border-border/30">
                                    {faq.keywords.split(",").map((kw, ki) => (
                                      <Badge key={ki} variant="outline" className="text-[9px] py-0 px-1 bg-muted/40">
                                        {kw.trim()}
                                      </Badge>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Save Settings & Trigger */}
                  <div className="p-4 rounded-xl bg-card border border-border/60 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div className="space-y-2">
                      <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
                        <input
                          type="checkbox"
                          checked={replaceExistingFaqs}
                          onChange={(e) => setReplaceExistingFaqs(e.target.checked)}
                          className="rounded border-border text-primary focus:ring-primary h-4 w-4"
                        />
                        <span>Replace existing FAQs (uncheck to append to current FAQs)</span>
                      </label>
                      <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
                        <input
                          type="checkbox"
                          checked={updateContactDetails}
                          onChange={(e) => setUpdateContactDetails(e.target.checked)}
                          className="rounded border-border text-primary focus:ring-primary h-4 w-4"
                        />
                        <span>Update clinic profile contact details (phone, address, website) if detected</span>
                      </label>
                    </div>

                    <Button
                      size="lg"
                      onClick={handleSaveExtractedToKnowledgeBase}
                      disabled={savingExtracted}
                      className="w-full sm:w-auto gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
                    >
                      {savingExtracted ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Saving & Training AI...
                        </>
                      ) : (
                        <>
                          <Save className="h-4 w-4" />
                          Save & Synchronize WhatsApp AI
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── TAB 2: ACTIVE KNOWLEDGE BASE EDITOR ─────────────────────────── */}
        <TabsContent value="knowledge-base" className="space-y-6 focus-visible:outline-none">
          <Card className="border-border/60">
            <CardHeader className="pb-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <BookOpen className="h-5 w-5 text-primary" />
                    Live Ground-Truth Knowledge Base
                  </CardTitle>
                  <CardDescription>
                    Directly view and edit the operational knowledge stored for your clinic. Any changes saved here are
                    immediately accessible by your WhatsApp AI assistant.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    onClick={handleSaveKnowledgeBase}
                    disabled={savingKb}
                    className="gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground"
                  >
                    {savingKb ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Save Knowledge Base
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Quick Template Insert Pills */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground mr-1">Insert section:</span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() =>
                    setKnowledgeBaseText(
                      (prev) =>
                        prev +
                        `\n\n### DOCTOR PROFILE:\n- **Dr. Name**: Specialization\n- **Consultation Hours**: Mon-Sat 10:00 AM - 1:00 PM\n- **Fee**: ₹500`
                    )
                  }
                >
                  + Doctor Profile
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() =>
                    setKnowledgeBaseText(
                      (prev) =>
                        prev +
                        `\n\n### SERVICE & PRICING:\n- **Service Name**: Description (Fee: ₹800, Duration: 30 mins)`
                    )
                  }
                >
                  + Service & Fee
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() =>
                    setKnowledgeBaseText(
                      (prev) =>
                        prev +
                        `\n\n### BOOKING & CANCELLATION RULES:\n- Advance booking recommended at least 2 hours prior.\n- Free cancellation up to 4 hours before the appointment slot.`
                    )
                  }
                >
                  + Booking Policy
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() =>
                    setKnowledgeBaseText(
                      (prev) =>
                        prev +
                        `\n\n### EMERGENCY & TRIAGE:\n- In case of chest pain, severe trauma, or acute breathing difficulty, patients must report immediately to the nearest ER.`
                    )
                  }
                >
                  + Emergency Protocol
                </Button>
              </div>

              <Textarea
                value={knowledgeBaseText}
                onChange={(e) => setKnowledgeBaseText(e.target.value)}
                rows={18}
                className="font-mono text-xs leading-relaxed bg-background"
                placeholder="Enter or paste authoritative ground truth information about your clinic..."
              />

              <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
                <span>
                  Word Count: {knowledgeBaseText.trim() ? knowledgeBaseText.trim().split(/\s+/).length : 0} • Characters:{" "}
                  {knowledgeBaseText.length.toLocaleString()}
                </span>
                <span className="text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Synchronized with WhatsApp Auto-Responder
                </span>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── TAB 3: FAQ LIBRARY ─────────────────────────────────────────── */}
        <TabsContent value="faqs" className="space-y-6 focus-visible:outline-none">
          <Card className="border-border/60">
            <CardHeader className="pb-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <HelpCircle className="h-5 w-5 text-emerald-500" />
                    Frequently Asked Questions Library
                  </CardTitle>
                  <CardDescription>
                    These curated Q&As are matched with patient questions on WhatsApp for instant, highly accurate
                    replies.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button onClick={handleOpenAddFaq} className="gap-1.5" size="sm">
                    <Plus className="h-4 w-4" /> Add Single FAQ
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Search Bar */}
              <div className="relative max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search FAQs by question, answer, or keyword..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 h-9 text-xs"
                />
              </div>

              {/* FAQs Grid / Cards */}
              {loading ? (
                <div className="py-12 text-center text-muted-foreground text-sm">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2 text-primary" />
                  Loading FAQs...
                </div>
              ) : filteredFaqs.length === 0 ? (
                <div className="py-12 text-center border-2 border-dashed rounded-xl p-6">
                  <HelpCircle className="h-10 w-10 text-muted-foreground/40 mx-auto mb-2" />
                  <p className="text-sm font-semibold text-foreground">No FAQs Found</p>
                  <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                    {searchQuery
                      ? "No questions match your search query."
                      : "Upload a document in the Document Scanner tab or add your first FAQ manually."}
                  </p>
                  {!searchQuery && (
                    <Button onClick={handleOpenAddFaq} variant="outline" size="sm" className="mt-4 gap-1.5 text-xs">
                      <Plus className="h-3.5 w-3.5" /> Add FAQ
                    </Button>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {filteredFaqs.map((faq) => (
                    <Card key={faq.id} className="bg-card/50 border-border/50 hover:border-border transition-all">
                      <CardContent className="p-4 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="font-semibold text-xs md:text-sm text-foreground leading-snug">
                            {faq.question}
                          </h4>
                          <div className="flex items-center gap-1 shrink-0">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-foreground"
                              onClick={() => handleOpenEditFaq(faq)}
                            >
                              <Edit className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              onClick={() => handleDeleteFaq(faq.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>

                        <p className="text-xs text-muted-foreground leading-relaxed">{faq.answer}</p>

                        {faq.keywords && (
                          <div className="flex flex-wrap gap-1 pt-2 border-t border-border/30">
                            {faq.keywords.split(",").map((kw, i) => (
                              <Badge key={i} variant="secondary" className="text-[10px] py-0 px-1.5 font-normal">
                                {kw.trim()}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── TAB 4: AI TEST PLAYGROUND ──────────────────────────────────── */}
        <TabsContent value="playground" className="space-y-6 focus-visible:outline-none">
          <Card className="border-border/60">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Brain className="h-5 w-5 text-primary" />
                    Interactive AI Test Sandbox
                  </CardTitle>
                  <CardDescription>
                    Test questions directly against your clinic&apos;s Knowledge Base to verify how your WhatsApp AI will
                    respond before going live.
                  </CardDescription>
                </div>
                <Badge variant="outline" className="text-xs font-mono">
                  Ground Truth Mode
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Chat Simulation Area */}
              <div className="border rounded-xl p-4 min-h-[380px] max-h-[460px] overflow-y-auto space-y-3 bg-muted/20">
                {testHistory.map((msg, i) => (
                  <div
                    key={i}
                    className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-xs leading-relaxed ${
                        msg.role === "user"
                          ? "bg-primary text-primary-foreground rounded-br-sm"
                          : "bg-card border border-border/60 text-white rounded-bl-sm shadow-sm"
                      }`}
                    >
                      {msg.role === "ai" && (
                        <div className="flex items-center gap-1.5 text-[10px] font-semibold text-primary mb-1">
                          <Sparkles className="h-3 w-3" /> WhatsApp AI Assistant
                        </div>
                      )}
                      <div className="whitespace-pre-wrap">{msg.text}</div>
                    </div>
                  </div>
                ))}
                {testingAi && (
                  <div className="flex justify-start">
                    <div className="bg-card border border-border/60 rounded-2xl px-4 py-2 text-xs flex items-center gap-2 text-muted-foreground shadow-sm">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                      Consulting Knowledge Base...
                    </div>
                  </div>
                )}
              </div>

              {/* Input Form */}
              <form onSubmit={handleTestAiQuery} className="flex gap-2">
                <Input
                  value={testQuery}
                  onChange={(e) => setTestQuery(e.target.value)}
                  placeholder="Ask a test question (e.g. 'What are your consultation timings?', 'How much is a cleanup?')..."
                  className="text-xs h-10"
                  disabled={testingAi}
                />
                <Button
                  type="submit"
                  disabled={!testQuery.trim() || testingAi}
                  className="gap-1.5 h-10 px-4 bg-primary hover:bg-primary/90 text-primary-foreground"
                >
                  <Send className="h-4 w-4" />
                  Send
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Single FAQ Modal (Add/Edit) */}
      <Dialog open={isFaqModalOpen} onOpenChange={setIsFaqModalOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{editingFaq ? "Edit FAQ" : "Add New FAQ"}</DialogTitle>
            <DialogDescription>
              Create or modify a frequently asked question for WhatsApp patient matching.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveSingleFaq} className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="question" className="text-xs">
                Patient Question <span className="text-destructive">*</span>
              </Label>
              <Input
                id="question"
                placeholder="e.g. What are your opening hours?"
                value={faqForm.question}
                onChange={(e) => setFaqForm({ ...faqForm, question: e.target.value })}
                className="text-xs"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="answer" className="text-xs">
                Clinic Answer <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="answer"
                placeholder="e.g. We are open Monday to Saturday from 9 AM to 8 PM."
                value={faqForm.answer}
                onChange={(e) => setFaqForm({ ...faqForm, answer: e.target.value })}
                rows={4}
                className="text-xs"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="keywords" className="text-xs">
                Trigger Keywords (comma separated)
              </Label>
              <Input
                id="keywords"
                placeholder="e.g. hours, timings, schedule, open, close"
                value={faqForm.keywords}
                onChange={(e) => setFaqForm({ ...faqForm, keywords: e.target.value })}
                className="text-xs"
              />
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setIsFaqModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={savingFaq}>
                {savingFaq && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                {editingFaq ? "Save Changes" : "Create FAQ"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
