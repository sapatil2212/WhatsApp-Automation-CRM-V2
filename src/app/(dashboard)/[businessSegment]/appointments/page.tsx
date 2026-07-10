"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useParams } from "next/navigation";
import { getTerminology } from "@/lib/business/terminology";
import { toast } from "sonner";
import {
  CalendarDays,
  Clock,
  Search,
  Plus,
  Trash2,
  Edit2,
  CheckCircle2,
  XCircle,
  Filter,
  Calendar,
  ChevronLeft,
  ChevronRight,
  User,
  Users,
  MessageSquare,
  Send,
  Loader2,
} from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";

export default function BookingsManagement() {
  const params = useParams();
  const businessSegment = params.businessSegment as string;
  const term = getTerminology(businessSegment);

  const db = createClient();
  const [loading, setLoading] = useState(true);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [bookings, setBookings] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "confirmed" | "completed" | "cancelled">("all");

  // Dialog states
  const [isOpen, setIsOpen] = useState(false);
  const [editingBooking, setEditingBooking] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [bookingToDelete, setBookingToDelete] = useState<string | null>(null);

  // Form states
  const [form, setForm] = useState({
    contact_id: "",
    contact_name: "",
    contact_phone: "",
    preferred_date: "",
    preferred_time: "",
    status: "pending",
    notes: "",
  });

  const loadBookings = async (bId: string) => {
    const { data, error } = await db
      .from("business_enquiries")
      .select("*")
      .eq("business_id", bId)
      .order("preferred_date", { ascending: false });

    if (error) {
      console.error("Error loading bookings:", error);
      toast.error("Failed to load bookings list.");
    } else {
      setBookings(data || []);
    }
  };

  const loadContacts = async () => {
    const { data, error } = await db
      .from("contacts")
      .select("id, name, phone")
      .order("name");

    if (error) console.error("Error loading contacts:", error);
    else setContacts(data || []);
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
          await Promise.all([loadBookings(business.id), loadContacts()]);
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
    setEditingBooking(null);
    setForm({
      contact_id: "",
      contact_name: "",
      contact_phone: "",
      preferred_date: new Date().toISOString().split("T")[0],
      preferred_time: "10:00",
      status: "pending",
      notes: "",
    });
    setIsOpen(true);
  };

  const handleOpenEdit = (booking: any) => {
    setEditingBooking(booking);
    setForm({
      contact_id: booking.contact_id || "",
      contact_name: booking.contact_name || "",
      contact_phone: booking.contact_phone || "",
      preferred_date: booking.preferred_date || "",
      preferred_time: booking.preferred_time || "",
      status: booking.status || "pending",
      notes: booking.notes || "",
    });
    setIsOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessId) return;

    setSaving(true);
    try {
      const selectedContact = contacts.find(c => c.id === form.contact_id);
      const payload = {
        business_id: businessId,
        contact_id: form.contact_id || null,
        contact_name: selectedContact ? selectedContact.name : form.contact_name,
        contact_phone: selectedContact ? selectedContact.phone : form.contact_phone,
        preferred_date: form.preferred_date,
        preferred_time: form.preferred_time,
        status: form.status,
        notes: form.notes,
      };

      if (editingBooking) {
        const { error } = await db
          .from("business_enquiries")
          .update(payload)
          .eq("id", editingBooking.id);

        if (error) throw error;
        toast.success("Booking updated successfully.");
      } else {
        const { error } = await db
          .from("business_enquiries")
          .insert(payload);

        if (error) throw error;
        toast.success("Booking created successfully.");
      }

      setIsOpen(false);
      await loadBookings(businessId);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to save booking.");
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!bookingToDelete || !businessId) return;
    try {
      const { error } = await db
        .from("business_enquiries")
        .delete()
        .eq("id", bookingToDelete);

      if (error) throw error;
      toast.success("Booking deleted successfully.");
      setDeleteOpen(false);
      await loadBookings(businessId);
    } catch (err: any) {
      toast.error(err.message || "Failed to delete booking.");
    }
  };

  const handleStatusChange = async (id: string, newStatus: string) => {
    if (!businessId) return;
    try {
      const { error } = await db
        .from("business_enquiries")
        .update({ status: newStatus })
        .eq("id", id);

      if (error) throw error;
      toast.success(`Booking marked as ${newStatus}.`);
      await loadBookings(businessId);
    } catch (err: any) {
      toast.error(err.message || "Failed to update booking status.");
    }
  };

  const filteredBookings = bookings.filter((b) => {
    const matchesSearch =
      b.contact_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      b.contact_phone?.includes(searchQuery) ||
      b.notes?.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus = statusFilter === "all" || b.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!businessId) {
    return (
      <div className="flex h-[50vh] flex-col items-center justify-center text-center">
        <AlertCircle className="h-10 w-10 text-slate-500 mb-3" />
        <h3 className="text-lg font-bold text-white">No Business Profile Found</h3>
        <p className="text-sm text-slate-400 mt-1">Please complete the setup wizard first.</p>
        <Link href={`/${businessSegment}/setup`} className="mt-4">
          <Button>Setup Business</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <CalendarDays className="h-6 w-6 text-primary" />
            {term.bookingPluralLabel} Management
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Manage upcoming scheduling and bookings for your business.
          </p>
        </div>
        <Button onClick={handleOpenAdd} className="bg-primary text-primary-foreground hover:bg-primary/95">
          <Plus className="h-4 w-4 mr-2" /> Add Booking
        </Button>
      </div>

      {/* Filters Row */}
      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Search bookings..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9 border-slate-800 bg-slate-900 text-xs"
          />
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Filter className="h-4 w-4 text-slate-400 hidden sm:block" />
          <select
            value={statusFilter}
            onChange={(e: any) => setStatusFilter(e.target.value)}
            className="h-9 rounded-md border border-slate-800 bg-slate-900 px-3 text-xs text-white focus:outline-none cursor-pointer"
          >
            <option value="all">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="confirmed">Confirmed</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </div>

      {/* Bookings List Card */}
      <Card className="border-slate-800 bg-slate-900/60 backdrop-blur-md">
        <CardContent className="p-6">
          {filteredBookings.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Calendar className="h-12 w-12 text-slate-700 mb-3" />
              <p className="text-sm text-slate-400">No {term.bookingPluralLabel.toLowerCase()} found.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    <th className="pb-3 font-medium">Customer</th>
                    <th className="pb-3 font-medium">Date & Time</th>
                    <th className="pb-3 font-medium">Notes</th>
                    <th className="pb-3 font-medium">Status</th>
                    <th className="pb-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 text-sm">
                  {filteredBookings.map((b) => (
                    <tr key={b.id} className="hover:bg-slate-800/10 transition-colors">
                      <td className="py-4">
                        <div className="font-medium text-white">{b.contact_name}</div>
                        <div className="text-xs text-slate-500">{b.contact_phone}</div>
                      </td>
                      <td className="py-4 text-slate-300">
                        <div>{b.preferred_date}</div>
                        <div className="text-xs text-slate-500">{b.preferred_time}</div>
                      </td>
                      <td className="py-4 text-slate-400 text-xs max-w-xs truncate">
                        {b.notes || <span className="italic text-slate-600">None</span>}
                      </td>
                      <td className="py-4">
                        <Badge
                          className={`px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                            b.status === "pending"
                              ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                              : b.status === "confirmed" || b.status === "completed"
                              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                              : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                          }`}
                        >
                          {b.status}
                        </Badge>
                      </td>
                      <td className="py-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {b.status === "pending" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleStatusChange(b.id, "confirmed")}
                              title="Confirm Booking"
                              className="h-8 w-8 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
                            >
                              <CheckCircle2 className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleOpenEdit(b)}
                            className="h-8 w-8 text-slate-400 hover:text-white"
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              setBookingToDelete(b.id);
                              setDeleteOpen(true);
                            }}
                            className="h-8 w-8 text-slate-400 hover:text-red-400"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add / Edit Dialog */}
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="border-slate-800 bg-slate-900 text-white max-w-md">
          <DialogHeader>
            <DialogTitle>{editingBooking ? "Edit Booking" : "New Booking"}</DialogTitle>
            <DialogDescription className="text-slate-400 text-xs">
              Fill in the scheduling details below.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-1">
              <Label className="text-xs">Select Client (Optional)</Label>
              <select
                value={form.contact_id}
                onChange={(e) => setForm({ ...form, contact_id: e.target.value })}
                className="w-full h-9 rounded-md border border-slate-800 bg-slate-950 px-3 text-xs focus:outline-none"
              >
                <option value="">-- Create new client details below --</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.phone})
                  </option>
                ))}
              </select>
            </div>

            {!form.contact_id && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Client Name</Label>
                  <Input
                    required
                    value={form.contact_name}
                    onChange={(e) => setForm({ ...form, contact_name: e.target.value })}
                    placeholder="John Doe"
                    className="h-9 border-slate-800 bg-slate-950 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Phone Number</Label>
                  <Input
                    required
                    value={form.contact_phone}
                    onChange={(e) => setForm({ ...form, contact_phone: e.target.value })}
                    placeholder="+1234567890"
                    className="h-9 border-slate-800 bg-slate-950 text-xs"
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Preferred Date</Label>
                <Input
                  required
                  type="date"
                  value={form.preferred_date}
                  onChange={(e) => setForm({ ...form, preferred_date: e.target.value })}
                  className="h-9 border-slate-800 bg-slate-950 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Preferred Time</Label>
                <Input
                  required
                  placeholder="e.g. 10:00 AM"
                  value={form.preferred_time}
                  onChange={(e) => setForm({ ...form, preferred_time: e.target.value })}
                  className="h-9 border-slate-800 bg-slate-950 text-xs"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Status</Label>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="w-full h-9 rounded-md border border-slate-800 bg-slate-950 px-3 text-xs focus:outline-none"
              >
                <option value="pending">Pending</option>
                <option value="confirmed">Confirmed</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Notes / Enquiries</Label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Details of the booking..."
                className="w-full min-h-[80px] rounded-md border border-slate-800 bg-slate-950 p-3 text-xs focus:outline-none"
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
        title="Delete Booking"
        description="Are you sure you want to delete this booking record? This cannot be undone."
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}

// Simple AlertCircle fallback icon
function AlertCircle(props: any) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}
