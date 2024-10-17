import { describe, expect, it } from "vitest";
import { hashPassword, hashToken, parseCookies, verifyPassword } from "@/lib/auth";
import { renderMarkdown } from "@/lib/markdown";
import { canEdit, canManage, canView } from "@/lib/permissions";
import { RateLimiter } from "@/lib/ratelimit";

describe("passwords", () => {
  it("hashes with a random salt and verifies only the right password", async () => {
    const a = await hashPassword("correct horse battery");
    const b = await hashPassword("correct horse battery");
    expect(a).not.toBe(b);
    expect(a).not.toContain("correct horse");
    expect(await verifyPassword("correct horse battery", a)).toBe(true);
    expect(await verifyPassword("correct horse batterY", a)).toBe(false);
    expect(await verifyPassword("x", "garbage")).toBe(false);
  });
  it("session tokens are stored hashed", () => {
    expect(hashToken("abc")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken("abc")).not.toBe("abc");
  });
  it("parses cookie headers", () => {
    expect(parseCookies("a=1; draftly_session=tok%2Fen; b=")).toMatchObject({ a: "1", draftly_session: "tok/en" });
    expect(parseCookies(undefined)).toEqual({});
  });
});

describe("permission helpers", () => {
  it("maps roles to abilities", () => {
    expect([canView(null), canEdit(null), canManage(null)]).toEqual([false, false, false]);
    expect([canView("viewer"), canEdit("viewer"), canManage("viewer")]).toEqual([true, false, false]);
    expect([canView("editor"), canEdit("editor"), canManage("editor")]).toEqual([true, true, false]);
    expect([canView("owner"), canEdit("owner"), canManage("owner")]).toEqual([true, true, true]);
  });
});

describe("markdown preview is safe", () => {
  it("renders formatting", () => {
    expect(renderMarkdown("# Title\n\n**bold** and `code`")).toContain("<h1>Title</h1>");
    expect(renderMarkdown("- a\n- b")).toContain("<li>a</li>");
  });
  it("escapes raw HTML and script injection", () => {
    const html = renderMarkdown('<script>alert(1)</script><img src=x onerror=alert(1)>');
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
  });
  it("refuses javascript: links and hardens external links", () => {
    expect(renderMarkdown("[x](javascript:alert(1))")).not.toContain('href="javascript');
    const link = renderMarkdown("[ok](https://example.com)");
    expect(link).toContain('rel="noopener noreferrer nofollow"');
    expect(link).toContain('target="_blank"');
  });
});

describe("rate limiter", () => {
  it("limits per key per window", () => {
    const l = new RateLimiter(2, 1000);
    expect([l.allow("a", 0), l.allow("a", 1), l.allow("a", 2)]).toEqual([true, true, false]);
    expect(l.allow("a", 1500)).toBe(true);
  });
});
