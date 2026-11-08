/**
 * What a path says about itself in `hub/api/list` (protocol.md section 15): passed in the settings of `post` and
 * `stream`, next to `access`. hub-service before descriptions ignores these fields.
 */
export interface Described {
  title?: string
  description: string
  inputSchema?: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean }
}
// Typed, not `satisfies`: schema literals would widen to `type: string`, which ApiSettings' JSONSchema doesn't take
export type Descriptions = { post: Record<string, Described>; stream: Record<string, Described> }

const appName = { type: 'string', description: 'Name of an installed app, as in launcher/info, like "Hub"' }
const strings = (description: string) => ({ type: 'object', description, additionalProperties: { type: 'string' } })
const commands = (description: string) => ({
  description: `${description}: one shell command or several run in order`,
  anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
})
const settings = {
  type: 'object',
  description: 'Environment the app runs with (bun apps)',
  properties: {
    env: strings('Environment values; replaces the previous env as a whole'),
    secrets: strings('Secret environment values; only the given keys change, and launcher/info never shows them'),
  },
}
/** What launcher/info and launch.json keep for every app, besides how it's installed */
const common = {
  name: { type: 'string', description: 'Unique app name' },
  active: { type: 'boolean', description: 'Runs now and when the launcher starts' },
  restarts: { type: 'boolean', description: 'Started again, with backoff, after it crashes' },
  instances: { type: 'integer', minimum: 1, maximum: 1024, description: 'Processes to run (1 when absent)' },
  env: strings('Environment values from the app setup'),
  envValues: strings('Environment keys the app asks for, with placeholders'),
}
const bunApp = {
  type: 'object',
  description: 'A Bun app cloned from GitHub',
  properties: {
    ...common,
    type: { const: 'bun' },
    repo: { type: 'string', description: 'GitHub repository, "owner/name"', examples: ['v57/hub-google'] },
    command: { type: 'string', description: 'What `bun` runs in the clone; "." when absent' },
    commit: { type: 'string', description: 'Commit or tag to stay on; the branch head when absent' },
  },
  required: ['name', 'type', 'repo'],
}
const shellApp = {
  type: 'object',
  description: 'A shell command',
  properties: {
    ...common,
    type: { const: 'sh' },
    run: { type: 'string', description: 'Command that runs the app, through sh -c' },
    directory: { type: 'string', description: 'Folder to run it in' },
    install: commands('Run when installing'),
    checkForUpdates: commands('Exit 0 when an update is available'),
    update: commands('Run when updating'),
    uninstall: commands('Run when uninstalling'),
  },
  required: ['name', 'type', 'run'],
}
const systemdApp = {
  type: 'object',
  description: 'A systemd unit the launcher enables, starts and stops (Linux)',
  properties: {
    ...common,
    type: { const: 'systemd' },
    unit: { type: 'string', description: 'Unit name, like "hub-net.service"', pattern: '^[A-Za-z0-9_.@-]+(?:\\.service)?$' },
    install: commands('Run when installing'),
    checkForUpdates: commands('Exit 0 when an update is available'),
    update: commands('Run when updating'),
    uninstall: commands('Run when uninstalling; should leave the service\'s data'),
    sudo: { type: 'boolean', description: 'Runs systemctl through sudo --non-interactive (default true)' },
  },
  required: ['name', 'type', 'unit'],
}
const appInfo = (setup: Record<string, any>) => ({
  ...setup,
  properties: {
    ...setup.properties,
    updateAvailable: { type: 'boolean', description: 'Found by a check for updates, cleared by updating' },
    settings: { ...settings, description: 'Settings without secrets' },
  },
})
const date = (description: string) => ({ type: 'string', format: 'date-time', description })
const appStatus = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    checkingForUpdates: { type: 'boolean' },
    updating: { type: 'boolean' },
    lastError: { type: 'string', description: 'Last install, update, start or process failure, like "run: exited with code 1: …"; cleared after a success' },
    crashes: { type: 'integer', minimum: 0, description: 'Failed starts and crashes since the launcher started' },
    processes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          pid: { type: 'integer' },
          cpu: { type: 'number', description: 'CPU percent, 0 below 2' },
          memory: { type: 'number', description: 'Resident memory in MB' },
        },
        required: ['pid', 'cpu', 'memory'],
      },
    },
    started: date('When it was started'),
    nextRestart: date('When a crashed app is started again'),
  },
  required: ['name', 'crashes', 'processes'],
}

const grant = (name: string) => `Needs the "${name}" permission (Launcher group) granted by an owner.`
const ownersOnly = 'Owners only: a grant doesn\'t open it.'

