import { useEffect, useState } from "react"
import { Link, useHydrated, useNavigate } from "@tanstack/react-router"
import { Badge } from "@cloudflare/kumo/components/badge"
import { Button } from "@cloudflare/kumo/components/button"
import { ClipboardText } from "@cloudflare/kumo/components/clipboard-text"
import { Dialog } from "@cloudflare/kumo/components/dialog"
import { Input, InputArea } from "@cloudflare/kumo/components/input"
import { Loader } from "@cloudflare/kumo/components/loader"
import { Select } from "@cloudflare/kumo/components/select"
import { Switch } from "@cloudflare/kumo/components/switch"
import {
  ArrowsClockwiseIcon,
  BookOpenTextIcon,
  ClockIcon,
  EyeIcon,
  TrashIcon,
  XIcon,
} from "@/components/icons"
import { useBot } from "@/lib/bot-context"
import { connectionStatus } from "@/lib/connection-status"
import { useHub } from "@/lib/hub-context"
import { ACTION_CLASSES, CHECK_IN_HOURS, DEFAULT_PROACTIVE } from "@/lib/types"
import type {
  ActionClass,
  BotInbound,
  OpenItem,
  ProactiveSettings,
  RulePolicy,
} from "@/lib/types"

const CHECK_IN_LABELS = Object.fromEntries(
  CHECK_IN_HOURS.map((h) => [
    String(h),
    h === 1 ? "Every hour" : h === 24 ? "Once a day" : `Every ${h} hours`,
  ])
)

const MAX_PER_DAY_LABELS: Record<string, string> = {
  "2": "2 a day",
  "4": "4 a day",
  "6": "6 a day",
  "10": "10 a day",
  "20": "20 a day",
}

