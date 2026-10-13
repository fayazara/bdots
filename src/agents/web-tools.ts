/**
 * The bot's stateless Browser Run tools: Quick Actions (markdown, extract,
 * links, scrape, screenshot, pdf) and, when an API token is configured,
 * crawl. `browser_execute` (a real, persistent session) lives in
 * `@cloudflare/think/tools/browser`.
 *
 * These replace the stock Quick Action tools from `agents/browser/ai` so that:
 * - long results are saved to a file with an outline, not cut off,
 * - extraction requires a schema (without one it often returns nothing),
 * - text actions try Kitesurf first and fall back to Chromium,
 * - screenshots and PDFs land in the bot's files for the user to see.
 */
import { tool } from "ai"
import type { ToolSet } from "ai"
import { z } from "zod"

/** Page text longer than this is saved to a file instead of returned. */
const MAX_INLINE_CHARS = 20_000
const PREVIEW_CHARS = 4_000
const MAX_OUTLINE = 80
const MAX_INLINE_LINKS = 200
const MAX_TEXT_PER_ELEMENT = 2_000
const SELECTOR_TIMEOUT_MS = 15_000
/** Kitesurf output shorter than this counts as a failed render. */
const MIN_KITESURF_CHARS = 200
/** Element attributes that only add noise for the model. */
const SKIP_ATTRS = new Set(["class", "style"])

export type QuickEngine = "kitesurf" | "chromium"

export interface CrawlInput {
  url: string
  purpose: string
  limit?: number
  depth?: number
  render?: boolean
  includePatterns?: string[]
  excludePatterns?: string[]
}

export interface WebToolsOptions {
  browser: BrowserRun
  /** Engine for the actions Kitesurf supports (markdown, extract). */
  engine: QuickEngine
  /** Write a file under /workspace (path relative to it); returns the full path. */
  save(path: string, content: string | Uint8Array): Promise<string>
  /** Start a crawl job. Absent when crawl is not configured. */
  startCrawl?(input: CrawlInput): Promise<{ jobId: string }>
}

class BrowserRunError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

interface Envelope<T> {
  success: boolean
  result: T
  meta?: BrowserRunResponseMeta
  errors?: { message: string; detail?: string }[]
  rawAiResponse?: string
}

function clip(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
}

/** File-name part for a page: host and path, or "page" for raw HTML. */
function pageSlug(url: string | undefined, name?: string) {
  let base = name || "page"
  if (!name && url) {
    try {
      const u = new URL(url)
      base = `${u.hostname.replace(/^www\./, "")}${u.pathname}`
    } catch {
      // Not a URL: keep "page".
    }
  }
  return (
    base
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "page"
  )
}

async function failure(res: Response) {
  let message = `Browser Run returned HTTP ${res.status}`
  try {
    const body = (await res.json()) as Partial<Envelope<unknown>>
    const first = body.errors?.[0]
    if (first)
      message = [first.message, first.detail].filter(Boolean).join(": ")
    if (body.rawAiResponse) {
      message += ` (the extractor replied: ${clip(body.rawAiResponse, 300)})`
    }
  } catch {
    // Not JSON: keep the status line.
  }
  return new BrowserRunError(message, res.status)
}

async function parse<T>(res: Response): Promise<Envelope<T>> {
  if (!res.ok) throw await failure(res)
  const body = (await res.json()) as Envelope<T>
  if (!body.success) {
    throw new BrowserRunError(
      body.errors?.[0]?.message ?? "Browser Run failed",
      res.status
    )
  }
  return body
}

/**
 * Run with Kitesurf first when allowed, then Chromium if Kitesurf errors or
 * returns something unusable (empty, blocked, half-rendered).
 */
async function withEngine<T>(
  first: QuickEngine,
  run: (engine: QuickEngine) => Promise<T>,
  usable: (value: T) => boolean
): Promise<{ value: T; engine: QuickEngine }> {
  if (first === "kitesurf") {
    try {
      const value = await run("kitesurf")
      if (usable(value)) return { value, engine: "kitesurf" }
      console.warn("Kitesurf result unusable, retrying on Chromium")
    } catch (err) {
      console.warn("Kitesurf failed, retrying on Chromium:", String(err))
    }
  }
  return { value: await run("chromium"), engine: "chromium" }
}

function engineOption(engine: QuickEngine) {
  return engine === "kitesurf" ? { browser: "kitesurf" as const } : {}
}

