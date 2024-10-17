import MarkdownIt from "markdown-it";

/**
 * Markdown to HTML for the live preview. Raw HTML in the source is escaped (html: false) and markdown-it refuses
 * javascript:, vbscript: and most data: URLs, so the output is safe to inject into the page.
 */
const md = new MarkdownIt({ html: false, linkify: true, typographer: true, breaks: false });

const defaultLink = md.renderer.rules.link_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  tokens[idx].attrSet("target", "_blank");
  tokens[idx].attrSet("rel", "noopener noreferrer nofollow");
  return defaultLink(tokens, idx, options, env, self);
};

export const renderMarkdown = (source: string): string => md.render(source.slice(0, 500_000));
