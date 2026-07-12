import { normalizeCodeBlockTitle } from "@docmost/editor-ext";

const LANGUAGE_EXTENSIONS: Record<string, string> = {
  bash: "sh",
  c: "c",
  cpp: "cpp",
  csharp: "cs",
  css: "css",
  dockerfile: "dockerfile",
  go: "go",
  graphql: "graphql",
  html: "html",
  java: "java",
  javascript: "js",
  json: "json",
  jsx: "jsx",
  kotlin: "kt",
  markdown: "md",
  mermaid: "mmd",
  php: "php",
  plaintext: "txt",
  powershell: "ps1",
  python: "py",
  ruby: "rb",
  rust: "rs",
  scss: "scss",
  shell: "sh",
  sql: "sql",
  swift: "swift",
  typescript: "ts",
  tsx: "tsx",
  xml: "xml",
  yaml: "yaml",
};

const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export function getCodeBlockFilename(
  title: unknown,
  language: unknown,
): string {
  const normalizedTitle = normalizeCodeBlockTitle(title);
  let filename = (normalizedTitle || "code-block")
    .replace(/[\\/:*?"<>|%]/g, "-")
    .replace(/^\.+/, "")
    .replace(/\.{2,}/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/[. ]+$/, "")
    .trim();

  if (!filename) filename = "code-block";
  if (WINDOWS_RESERVED_NAME.test(filename)) filename = `_${filename}`;

  const extension = getLanguageExtension(language);
  const hasExtension = /(?:^|[^.])\.[a-z0-9][a-z0-9._-]{0,15}$/i.test(filename);
  if (!hasExtension) filename = `${filename}.${extension}`;

  if (filename.length <= 120) return filename;

  const dot = filename.lastIndexOf(".");
  const suffix = dot > 0 ? filename.slice(dot) : "";
  return `${filename.slice(0, Math.max(1, 120 - suffix.length))}${suffix}`;
}

export function downloadCodeBlock(
  source: string,
  title: unknown,
  language: unknown,
): void {
  const blob = new Blob([source], { type: "text/plain;charset=utf-8" });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  try {
    anchor.href = objectUrl;
    anchor.download = getCodeBlockFilename(title, language);
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  }
}

function getLanguageExtension(language: unknown): string {
  if (typeof language !== "string") return "txt";
  const normalized = language.trim().toLowerCase();
  return LANGUAGE_EXTENSIONS[normalized] || "txt";
}
