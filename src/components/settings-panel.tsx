import { useEffect, useState } from "react"
import { Link, useHydrated, useNavigate } from "@tanstack/react-router"
import { Button } from "@cloudflare/kumo/components/button"
import { Dialog } from "@cloudflare/kumo/components/dialog"
import { Loader } from "@cloudflare/kumo/components/loader"
import { Select } from "@cloudflare/kumo/components/select"
import { Switch } from "@cloudflare/kumo/components/switch"
import { CopyButton } from "@/components/copy-button"
import {
  EmptyRow,
  FIELD,
  Group,
  PILL_INPUT,
  Row,
  RowAction,
  SaveBar,
} from "@/components/group"
import {
  ArrowsClockwiseIcon,
  BookOpenTextIcon,
  CaretRightIcon,
  ClockIcon,
  EnvelopeSimpleIcon,
  EyeIcon,
  PlugsConnectedIcon,
  TrashIcon,
  WebhooksLogoIcon,
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
    <div className="space-y-2">
      <Group
        title="Identity"
        hint="The job is what this bot is for. It sees it on every turn."
      >
        <Row label="Name">
          <input
            value={name}
            maxLength={40}
            aria-label="Name"
            onChange={(e) => setName(e.target.value)}
            className={`${FIELD} h-8 max-w-[60%] text-right`}
          />
        </Row>
        <li className="border-t border-kumo-line px-4 py-3">
          <label className="block text-sm text-kumo-default" htmlFor="bot-job">
            Job
          </label>
          <textarea
            id="bot-job"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="Overnight pipeline generation and outbound. Draft in my voice, never send without asking."
            className={`${FIELD} mt-1.5 field-sizing-content min-h-16 resize-none leading-6 text-pretty`}
          />
        </li>
      </Group>
      <SaveBar
        dirty={dirty}
        saving={saving}
        disabled={!agent || !name.trim()}
        onSave={() => void save()}
        onReset={() => {
          setName(state.name)
          setRole(state.role)
        }}
      />
    </div>
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
    <Group
      title="On its own"
      hint={`Between chats it checks your apps and open items with read-only tools and only messages you when something needs you. Quiet hours follow ${p.timezone}; emails and webhooks still get handled.`}
    >
      <Row label="Check in regularly">
        <Switch
          aria-label="Check in regularly"
          checked={p.enabled}
          disabled={!agent}
          onCheckedChange={(enabled) => update({ enabled })}
        />
      </Row>
      <Row label="How often">
        <Select
          aria-label="How often"
          size="sm"
          className="w-36 shrink-0"
          disabled={!agent || !p.enabled}
          value={String(p.everyHours)}
          items={CHECK_IN_LABELS}
          onValueChange={(value) =>
            value && update({ everyHours: Number(value) })
          }
        />
      </Row>
      <Row label="Messages at most">
        <Select
          aria-label="Messages at most"
          size="sm"
          className="w-36 shrink-0"
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
      </Row>
      <Row label="Quiet hours">
        <span className="flex shrink-0 items-center gap-1.5 text-sm text-kumo-subtle">
          <input
            type="time"
            aria-label="Quiet from"
            disabled={!agent}
            value={p.quietStart}
            onChange={(e) =>
              e.target.value && update({ quietStart: e.target.value })
            }
            className={PILL_INPUT}
          />
          to
          <input
            type="time"
            aria-label="Quiet until"
            disabled={!agent}
            value={p.quietEnd}
            onChange={(e) =>
              e.target.value && update({ quietEnd: e.target.value })
            }
            className={PILL_INPUT}
          />
        </span>
      </Row>
      <Row
        label="Use any app tool in the background"
        detail="Lets tools that can't be checked as read-only, like Executor's code runner, run unattended. The bot is still told to stay read-only."
      >
        <Switch
          aria-label="Use any app tool in the background"
          checked={p.appsInBackground === true}
          disabled={!agent}
          onCheckedChange={(appsInBackground) => update({ appsInBackground })}
        />
      </Row>
      <Row
        label="Last check-in"
        detail={
          hydrated && state.lastCheckIn
            ? formatAgo(state.lastCheckIn)
            : "Not yet"
        }
      >
        <Button
          size="sm"
          variant="secondary"
          className="rounded-full"
          icon={<ArrowsClockwiseIcon />}
          loading={checking}
          disabled={!agent || state.status !== "idle"}
          onClick={() => void checkNow()}
        >
          Check in now
        </Button>
      </Row>
    </Group>
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
    <Group
      title="Keeping an eye on"
      hint={
        resolved.length > 0 ? (
          <details>
            <summary className="cursor-pointer">
              Things it's waiting on or following up, checked on every
              check-in. {resolved.length} closed recently.
            </summary>
            <ul className="mt-2 space-y-1">
              {resolved.map((item) => (
                <li key={item.id}>
                  <span className="text-kumo-default">{item.title}</span>
                  {item.note ? ` · ${item.note}` : null}
                </li>
              ))}
            </ul>
          </details>
        ) : (
          "Things it's waiting on or following up, checked on every check-in."
        )
      }
    >
      {items === null ? (
        <EmptyRow>
          <Loader size="sm" />
        </EmptyRow>
      ) : open.length === 0 ? (
        <EmptyRow>Nothing open</EmptyRow>
      ) : (
        open.map((item) => (
          <Row
            key={item.id}
            icon={<EyeIcon size={14} />}
            label={
              item.sourceUrl ? (
                <a
                  href={item.sourceUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="hover:underline"
                >
                  {item.title}
                </a>
              ) : (
                item.title
              )
            }
            detail={item.note ? <span className="line-clamp-2">{item.note}</span> : undefined}
          >
            <RowAction
              label={`Stop tracking ${item.title}`}
              onClick={() => void dismiss(item.id)}
            >
              <XIcon size={16} />
            </RowAction>
          </Row>
        ))
      )}
    </Group>
  )
}