const pageFields = {
  url: z.string().url().optional().describe("Page to load"),
  html: z
    .string()
    .optional()
    .describe("Raw HTML to render instead of loading a URL"),
  waitForSelector: z
    .string()
    .optional()
    .describe(
      "CSS selector to wait for before reading. Use it when a page builds its content with JavaScript and came back empty or partial."
    ),
  waitForNetwork: z
    .boolean()
    .optional()
    .describe(
      "Wait until the network is quiet before reading. Slower; use it when a page came back half-loaded and you do not know a selector."
    ),
}

interface PageInput {
  url?: string
  html?: string
  waitForSelector?: string
  waitForNetwork?: boolean
}

function page(input: PageInput): BrowserRunCommonOptions {
  const options: BrowserRunBaseOptions = {}
  if (input.waitForSelector) {
    options.waitForSelector = {
      selector: input.waitForSelector,
      timeout: SELECTOR_TIMEOUT_MS,
    }
    // Read what is there if the selector never shows up.
    options.bestAttempt = true
  }
  if (input.waitForNetwork) {
    options.gotoOptions = { waitUntil: "networkidle2", timeout: 45_000 }
  }
  if (input.url) return { ...options, url: input.url }
  if (input.html) return { ...options, html: input.html }
  throw new Error("Provide either `url` or `html`.")
}

function describeMeta(meta: BrowserRunResponseMeta | undefined, url?: string) {
  return {
    ...(meta?.title ? { title: meta.title } : {}),
    ...(meta?.finalUrl || url ? { url: meta?.finalUrl ?? url } : {}),
    ...(meta?.status && meta.status >= 400
      ? {
          status: meta.status,
          warning: `The site answered HTTP ${meta.status}; this may be an error or block page, not the content.`,
        }
      : {}),
  }
}

function usablePage(env: Envelope<string>) {
  return (
    env.result.trim().length >= MIN_KITESURF_CHARS &&
    (env.meta?.status ?? 200) < 400
  )
}

/** Markdown headings with their 1-based line numbers, for `read` offsets. */
function outlineOf(lines: string[]) {
  const outline: string[] = []
  for (let i = 0; i < lines.length && outline.length < MAX_OUTLINE; i++) {
    if (/^#{1,4}\s/.test(lines[i])) {
      outline.push(`${i + 1}: ${clip(lines[i].trim(), 140)}`)
    }
  }
  return outline
}

