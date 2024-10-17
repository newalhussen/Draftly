import { redirect } from "next/navigation";
import { DocumentList } from "@/components/document-list";
import { getUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (!(await getUser())) redirect("/login");
  return <DocumentList />;
}
