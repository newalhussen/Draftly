import { cookies } from "next/headers";
import { SESSION_COOKIE, userForToken } from "./auth";

/** The signed-in user for server components, or null. */
export async function getUser() {
  return userForToken((await cookies()).get(SESSION_COOKIE)?.value);
}
