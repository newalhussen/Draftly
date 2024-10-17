import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { getUser } from "@/lib/session";

export const metadata = { title: "Register" };

export default async function Register() {
  if (await getUser()) redirect("/");
  return <AuthForm mode="register" />;
}
