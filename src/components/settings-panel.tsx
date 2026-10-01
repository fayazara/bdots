import { useEffect, useState } from "react"
import { Link, useNavigate } from "@tanstack/react-router"
import { Badge } from "@cloudflare/kumo/components/badge"
import { Button } from "@cloudflare/kumo/components/button"
import { Dialog } from "@cloudflare/kumo/components/dialog"
import { Input, InputArea } from "@cloudflare/kumo/components/input"
import { Loader } from "@cloudflare/kumo/components/loader"
import { Select } from "@cloudflare/kumo/components/select"
import { ClockIcon, TrashIcon } from "@phosphor-icons/react"
import { useBot } from "@/lib/bot-context"
import { connectionStatus } from "@/lib/connection-status"
import { useHub } from "@/lib/hub-context"
import { ACTION_CLASSES } from "@/lib/types"
import type { ActionClass, RulePolicy } from "@/lib/types"

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
    <section className="space-y-3 border-b border-kumo-line px-5 py-5 last:border-b-0">
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
      hint="What this bot may do on its own. “Ask first” pauses the work and shows an approval card in the thread."
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
              className="flex items-start gap-3 rounded-xl bg-kumo-tint p-3"
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
      <Rules />
      <Toolkit />
      <Routines />
      <Memory />
      <DangerZone />
    </div>
  )
}
