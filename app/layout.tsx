import type { Metadata } from "next";
import Link from "next/link";
import { SignOut } from "@/components/sign-out";
import { getUser } from "@/lib/session";
import "./globals.css";

export const metadata: Metadata = { title: { default: "Draftly", template: "%s · Draftly" }, description: "Collaborative Markdown editor" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="border-b border-line bg-card">
          <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2.5">
            <Link href="/" className="flex items-center gap-2 font-semibold">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
              Draftly
            </Link>
            <span className="flex-1" />
            {user ? (<><span className="hidden text-sm text-muted sm:inline">{user.name}</span><SignOut /></>) : (<><Link className="btn" href="/login">Sign in</Link><Link className="btn btn-primary" href="/register">Register</Link></>)}
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