function formatAgo(at: number) {
  const minutes = Math.round((Date.now() - at) / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return new Date(at).toLocaleDateString([], { day: "numeric", month: "short" })
}

const POLICY_LABELS: Record<RulePolicy, string> = {
  allow: "Allow",
  ask: "Ask first",
  block: "Block",
}

function Section({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-3 border-b border-kumo-line p-4 last:border-b-0">
      <div>
        <h2 className="text-sm font-semibold text-kumo-default">{title}</h2>
        {hint ? (
          <p className="mt-0.5 text-sm text-kumo-subtle">{hint}</p>
        ) : null}
      </div>
      {children}
    </section>
  )
}

function Identity() {
  const { state, agent } = useBot()
  const [name, setName] = useState(state.name)
  const [role, setRole] = useState(state.role)
  const [saving, setSaving] = useState(false)

  // The bot can rename itself while this panel is open.
  useEffect(() => setName(state.name), [state.name])
  useEffect(() => setRole(state.role), [state.role])

  const dirty = name.trim() !== state.name || role.trim() !== state.role

  async function save() {
    if (!agent) return
    setSaving(true)
    try {
      await agent.stub.updateSettings({ name, role })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Section title="Identity">
      <Input
        label="Name"
        value={name}
        maxLength={40}
        onChange={(e) => setName(e.target.value)}
      />
      <InputArea
        label="Job"
        description="What this bot is for. It sees this on every turn."
        placeholder="Overnight pipeline generation and outbound. Draft in my voice, never send without asking."
        value={role}
        autoResize
        minRows={3}
        maxRows={10}
        onValueChange={setRole}
      />
      <Button
        variant="primary"
        className="btn-ink"
        disabled={!dirty || !agent || !name.trim()}
        loading={saving}
        onClick={() => void save()}
      >
        Save
      </Button>
    </Section>
  )
}

function Rules() {
  const { state, agent } = useBot()
  return (
    <Section
      title="Rules"
      hint="What this bot may do. “Ask first” pauses the work and shows an approval card. In background work nobody can approve, so those actions are skipped and reported instead; read-only app tools still run."
    >
      <ul className="space-y-3">
        {ACTION_CLASSES.map((cls) => (
          <li key={cls.id} className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm text-kumo-default">{cls.label}</p>
              <p className="text-xs text-kumo-subtle">{cls.hint}</p>
            </div>
            <Select
              aria-label={`${cls.label} rule`}
              size="sm"
              className="w-32 shrink-0"
              disabled={!agent}
              value={state.rules[cls.id]}
              items={POLICY_LABELS}
              onValueChange={(value) => {
                if (!value) return
                const rules = { [cls.id]: value } as Partial<
                  Record<ActionClass, RulePolicy>
                >
                void agent?.stub.updateSettings({ rules })
              }}
            />
          </li>
        ))}
      </ul>
    </Section>
  )
}

function Toolkit() {
  const hub = useHub()
  return (
    <Section
      title="Connected apps"
      hint="Every bot can use all of your connections. Bots reach apps through their APIs first and only open a browser when there is no API."
    >
      {hub.state.connections.length === 0 ? (
        <p className="text-sm text-kumo-subtle">
          No connections yet.{" "}
          <Link to="/connections" className="text-kumo-link underline">
            Add one
          </Link>
        </p>
      ) : (
        <ul className="space-y-2">
          {hub.state.connections.map((connection) => (
            <li
              key={connection.id}
              className="flex items-center justify-between gap-3"
            >
              <span className="truncate text-sm text-kumo-default">
                {connection.name}
              </span>
              <span
                className={`shrink-0 text-xs ${
                  connection.status === "ready"
                    ? "text-kumo-subtle"
                    : "text-kumo-warning"
                }`}
              >
                {connectionStatus(connection)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Link to="/connections" className="text-sm text-kumo-link underline">
        Manage connections
      </Link>
    </Section>
  )
}

function Routines() {
  const { state, agent } = useBot()
  return (
    <Section
      title="Routines"
      hint="Work this bot does on a schedule. Ask it in chat to set one up, like “every weekday at 8am, tell me what needs my attention.”"
    >
      {state.routines.length === 0 ? (
        <p className="text-sm text-kumo-subtle">No routines yet.</p>
      ) : (
        <ul className="space-y-2">
          {state.routines.map((routine) => (
            <li
              key={routine.id}
              className="flex items-start gap-3 rounded-xl bg-(--fill-hover) p-3"
            >
              <ClockIcon
                size={16}
                className="mt-0.5 shrink-0 text-kumo-subtle"
              />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-medium text-kumo-default">
                  <span className="truncate">{routine.name}</span>
                  <Badge variant="neutral">
                    {routine.kind === "cron"
                      ? routine.when
                      : new Date(routine.when).toLocaleString()}
                  </Badge>
                </p>
                <p className="mt-1 line-clamp-2 text-xs text-kumo-subtle">
                  {routine.prompt}
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                shape="square"
                icon={<TrashIcon />}
                aria-label={`Delete routine ${routine.name}`}
                disabled={!agent}
                onClick={() => void agent?.stub.deleteRoutine(routine.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

function OnItsOwn() {
  const { state, agent } = useBot()
  const hydrated = useHydrated()
  const p: ProactiveSettings = state.proactive ?? DEFAULT_PROACTIVE
  const [checking, setChecking] = useState(false)
  const update = (patch: Partial<ProactiveSettings>) =>
    void agent?.stub.updateProactive(patch)

  async function checkNow() {
    if (!agent) return
    setChecking(true)
    try {
      await agent.stub.checkInNow()
    } finally {
      setChecking(false)
    }
  }

  return (
    <Section
      title="On its own"
      hint="Between conversations this bot checks your apps and its open items with read-only tools, and messages you only when something needs you."
    >
      <Switch
        label="Check in regularly"
        checked={p.enabled}
        disabled={!agent}
        onCheckedChange={(enabled) => update({ enabled })}
      />
      <div className="grid grid-cols-2 gap-3">
        <Select
          label="How often"
          size="sm"
          disabled={!agent || !p.enabled}
          value={String(p.everyHours)}
          items={CHECK_IN_LABELS}
          onValueChange={(value) =>
            value && update({ everyHours: Number(value) })
          }
        />
        <Select
          label="At most"
          size="sm"
          disabled={!agent}
          value={String(p.maxPerDay)}
          items={
            MAX_PER_DAY_LABELS[String(p.maxPerDay)]
              ? MAX_PER_DAY_LABELS
              : { ...MAX_PER_DAY_LABELS, [p.maxPerDay]: `${p.maxPerDay} a day` }
          }
          onValueChange={(value) =>
            value && update({ maxPerDay: Number(value) })
          }
        />
        <Input
          label="Quiet from"
          type="time"
          size="sm"
          disabled={!agent}
          value={p.quietStart}
          onChange={(e) =>
            e.target.value && update({ quietStart: e.target.value })
          }
        />
        <Input
          label="Until"
          type="time"
          size="sm"
          disabled={!agent}
          value={p.quietEnd}
          onChange={(e) =>
            e.target.value && update({ quietEnd: e.target.value })
          }
        />
      </div>
      <p className="text-xs text-kumo-subtle">
        No check-ins or notifications during quiet hours ({p.timezone}). Emails
        and webhooks still get handled.
      </p>
      <Switch
        label="Use any app tool in the background"
        labelTooltip="Background work normally only runs app tools known to be read-only. Tools like Executor's code runner can't be checked, so they need your approval, which nobody can give in the background. Turn this on to let them run unattended. The bot is still told to stay read-only."
        checked={p.appsInBackground === true}
        disabled={!agent}
        onCheckedChange={(appsInBackground) => update({ appsInBackground })}
      />
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-kumo-subtle">
          {hydrated && state.lastCheckIn
            ? `Last worked on its own ${formatAgo(state.lastCheckIn)}`
            : "Hasn't worked on its own yet"}
        </span>
        <Button
          size="sm"
          icon={<ArrowsClockwiseIcon />}
          loading={checking}
          disabled={!agent || state.status !== "idle"}
          onClick={() => void checkNow()}
        >
          Check in now
        </Button>
      </div>
    </Section>
  )
}

function OpenItems() {
  const { state, agent } = useBot()
  const [items, setItems] = useState<OpenItem[] | null>(null)

  // Items change during turns; re-read whenever the bot goes back to idle.
  useEffect(() => {
    if (!agent || state.status !== "idle") return
    let cancelled = false
    void agent.stub.listOpenItems().then((rows) => {
      if (!cancelled) setItems(rows)
    })
    return () => {
      cancelled = true
    }
  }, [agent, state.status])

  const open = items?.filter((i) => i.status === "open") ?? []
  const resolved = items?.filter((i) => i.status === "resolved") ?? []

  async function dismiss(id: string) {
    if (!agent) return
    await agent.stub.dismissOpenItem(id)
    setItems(await agent.stub.listOpenItems())
  }

  return (
    <Section
      title="Keeping an eye on"
      hint="Things this bot is waiting on or following up. It looks at these on every check-in."
    >
      {items === null ? (
        <Loader size="sm" />
      ) : open.length === 0 ? (
        <p className="text-sm text-kumo-subtle">Nothing open.</p>
      ) : (
        <ul className="space-y-2">
          {open.map((item) => (
            <li
              key={item.id}
              className="flex items-start gap-3 rounded-xl bg-(--fill-hover) p-3"
            >
              <EyeIcon size={16} className="mt-0.5 shrink-0 text-kumo-subtle" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-kumo-default">
                  {item.sourceUrl ? (
                    <a
                      href={item.sourceUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="underline"
                    >
                      {item.title}
                    </a>
                  ) : (
                    item.title
                  )}
                </p>
                {item.note ? (
                  <p className="mt-1 line-clamp-3 text-xs text-kumo-subtle">
                    {item.note}
                  </p>
                ) : null}
              </div>
              <Button
                size="sm"
                variant="ghost"
                shape="square"
                icon={<XIcon />}
                aria-label={`Stop tracking ${item.title}`}
                onClick={() => void dismiss(item.id)}
              />
            </li>
          ))}
        </ul>
      )}
      {resolved.length > 0 ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-kumo-subtle">
            {resolved.length} closed recently
          </summary>
          <ul className="mt-2 space-y-1.5">
            {resolved.map((item) => (
              <li key={item.id} className="text-xs text-kumo-subtle">
                <span className="text-kumo-default">{item.title}</span>
                {item.note ? ` · ${item.note}` : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Section>
  )
}

function Skills() {
  const { state, agent } = useBot()
  const skills = state.skills ?? []
  return (
    <Section
      title="Skills"
      hint="Workflows this bot learned by watching you. Choose “Teach a task” from the + menu in the composer to show it a new one."
    >
      {skills.length === 0 ? (
        <p className="text-sm text-kumo-subtle">No skills yet.</p>
      ) : (
        <ul className="space-y-2">
          {skills.map((skill) => (
            <li
              key={skill.slug}
              className="flex items-start gap-3 rounded-xl bg-(--fill-hover) p-3"
            >
              <BookOpenTextIcon
                size={16}
                className="mt-0.5 shrink-0 text-kumo-subtle"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-kumo-default">
                  {skill.name}
                </p>
                <p className="mt-1 line-clamp-2 text-xs text-kumo-subtle">
                  {skill.description}
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                shape="square"
                icon={<TrashIcon />}
                aria-label={`Delete skill ${skill.name}`}
                disabled={!agent}
                onClick={() => void agent?.stub.deleteSkill(skill.slug)}
              />
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

function Reach() {
  const { agent } = useBot()
  const [inbound, setInbound] = useState<BotInbound | null>(null)
  const [rotating, setRotating] = useState(false)

  useEffect(() => {
    if (!agent) return
    let cancelled = false
    void agent.stub.getInbound().then((value) => {
      if (!cancelled) setInbound(value)
    })
    return () => {
      cancelled = true
    }
  }, [agent])

  async function rotate() {
    if (!agent) return
    setRotating(true)
    try {
      setInbound(await agent.stub.rotateWebhookToken())
    } finally {
      setRotating(false)
    }
  }

  const webhookUrl =
    inbound && typeof window !== "undefined"
      ? `${window.location.origin}${inbound.webhookUrl}`
      : null

  return (
    <Section
      title="Reach this bot"
      hint="Events wake the bot right away instead of waiting for the next check-in. It works on them in the background and only messages you if they matter."
    >
      {inbound === null ? (
        <Loader size="sm" />
      ) : (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <p className="text-sm text-kumo-default">Email</p>
            {inbound.email ? (
              <>
                <ClipboardText text={inbound.email} />
                <p className="text-xs text-kumo-subtle">
                  Forward mail here or point notification emails at it.
                </p>
              </>
            ) : (
              <p className="text-xs text-kumo-subtle">
                Not set up. Set <code>EMAIL_DOMAIN</code> in
                cloudflare.config.ts and route that domain's mail to this Worker
                with Email Routing.
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <p className="text-sm text-kumo-default">Webhook</p>
            {webhookUrl ? <ClipboardText text={webhookUrl} /> : null}
            <p className="text-xs text-kumo-subtle">
              POST any JSON or text. Add <code>?source=github</code> to name the
              sender. Treat the URL like a password.
            </p>
            <Button
              size="sm"
              variant="secondary"
              loading={rotating}
              onClick={() => void rotate()}
            >
              New URL
            </Button>
          </div>
        </div>
      )}
    </Section>
  )
}

function Memory() {
  const { agent } = useBot()
  const [saved, setSaved] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!agent) return
    let cancelled = false
    void agent.stub.getMemory().then((content) => {
      if (cancelled) return
      setSaved(content)
      setDraft(content)
    })
    return () => {
      cancelled = true
    }
  }, [agent])

  async function save() {
    if (!agent) return
    setSaving(true)
    try {
      await agent.stub.setMemory(draft)
      setSaved(draft)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Section
      title="Memory"
      hint="What this bot has learned about you and how you want things done. It updates this itself; you can correct it."
    >
      {saved === null ? (
        <Loader size="sm" />
      ) : (
        <>
          <InputArea
            aria-label="Memory"
            placeholder="Nothing remembered yet."
            value={draft}
            autoResize
            minRows={4}
            maxRows={16}
            onValueChange={setDraft}
          />
          <Button
            disabled={draft === saved}
            loading={saving}
            onClick={() => void save()}
          >
            Save memory
          </Button>
        </>
      )}
    </Section>
  )
}

function DangerZone() {
  const { botId, state } = useBot()
  const hub = useHub()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function remove() {
    setDeleting(true)
    try {
      await hub.deleteBot(botId)
      await navigate({ to: "/" })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Section title="Delete bot">
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger
          render={(props) => (
            <Button
              {...props}
              variant="secondary-destructive"
              disabled={!hub.live}
            >
              Delete {state.name}
            </Button>
          )}
        />
        <Dialog size="sm" className="space-y-4 p-6">
          <Dialog.Title className="text-lg font-semibold">
            Delete {state.name}?
          </Dialog.Title>
          <Dialog.Description className="text-sm text-kumo-subtle">
            Its chat history, memory, routines and every file on its computer
            are deleted. This can't be undone.
          </Dialog.Description>
          <div className="flex justify-end gap-2">
            <Dialog.Close
              render={(props) => (
                <Button {...props} variant="secondary">
                  Cancel
                </Button>
              )}
            />
            <Button
              variant="destructive"
              loading={deleting}
              onClick={() => void remove()}
            >
              Delete
            </Button>
          </div>
        </Dialog>
      </Dialog.Root>
    </Section>
  )
}

export function SettingsPanel() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <Identity />
      <OnItsOwn />
      <OpenItems />
      <Rules />
      <Toolkit />
      <Routines />
      <Skills />
      <Reach />
      <Memory />
      <DangerZone />
    </div>
  )
}
