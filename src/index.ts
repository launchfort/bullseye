import * as path from 'path'
import { spawn, fork } from 'child_process'

// See: https://github.com/zamnuts/nodejs-fork-example

function start (cmd: string, { silent = false, env = null } = {}) {
  const parts = cmd.split(' ')
  const command = parts[0][0] === '.' ? path.resolve(parts[0]) : parts[0]
  const handle = {
    process: spawn(command, parts.slice(1), {
      stdio: silent ? 'pipe' : 'inherit',
      env: env || process.env,
      cwd: process.cwd()
    }),
    promise: Promise.resolve()
  }

  handle.promise = new Promise<void>(function (resolve, reject) {
    let resolved = false
    handle.process.once('error', error => {
      resolved = true
      reject(error)
    })
    handle.process.once('exit', (code, signal) => {
      if (resolved) return
      if (code === 0) {
        resolve()
      } else {
        signal = signal ? `${signal}:` : ''
        reject(new Error(`Child exited with ${signal}${code}`))
      }
    })
  })

  return Promise.resolve(handle)
}

function startModule (moduleName: string, args: string[] = [], { silent = false, execPath = '', execArgv = null, env = null } = {}) {
  execPath = execPath
    ? (execPath.startsWith('.')
      ? path.resolve(execPath)
      : execPath)
    : process.execPath

  execArgv = typeof execArgv === 'string'
    ? execArgv.split(' ')
    : process.execArgv

  const handle = {
    promise: Promise.resolve(),
    process: fork(moduleName, args, {
      silent,
      cwd: process.cwd(),
      env: Object.assign({}, env || process.env),
      execPath: execPath,
      execArgv: execArgv
    })
  }

  handle.promise = new Promise<void>((resolve, reject) => {
    let resolved = false
    handle.process.on('error', error => {
      resolved = true
      reject(error)
    })
    handle.process.on('exit', (code, signal) => {
      if (resolved) return
      if (!code) {
        resolve()
      } else {
        signal = signal ? signal + ':' : ''
        reject(new Error(`Child exited with ${signal}${code}`))
      }
    })
  })

  return Promise.resolve(handle)
}

export function monitor (cmd: string, { env = null, silent = false } = {}) {
  return start(cmd, { env, silent }).then(handle => {
    let stopped = false

    handle.promise.then(() => {
      stopped = true
    }, () => {
      stopped = true
    })

    return Promise.resolve({
      promise: handle.promise,
      get stopped () { return stopped },
      get running () { return !stopped },
      stop () {
        if (!stopped) {
          stopped = true

          try {
            handle.process.kill('SIGINT')
          } catch (_) {
          }
        }
        return this.promise
      },
      restart () {
        const doRestart = () => {
          return monitor(cmd, { env, silent })
        }
        return this.stop().then(doRestart, doRestart)
      }
    })
  })
}

export function monitorModule (moduleName: string, args: string[] = [], { env = null, silent = false, waitForReady = false, execPath = '', execArgv = null } = {}) {
  return startModule(moduleName, args, { env, silent, execPath, execArgv })
    .then(handle => {
      let stopped = false

      handle.promise.then(() => {
        stopped = true
      }, () => {
        stopped = true
      })

      const monitorHandle = {
        promise: handle.promise,
        get stopped () { return stopped },
        get running () { return !stopped },
        stop () {
          if (!stopped) {
            stopped = true

            try {
              handle.process.send('shutdown')
            } catch (_) {
            }
          }
          return this.promise
        },
        restart () {
          const doRestart = () => {
            return monitorModule(moduleName, args, {
              env, silent, waitForReady, execArgv, execPath
            })
          }
          return this.stop().then(doRestart, doRestart)
        }
      }

      return new Promise((resolve, reject) => {
        if (waitForReady) {
          const tid = setTimeout(() => {
            handle.process.removeListener('message', onMessage)
            resolve(monitorHandle)
          }, 5000)
          const onMessage = msg => {
            if (msg === 'ready') {
              clearTimeout(tid)
              handle.process.removeListener('message', onMessage)
              resolve(monitorHandle)
            }
          }
          handle.process.on('message', onMessage)
        } else {
          resolve(monitorHandle)
        }
      })
    })
}
