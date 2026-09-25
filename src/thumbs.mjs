// One HTML row of linked screenshot thumbnails for a pull-request comment.
//
//   thumbsHtml({ dir, siteUrl, max: 4 }) -> "<a ...><img ...></a> <a ...>..."
//
// The evidence site copies every screenshot to its root, so each thumbnail
// links to <siteUrl>/<file>. Same natural sort and captions as the site.
// GitHub and GitLab both render this HTML inside a Markdown comment.
import { existsSync, readdirSync } from "node:fs";

// "2-settings-toggle.png" -> "Settings toggle"
export const caption = (f) => {
  const s = f
    .replace(/\.[^.]+$/, "")
    .replace(/^\d+[-_ ]*/, "")
    .replace(/[-_]+/g, " ")
    .trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : f;
};

const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");

export function listScreenshots(dir) {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /\.(png|jpe?g)$/i.test(f))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export function thumbsHtml({ dir, siteUrl, max = 4, width = 150 } = {}) {
  if (!siteUrl) return "";
  const base = String(siteUrl).replace(/\/+$/, "");
  const images = listScreenshots(dir).slice(0, max);
  if (!images.length) return "";
  // Kept on one line so GitHub renders the images as a row.
  return images
    .map((f) => {
      const href = `${base}/${encodeURIComponent(f)}`;
      const cap = esc(caption(f));
      return `<a href="${href}"><img src="${href}" alt="${cap}" title="${cap}" width="${width}" /></a>`;
    })
    .join(" ");
}
