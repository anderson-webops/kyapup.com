import { resolve } from 'node:path'

export function frontendCommand(projectRoot) {
  const directory = resolve(projectRoot, 'front-end')
  return {
    cwd: directory,
    args: ['exec', '--workspace', directory, '--'],
  }
}