export const descriptions: Descriptions = {
  post: {
    'launcher/update': {
      title: 'Update the launcher',
      description: `Runs git pull in the launcher's own folder; the new code runs after the launcher restarts. Fails with git's error when the pull does. ${ownersOnly}`,
      annotations: { openWorldHint: true },
    },
    'launcher/update/check': {
      title: 'Check for a launcher update',
      description: `Whether the launcher's own repository has new commits upstream (git fetch --dry-run). ${grant('Check for updates')}`,
      outputSchema: { type: 'boolean', description: 'True when an update is available' },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    'launcher/update/check/all': {
      title: 'Check apps for updates',
      description: `Checks every app not already marked for its update, marking those with one as updateAvailable in launcher/info; a failed check counts as no update. ${grant('Check for updates')}`,
      annotations: { idempotentHint: true, openWorldHint: true },
    },
    'launcher/update/all': {
      title: 'Update apps',
      description: `Updates every app marked updateAvailable (pinned bun apps go to their commit or tag) and restarts the active ones; stops at the first failure, which also shows as the app's lastError. Run launcher/update/check/all first. ${ownersOnly}`,
      annotations: { openWorldHint: true },
    },
    'launcher/stop': {
      title: 'Stop all apps',
      description: `Stops every app the launcher runs, the Hub server included, and returns without waiting; the launcher itself keeps running. ${grant('Stop apps')}`,
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    'launcher/app/logs': {
      title: 'App logs',
      description: `The last lines an app wrote to stdout and stderr since the launcher started, oldest first (it keeps 500). Fails with "app not found". ${grant('View app information')}`,
      inputSchema: {
        anyOf: [
          appName,
          {
            type: 'object',
            properties: { name: appName, limit: { type: 'integer', minimum: 1, maximum: 500, default: 200, description: 'Lines to return' } },
            required: ['name'],
          },
        ],
      },
      outputSchema: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            time: { type: 'number', description: 'Unix time in milliseconds' },
            stream: { type: 'string', enum: ['stdout', 'stderr'] },
            text: { type: 'string' },
          },
          required: ['time', 'stream', 'text'],
        },
      },
      annotations: { readOnlyHint: true },
    },
    'launcher/pair/new': {
      title: 'New pairing code',
      description: `Runs hub-server --pair on this device, which replaces the old pairing code, and returns the new one for another person to become an owner. Fails with "hub-server is not installed" or the pair command's error. ${ownersOnly}`,
      outputSchema: { type: 'string', description: 'Pairing code to enter in the Hub app', examples: ['K7Q-2MX'] },
    },
    'launcher/app/stop': {
      title: 'Stop an app',
      description: `Stops an app's processes and saves it as inactive, so it stays stopped after the launcher restarts. Fails with "app not found". ${grant('Stop apps')}`,
      inputSchema: appName,
      annotations: { idempotentHint: true },
    },
    'launcher/app/start': {
      title: 'Start an app',
      description: `Starts an app's processes up to its instance count and saves it as active. Fails with "app not found"; a failed launch shows as the app's lastError. ${grant('Start apps')}`,
      inputSchema: appName,
      annotations: { idempotentHint: true },
    },
    'launcher/app/restart': {
      title: 'Restart an app',
      description: `Stops an app and starts it again, also one that was stopped. Fails with "app not found". ${grant('Restart apps')}`,
      inputSchema: appName,
    },
    'launcher/app/create': {
      title: 'Install an app',
      description: `Installs an app (clones and bun installs a repo, or runs its install commands) and starts it when active. For an app with that name already installed it only changes active and restarts. Fails with the install's error. ${ownersOnly}`,
      inputSchema: { description: 'The app to install', anyOf: [bunApp, shellApp, systemdApp] },
      annotations: { openWorldHint: true },
    },
    'launcher/app/uninstall': {
      title: 'Uninstall an app',
      description: `Stops an app, runs its uninstall (deletes a bun app's clone) and removes it from the launcher. An unknown name does nothing. ${ownersOnly}`,
      inputSchema: appName,
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    'launcher/app/settings': {
      title: 'Change app settings',
      description: `Sets an app's environment and secrets and restarts it when active. env replaces the previous env; secrets change only the keys given. Fails with "app not found". ${ownersOnly}`,
      inputSchema: { type: 'object', properties: { app: appName, settings }, required: ['app', 'settings'] },
    },
    'launcher/app/cluster': {
      title: 'Set app instances',
      description: `Runs an app as this many processes, starting or stopping the difference; a count below 1 means 1. Fails with "app not found" or "too many instances" above 1024. ${ownersOnly}`,
      inputSchema: {
        type: 'object',
        properties: { name: appName, count: { type: 'integer', maximum: 1024, description: 'Processes to run' } },
        required: ['name', 'count'],
      },
      annotations: { idempotentHint: true },
    },
  },
  stream: {
    'launcher/info': {
      title: 'Installed apps',
      description: `The installed apps and their setup, without secrets, sent again whenever one changes. ${grant('View app information')}`,
      outputSchema: {
        type: 'object',
        properties: { apps: { type: 'array', items: { anyOf: [appInfo(bunApp), appInfo(shellApp), appInfo(systemdApp)] } } },
        required: ['apps'],
      },
      annotations: { readOnlyHint: true },
    },
    'launcher/status': {
      title: 'App status',
      description: `Every app's processes with CPU and memory, crashes, update progress and last error, sent at most every half second while it changes. ${grant('View app information')}`,
      outputSchema: { type: 'object', properties: { apps: { type: 'array', items: appStatus } }, required: ['apps'] },
      annotations: { readOnlyHint: true },
    },
  },
}
