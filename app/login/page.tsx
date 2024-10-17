import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { getUser } from "@/lib/session";

export const metadata = { title: "Sign in" };

export default async function Login() {
  if (await getUser()) redirect("/");
  return <AuthForm mode="login" />;
}