export function createWebTools(options: WebToolsOptions): ToolSet {
  const { browser, save } = options

  /** Small values go back inline; big ones are saved and previewed. */
  async function bounded(name: string, value: unknown, preview: () => unknown) {
    const json = JSON.stringify(value)
    if (json.length <= MAX_INLINE_CHARS) return { data: value }
    const path = await save(
      `downloads/web/${stamp()}-${name}.json`,
      JSON.stringify(value, null, 2)
    )
    return {
      data: preview(),
      truncated: true,
      savedTo: path,
      note: `The full result (${json.length} characters) is in ${path}. Use read, grep or jq on it instead of fetching again.`,
    }
  }

  const tools: ToolSet = {
    browser_markdown: tool({
      description:
        "Load a web page (or render raw HTML) and return it as Markdown. Best for reading articles, docs and most pages. Long pages are saved to a file: you get the start, an outline with line numbers and the path, so read (with offset) or grep the file instead of fetching again.",
      inputSchema: z.object(pageFields),
      execute: async (input) => {
        const { value, engine } = await withEngine(
          options.engine,
          async (engine) =>
            parse<string>(
              await browser.quickAction("markdown", {
                ...page(input),
                ...engineOption(engine),
              })
            ),
          usablePage
        )
        const markdown = value.result
        const meta = { ...describeMeta(value.meta, input.url), engine }
        if (markdown.length <= MAX_INLINE_CHARS) return { ...meta, markdown }
        const path = await save(
          `downloads/web/${stamp()}-${pageSlug(input.url)}.md`,
          markdown
        )
        const lines = markdown.split("\n")
        return {
          ...meta,
          savedTo: path,
          chars: markdown.length,
          lines: lines.length,
          outline: outlineOf(lines),
          preview: markdown.slice(0, PREVIEW_CHARS),
          note: `The page is long, so the full Markdown is in ${path}. The outline numbers are line numbers: use read with offset, or grep, to get the part you need. Do not fetch the page again.`,
        }
      },
    }),

    browser_extract: tool({
      description:
        "Pull structured data out of a page with AI. `schema` is required; say exactly what to extract in `prompt`. For lists with a regular layout (rankings, search results, listings, tables), browser_scrape with CSS selectors is faster and more reliable.",
      inputSchema: z.object({
        ...pageFields,
        prompt: z
          .string()
          .describe(
            "What to extract and where it is on the page, e.g. 'the top 10 repositories in the main list, with stars today'"
          ),
        schema: z
          .record(z.string(), z.unknown(), {
            error: "Schema must be a JSON Schema object",
          })
          .describe(
            'JSON Schema of the result, e.g. {"type":"object","properties":{"items":{"type":"array","items":{"type":"object","properties":{"name":{"type":"string"}}}}}}'
          ),
      }),
      execute: async (input) => {
        // Browser Run's default extractor. `custom_ai` is not used: with it,
        // Workers AI models either reject the schema or come back as a raw
        // chat completion instead of the parsed object.
        try {
          const { value, engine } = await withEngine(
            options.engine,
            async (engine) =>
              parse<Record<string, unknown>>(
                await browser.quickAction("json", {
                  ...page(input),
                  ...engineOption(engine),
                  prompt: input.prompt,
                  response_format: {
                    type: "json_schema",
                    json_schema: input.schema,
                  },
                })
              ),
            (env) =>
              env.result !== null &&
              typeof env.result === "object" &&
              Object.keys(env.result).length > 0
          )
          return {
            ...describeMeta(value.meta, input.url),
            engine,
            ...(await bounded(pageSlug(input.url), value.result, () =>
              clip(JSON.stringify(value.result), PREVIEW_CHARS)
            )),
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          throw new Error(
            `${message}. If the page has a regular layout, use browser_scrape with CSS selectors; otherwise read it with browser_markdown.`
          )
        }
      },
    }),

    browser_links: tool({
      description:
        "List the links on a page (including ones not visible), to find pages to follow.",
      inputSchema: z.object({
        ...pageFields,
        visibleOnly: z.boolean().optional(),
        sameSiteOnly: z
          .boolean()
          .optional()
          .describe("Leave out links to other domains"),
      }),
      execute: async (input) => {
        const value = await parse<string[]>(
          await browser.quickAction("links", {
            ...page(input),
            ...(input.visibleOnly ? { visibleLinksOnly: true } : {}),
            ...(input.sameSiteOnly ? { excludeExternalLinks: true } : {}),
          })
        )
        const links = [...new Set(value.result)]
        const meta = describeMeta(value.meta, input.url)
        if (links.length <= MAX_INLINE_LINKS) return { ...meta, links }
        const path = await save(
          `downloads/web/${stamp()}-${pageSlug(input.url)}-links.txt`,
          `${links.join("\n")}\n`
        )
        return {
          ...meta,
          total: links.length,
          links: links.slice(0, MAX_INLINE_LINKS),
          savedTo: path,
          note: `Showing ${MAX_INLINE_LINKS} of ${links.length}. All of them are in ${path}, one per line: grep it.`,
        }
      },
    }),

    browser_scrape: tool({
      description:
        "Get specific elements from a page by CSS selector: each match's text and attributes (href, src, title…). The most reliable way to read lists, rankings, tables and search results. Use one selector per field you need, e.g. ['article h2 a', 'article .stars'].",
      inputSchema: z.object({
        ...pageFields,
        selectors: z.array(z.string()).min(1).max(10),
        includeHtml: z
          .boolean()
          .optional()
          .describe(
            "Also return each element's outer HTML. Large; rarely needed."
          ),
      }),
      execute: async (input) => {
        const value = await parse<BrowserRunScrapeSuccessResponse["result"]>(
          await browser.quickAction("scrape", {
            ...page(input),
            elements: input.selectors.map((selector) => ({ selector })),
          })
        )
        const results = value.result.map((group) => ({
          selector: group.selector,
          count: group.results.length,
          items: group.results.map((el) => {
            const attrs = Object.fromEntries(
              el.attributes
                .filter((a) => !SKIP_ATTRS.has(a.name))
                .map((a) => [a.name, clip(a.value, 300)])
            )
            return {
              text: clip(
                el.text.replace(/\s+/g, " ").trim(),
                MAX_TEXT_PER_ELEMENT
              ),
              ...(Object.keys(attrs).length ? { attrs } : {}),
              ...(input.includeHtml ? { html: el.html } : {}),
            }
          }),
        }))
        return {
          ...describeMeta(value.meta, input.url),
          ...(await bounded(pageSlug(input.url), results, () => {
            const per = Math.max(5, Math.floor(60 / results.length))
            return results.map((r) => ({
              ...r,
              items: r.items.slice(0, per).map((item) => ({
                ...item,
                html: undefined,
              })),
            }))
          })),
        }
      },
    }),

    browser_screenshot: tool({
      description:
        "Take a screenshot of a page (or of one element) and save it as an image in your files. The user sees it in the chat. Use it when they ask to see a page, or to keep a visual record.",
      inputSchema: z.object({
        ...pageFields,
        selector: z
          .string()
          .optional()
          .describe("Only capture the element matching this CSS selector"),
        fullPage: z
          .boolean()
          .optional()
          .describe(
            "Capture the whole scrolling page, not just the first screen"
          ),
        width: z.number().int().min(320).max(2560).optional(),
        height: z.number().int().min(240).max(2560).optional(),
        name: z
          .string()
          .optional()
          .describe("File name without extension, e.g. 'pricing-page'"),
      }),
      execute: async (input) => {
        // Chromium: a screenshot is for people, so it should look right.
        const res = await browser.quickAction("screenshot", {
          ...page(input),
          ...(input.selector ? { selector: input.selector } : {}),
          viewport: {
            width: input.width ?? 1280,
            height: input.height ?? 800,
          },
          screenshotOptions: {
            type: "jpeg",
            quality: 80,
            fullPage: input.fullPage ?? false,
          },
        })
        if (!res.ok) throw await failure(res)
        const bytes = new Uint8Array(await res.arrayBuffer())
        const path = await save(
          `artifacts/screenshots/${stamp()}-${pageSlug(input.url, input.name)}.jpg`,
          bytes
        )
        return {
          saved: path,
          mediaType: "image/jpeg",
          bytes: bytes.byteLength,
          note: "The user can see this screenshot in the chat. You cannot see the image yourself: read the page with browser_markdown if you need its content.",
        }
      },
    }),

    browser_pdf: tool({
      description:
        "Save a page as a PDF in your files. Pass `html` to turn your own HTML into a PDF (a report, an invoice, a summary). The user can open it from the chat.",
      inputSchema: z.object({
        ...pageFields,
        format: z.enum(["a4", "letter", "legal", "a3"]).optional(),
        landscape: z.boolean().optional(),
        name: z
          .string()
          .optional()
          .describe("File name without extension, e.g. 'weekly-report'"),
      }),
      execute: async (input) => {
        const res = await browser.quickAction("pdf", {
          ...page(input),
          pdfOptions: {
            format: input.format ?? "a4",
            landscape: input.landscape ?? false,
            printBackground: true,
          },
        })
        if (!res.ok) throw await failure(res)
        const bytes = new Uint8Array(await res.arrayBuffer())
        const path = await save(
          `artifacts/pdfs/${stamp()}-${pageSlug(input.url, input.name)}.pdf`,
          bytes
        )
        return {
          saved: path,
          mediaType: "application/pdf",
          bytes: bytes.byteLength,
        }
      },
    }),
  }

  const startCrawl = options.startCrawl
  if (startCrawl) {
    tools.browser_crawl = tool({
      description:
        "Crawl many pages of one site (follows links and sitemaps) and save each page as Markdown in your files. It runs in the background: you get a message when it finishes, with where the pages are. Use it for 'read this whole docs site' or 'check every page under /blog', not for one page.",
      inputSchema: z.object({
        url: z.string().url().describe("Where to start"),
        purpose: z
          .string()
          .describe(
            "What the crawl is for and what to do with it, so you know when it finishes, e.g. 'list every pricing change in the docs'"
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe("Most pages to crawl. Default 25"),
        depth: z.number().int().min(1).max(10).optional(),
        includePatterns: z
          .array(z.string())
          .optional()
          .describe(
            "Only URLs matching these wildcards, e.g. 'https://example.com/docs/**'"
          ),
        excludePatterns: z.array(z.string()).optional(),
        render: z
          .boolean()
          .optional()
          .describe(
            "Run JavaScript on each page. Off by default (faster and cheaper); turn it on for sites that build their content in the browser."
          ),
      }),
      execute: async (input) => {
        const { jobId } = await startCrawl(input)
        return {
          started: jobId,
          note: "The crawl runs in the background. You will get a message when it finishes, with the pages saved as files. Do not wait for it, poll it or start it again.",
        }
      },
    })
  }

  return tools
}