function Rules() {
  const { state, agent } = useBot()
  return (
    <Group
      title="Rules"
      hint="“Ask first” pauses the work and shows an approval card. In background work nobody can approve, so those actions are skipped and reported instead."
    >
      {ACTION_CLASSES.map((cls) => (
        <Row key={cls.id} label={cls.label} detail={cls.hint}>
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
        </Row>
      ))}
    </Group>
  )
}

function Toolkit() {
  const hub = useHub()
  return (
    <Group
      title="Connected apps"
      hint="Every bot can use all of your connections, through their APIs first and a browser only when there is no API."
    >
      {hub.state.connections.map((connection) => (
        <Row
          key={connection.id}
          icon={<PlugsConnectedIcon size={14} />}
          label={connection.name}
        >
          <span
            className={`shrink-0 pr-1 text-xs ${
              connection.status === "ready"
                ? "text-kumo-subtle"
                : "text-kumo-warning"
            }`}
          >
            {connectionStatus(connection)}
          </span>
        </Row>
      ))}
      <li className="border-t border-kumo-line first:border-t-0">
        <Link
          to="/connections"
          className="flex min-h-14 items-center justify-between gap-4 py-3 pr-5 pl-4 text-sm text-kumo-default outline-none hover:bg-(--fill-hover) focus-visible:bg-(--fill-hover)"
        >
          {hub.state.connections.length === 0
            ? "Connect an app"
            : "Manage connections"}
          <CaretRightIcon size={14} className="text-kumo-subtle" />
        </Link>
      </li>
    </Group>
  )
}

function Routines() {
  const { state, agent } = useBot()
  return (
    <Group
      title="Routines"
      hint="Work it does on a schedule. Ask in chat to set one up, like “every weekday at 8am, tell me what needs my attention.”"
    >
      {state.routines.length === 0 ? (
        <EmptyRow>No routines yet</EmptyRow>
      ) : (
        state.routines.map((routine) => (
          <Row
            key={routine.id}
            icon={<ClockIcon size={14} />}
            label={routine.name}
            detail={
              <span className="line-clamp-2">
                <span className="tabular-nums">
                  {routine.kind === "cron"
                    ? routine.when
                    : new Date(routine.when).toLocaleString()}
                </span>
                {" · "}
                {routine.prompt}
              </span>
            }
          >
            <RowAction
              label={`Delete routine ${routine.name}`}
              disabled={!agent}
              danger
              onClick={() => void agent?.stub.deleteRoutine(routine.id)}
            >
              <TrashIcon size={16} />
            </RowAction>
          </Row>
        ))
      )}
    </Group>
  )
}

