"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useParams } from "next/navigation";
import { getTerminology } from "@/lib/business/terminology";
import { toast } from "sonner";
import { Plus, Trash2, Edit2, Loader2, Package, Tag } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";

export default function ServicesManagement() {
  const params = useParams();
  const businessSegment = params.businessSegment as string;
  const term = getTerminology(businessSegment);

  const db = createClient();
  const [loading, setLoading] = useState(true);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [servicesList, setServicesList] = useState<any[]>([]);

  // Modal states
  const [isOpen, setIsOpen] = useState(false);
  const [editingService, setEditingService] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [serviceToDelete, setServiceToDelete] = useState<string | null>(null);

  // Form states
  const [form, setForm] = useState({
    name: "",
    description: "",
    price: "",
    duration_minutes: "",
    category: "",
  });

  const loadServices = async (bId: string) => {
    const { data, error } = await db
      .from("business_services")
      .select("*")
      .eq("business_id", bId)
      .order("name");

    if (error) {
      console.error("Error loading services:", error);
      toast.error("Failed to load services list.");
    } else {
      setServicesList(data || []);
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
          await loadServices(business.id);
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
    setEditingService(null);
    setForm({
      name: "",
      description: "",
      price: "",
      duration_minutes: "",
      category: "",
    });
    setIsOpen(true);
  };

  const handleOpenEdit = (service: any) => {
    setEditingService(service);
    setForm({
      name: service.name || "",
      description: service.description || "",
      price: service.price ? String(service.price) : "",
      duration_minutes: service.duration_minutes ? String(service.duration_minutes) : "",
      category: service.category || "",
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
        name: form.name.trim(),
        description: form.description.trim() || null,
        price: form.price ? Number(form.price) : null,
        duration_minutes: form.duration_minutes ? Number(form.duration_minutes) : null,
        category: form.category.trim() || null,
        is_active: true,
      };

      if (editingService) {
        const { error } = await db
          .from("business_services")
          .update(payload)
          .eq("id", editingService.id);
        if (error) throw error;
        toast.success(`${term.serviceLabel} updated successfully.`);
      } else {
        const { error } = await db
          .from("business_services")
          .insert(payload);
        if (error) throw error;
        toast.success(`${term.serviceLabel} created successfully.`);
      }

      setIsOpen(false);
      await loadServices(businessId);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || `Failed to save ${term.serviceLabel.toLowerCase()}.`);
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!serviceToDelete || !businessId) return;
    try {
      const { error } = await db
        .from("business_services")
        .delete()
        .eq("id", serviceToDelete);

      if (error) throw error;
      toast.success(`${term.serviceLabel} deleted successfully.`);
      setDeleteOpen(false);
      await loadServices(businessId);
    } catch (err: any) {
      toast.error(err.message || `Failed to delete ${term.serviceLabel.toLowerCase()}.`);
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
            <Package className="h-6 w-6 text-primary" />
            Manage {term.servicePluralLabel}
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Create and edit the different bookings services and pricing models that your clients can select.
          </p>
        </div>
        <Button onClick={handleOpenAdd} className="bg-primary text-primary-foreground hover:bg-primary/95">
          <Plus className="h-4 w-4 mr-2" /> Add Service
        </Button>
      </div>

      {/* Services Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {servicesList.length === 0 ? (
          <Card className="col-span-full border-slate-800 bg-slate-900/60 p-12 text-center">
            <Tag className="h-12 w-12 text-slate-700 mx-auto mb-3" />
            <p className="text-sm text-slate-400">No {term.servicePluralLabel.toLowerCase()} found.</p>
          </Card>
        ) : (
          servicesList.map((service) => (
            <Card key={service.id} className="border-slate-800 bg-slate-900/60 hover:border-slate-700 transition-all">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div>
                  <CardTitle className="text-sm font-bold text-white">{service.name}</CardTitle>
                  <CardDescription className="text-[10px] text-slate-400 mt-1 uppercase tracking-wider">{service.category || "General"}</CardDescription>
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleOpenEdit(service)}
                    className="h-8 w-8 text-slate-400 hover:text-white"
                  >
                    <Edit2 className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      setServiceToDelete(service.id);
                      setDeleteOpen(true);
                    }}
                    className="h-8 w-8 text-slate-400 hover:text-red-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-2 space-y-3 text-xs">
                <p className="text-slate-400 leading-relaxed min-h-[36px] line-clamp-2">
                  {service.description || "No description provided."}
                </p>
                <div className="flex justify-between border-t border-slate-850 pt-2 text-[11px] text-slate-400 font-medium">
                  <span className="flex items-center gap-1">Duration: <strong className="text-white">{service.duration_minutes || "30"} mins</strong></span>
                  <span className="flex items-center gap-1">Price: <strong className="text-emerald-400">${service.price || "0"}</strong></span>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Add / Edit Dialog */}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="border-slate-800 bg-slate-900 text-white max-w-sm">
          <DialogHeader>
            <DialogTitle>{editingService ? "Edit Service" : "Add Service"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-1">
              <Label className="text-xs">Service Name</Label>
              <Input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Service Name"
                className="h-9 border-slate-800 bg-slate-950 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Category (e.g. Haircut, Tuning, Coaching)</Label>
              <Input
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                placeholder="Category"
                className="h-9 border-slate-800 bg-slate-950 text-xs"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Price ($)</Label>
                <Input
                  required
                  type="number"
                  value={form.price}
                  onChange={(e) => setForm({ ...form, price: e.target.value })}
                  placeholder="Price"
                  className="h-9 border-slate-800 bg-slate-950 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Duration (mins)</Label>
                <Input
                  required
                  type="number"
                  value={form.duration_minutes}
                  onChange={(e) => setForm({ ...form, duration_minutes: e.target.value })}
                  placeholder="Duration"
                  className="h-9 border-slate-800 bg-slate-950 text-xs"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Service Description</Label>
              <Textarea
                value={form.description}
                onChange={(e: any) => setForm({ ...form, description: e.target.value })}
                placeholder="Details about the service..."
                className="min-h-[80px] border-slate-800 bg-slate-950 text-xs"
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
        title="Delete Service"
        description="Are you sure you want to remove this service offering?"
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}
