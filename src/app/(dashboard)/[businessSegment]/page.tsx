import { redirect } from "next/navigation";

export default async function BusinessPage({
  params,
}: {
  params: Promise<{ businessSegment: string }>;
}) {
  const { businessSegment } = await params;
  redirect(`/${businessSegment}/dashboard`);
}