function Skills() {
  const { state, agent } = useBot()
  const skills = state.skills ?? []
  return (
    <Group
      title="Skills"
      hint="Workflows it learned by watching you. Pick “Teach a task” from the composer's + menu to show it a new one."
    >
      {skills.length === 0 ? (
        <EmptyRow>No skills yet</EmptyRow>
      ) : (
        skills.map((skill) => (
          <Row
            key={skill.slug}
            icon={<BookOpenTextIcon size={14} />}
            label={skill.name}
            detail={<span className="line-clamp-2">{skill.description}</span>}
          >
            <RowAction
              label={`Delete skill ${skill.name}`}
              disabled={!agent}
              danger
              onClick={() => void agent?.stub.deleteSkill(skill.slug)}
            >
              <TrashIcon size={16} />
            </RowAction>
          </Row>
        ))
      )}
    </Group>
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
    <Group
      title="Reach this bot"
      hint="Events wake the bot right away. It works on them in the background and only messages you if they matter. Treat the webhook URL like a password."
    >
      {inbound === null ? (
        <EmptyRow>
          <Loader size="sm" />
        </EmptyRow>
      ) : (
        <>
          <Row
            icon={<EnvelopeSimpleIcon size={14} />}
            label="Email"
            detail={
              inbound.email ? (
                <span className="block truncate">{inbound.email}</span>
              ) : (
                <>
                  Set <code>EMAIL_DOMAIN</code> and route that domain's mail to
                  this Worker.
                </>
              )
            }
          >
            {inbound.email ? (
              <CopyButton text={inbound.email} label="Copy email address" />
            ) : null}
          </Row>
          <Row
            icon={<WebhooksLogoIcon size={14} />}
            label="Webhook"
            detail={
              <>
                POST JSON or text. Add <code>?source=github</code> to name the
                sender.
              </>
            }
          >
            <RowAction
              label="Make a new URL"
              disabled={rotating}
              onClick={() => void rotate()}
            >
              {rotating ? (
                <Loader size="sm" />
              ) : (
                <ArrowsClockwiseIcon size={16} />
              )}
            </RowAction>
            {webhookUrl ? (
              <CopyButton text={webhookUrl} label="Copy webhook URL" />
            ) : null}
          </Row>
        </>
      )}
    </Group>
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
    <div className="space-y-2">
      <Group
        title="Memory"
        hint="What it has learned about you and how you like things done. It keeps this up to date itself; you can correct it."
      >
        {saved === null ? (
          <EmptyRow>
            <Loader size="sm" />
          </EmptyRow>
        ) : (
          <li className="px-4 py-3">
            <textarea
              aria-label="Memory"
              placeholder="Nothing remembered yet."
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className={`${FIELD} field-sizing-content max-h-96 min-h-24 resize-none leading-6`}
            />
          </li>
        )}
      </Group>
      <SaveBar
        dirty={saved !== null && draft !== saved}
        saving={saving}
        onSave={() => void save()}
        onReset={() => saved !== null && setDraft(saved)}
      />
    </div>
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
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        render={(props) => (
          <button
            {...props}
            type="button"
            disabled={!hub.live}
            className="pressable flex h-8 items-center gap-1.5 rounded-full px-3 text-sm text-kumo-subtle outline-none hover:bg-(--fill-hover) hover:text-kumo-danger focus-visible:ring-2 focus-visible:ring-kumo-focus disabled:opacity-50"
          >
            <TrashIcon size={16} />
            Delete {state.name}
          </button>
        )}
      />
      <Dialog size="sm" className="space-y-4 p-6">
        <Dialog.Title className="text-lg font-semibold text-balance">
          Delete {state.name}?
        </Dialog.Title>
        <Dialog.Description className="text-sm text-pretty text-kumo-subtle">
          Its chat history, memory, routines and every file on its computer
          are deleted. This can't be undone.
        </Dialog.Description>
        <div className="flex justify-end gap-2">
          <Dialog.Close
            render={(props) => (
              <Button {...props} variant="secondary" className="rounded-full">
                Cancel
              </Button>
            )}
          />
          <Button
            variant="destructive"
            className="rounded-full"
            loading={deleting}
            onClick={() => void remove()}
          >
            Delete
          </Button>
        </div>
      </Dialog>
    </Dialog.Root>
  )
}

export function SettingsPanel() {
  return (
    <div className="min-h-0 flex-1 space-y-8 overflow-y-auto px-4 pt-2 pb-6">
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
