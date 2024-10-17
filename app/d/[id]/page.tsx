import { notFound, redirect } from "next/navigation";
import { Editor } from "@/components/editor";
import { UUID } from "@/lib/api";
import { roleFor } from "@/lib/permissions";
import { getUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getUser();
  if (!user) redirect("/login");
  if (!UUID.test(id) || !(await roleFor(id, user.id))) notFound();
  return <Editor id={id} userName={user.name} />;
}
