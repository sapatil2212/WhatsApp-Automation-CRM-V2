"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useParams } from "next/navigation";
import { getTerminology } from "@/lib/business/terminology";
import { toast } from "sonner";
import { Plus, Trash2, Edit2, Loader2, Bot, Shield, User } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";

export default function StaffManagement() {
  const params = useParams();
  const businessSegment = params.businessSegment as string;
  const term = getTerminology(businessSegment);

  const db = createClient();
  const [loading, setLoading] = useState(true);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [staffList, setStaffList] = useState<any[]>([]);

  // Modal states
  const [isOpen, setIsOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [staffToDelete, setStaffToDelete] = useState<string | null>(null);

  // Form states
  const [form, setForm] = useState({
    name: "",
    role: "",
    specialization: "",
    qualification: "",
    phone: "",
  });

  const loadStaff = async (bId: string) => {
    const { data, error } = await db
      .from("business_staff")
      .select("*")
      .eq("business_id", bId)
      .order("name");

    if (error) {
      console.error("Error loading staff:", error);
      toast.error("Failed to load staff list.");
    } else {
      setStaffList(data || []);
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
          await loadStaff(business.id);
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
    setEditingStaff(null);
    setForm({
      name: "",
      role: "",
      specialization: "",
      qualification: "",
      phone: "",
    });
    setIsOpen(true);
  };

  const handleOpenEdit = (staff: any) => {
    setEditingStaff(staff);
    setForm({
      name: staff.name || "",
      role: staff.role || "",
      specialization: staff.specialization || "",
      qualification: staff.qualification || "",
      phone: staff.phone || "",
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
        role: form.role.trim() || null,
        specialization: form.specialization.trim() || null,
        qualification: form.qualification.trim() || null,
        phone: form.phone.trim() || null,
        is_active: true,
      };

      if (editingStaff) {
        const { error } = await db
          .from("business_staff")
          .update(payload)
          .eq("id", editingStaff.id);
        if (error) throw error;
        toast.success(`${term.staffLabel} updated successfully.`);
      } else {
        const { error } = await db
          .from("business_staff")
          .insert(payload);
        if (error) throw error;
        toast.success(`${term.staffLabel} created successfully.`);
      }

      setIsOpen(false);
      await loadStaff(businessId);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || `Failed to save ${term.staffLabel.toLowerCase()}.`);
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!staffToDelete || !businessId) return;
    try {
      const { error } = await db
        .from("business_staff")
        .delete()
        .eq("id", staffToDelete);

      if (error) throw error;
      toast.success(`${term.staffLabel} deleted successfully.`);
      setDeleteOpen(false);
      await loadStaff(businessId);
    } catch (err: any) {
      toast.error(err.message || `Failed to delete ${term.staffLabel.toLowerCase()}.`);
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
            <Bot className="h-6 w-6 text-primary" />
            Manage {term.staffPluralLabel}
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            View and manage the {term.staffPluralLabel.toLowerCase()} assigned to bookable sessions and customer requests.
          </p>
        </div>
        <Button onClick={handleOpenAdd} className="bg-primary text-primary-foreground hover:bg-primary/95">
          <Plus className="h-4 w-4 mr-2" /> Add {term.staffLabel}
        </Button>
      </div>

      {/* Staff List Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {staffList.length === 0 ? (
          <Card className="col-span-full border-slate-800 bg-slate-900/60 p-12 text-center">
            <User className="h-12 w-12 text-slate-700 mx-auto mb-3" />
            <p className="text-sm text-slate-400">No {term.staffPluralLabel.toLowerCase()} found.</p>
          </Card>
        ) : (
          staffList.map((staff) => (
            <Card key={staff.id} className="border-slate-800 bg-slate-900/60 hover:border-slate-700 transition-all">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div className="flex items-center gap-2">
                  <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                    {staff.name?.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <CardTitle className="text-sm font-bold text-white">{staff.name}</CardTitle>
                    <CardDescription className="text-[11px] text-slate-400">{staff.role || "Staff Member"}</CardDescription>
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleOpenEdit(staff)}
                    className="h-8 w-8 text-slate-400 hover:text-white"
                  >
                    <Edit2 className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      setStaffToDelete(staff.id);
                      setDeleteOpen(true);
                    }}
                    className="h-8 w-8 text-slate-400 hover:text-red-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-2 text-xs space-y-2 text-slate-300">
                <div className="flex justify-between border-b border-slate-850 pb-1.5">
                  <span className="text-slate-500">Specialty</span>
                  <span className="font-semibold text-white">{staff.specialization || "General"}</span>
                </div>
                <div className="flex justify-between border-b border-slate-850 pb-1.5">
                  <span className="text-slate-500">Qualification</span>
                  <span className="text-slate-400">{staff.qualification || "N/A"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Phone</span>
                  <span className="text-slate-400">{staff.phone || "N/A"}</span>
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
            <DialogTitle>{editingStaff ? `Edit ${term.staffLabel}` : `Add New ${term.staffLabel}`}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-1">
              <Label className="text-xs">Full Name</Label>
              <Input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Name"
                className="h-9 border-slate-800 bg-slate-950 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Role / Title (e.g. Lead Stylist, Senior Consultant)</Label>
              <Input
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                placeholder="Role"
                className="h-9 border-slate-800 bg-slate-950 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{term.specializationLabel}</Label>
              <Input
                value={form.specialization}
                onChange={(e) => setForm({ ...form, specialization: e.target.value })}
                placeholder="e.g. Coloring, Engine Repair, Math"
                className="h-9 border-slate-800 bg-slate-950 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Qualifications / Experience</Label>
              <Input
                value={form.qualification}
                onChange={(e) => setForm({ ...form, qualification: e.target.value })}
                placeholder="Qualifications"
                className="h-9 border-slate-800 bg-slate-950 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Contact Phone</Label>
              <Input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="Phone"
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
        title={`Delete ${term.staffLabel}`}
        description={`Are you sure you want to remove this ${term.staffLabel.toLowerCase()}?`}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}
