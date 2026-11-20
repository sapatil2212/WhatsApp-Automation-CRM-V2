import { redirect } from "next/navigation";

/** Managed inside Business Setup. */
export default async function SegmentRedirect({ params }: { params: Promise<{ businessSegment: string }> }) {
  const { businessSegment } = await params;
  redirect(`/${businessSegment}/setup`);
}
