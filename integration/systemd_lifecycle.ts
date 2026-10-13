import {
  install,
  startSystemd,
  stopSystemd,
  uninstall,
  update,
  type SystemdApp,
} from '../launcher/manager'

const [action, unit, command] = Bun.argv.slice(2)
const commandRequired = action === 'install' || action === 'update' || action === 'uninstall'

if (!action || !unit || (commandRequired && !command)) {
  throw new Error(
    'usage: systemd_lifecycle.ts <install|update|uninstall> <unit> <command> | <start|stop|restart> <unit>',
  )
}

const setup: SystemdApp = {
  type: 'systemd',
  unit,
  sudo: false,
  install: action === 'install' ? command : undefined,
  update: action === 'update' ? command : undefined,
  uninstall: action === 'uninstall' ? command : undefined,
}

switch (action) {
  case 'install':
    await install(setup)
    break
  case 'update':
    await update(setup)
    break
  case 'uninstall':
    await uninstall(setup)
    break
  case 'start':
    await startSystemd(setup)
    break
  case 'stop':
    await stopSystemd(setup)
    break
  case 'restart':
    await stopSystemd(setup)
    await startSystemd(setup)
    break
  default:
    throw new Error(`unsupported lifecycle action: ${action}`)
}
