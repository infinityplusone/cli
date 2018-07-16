const promisify = require('util.promisify')
const walker = require('folder-walker')
const pump = promisify(require('pump'))
const objFilter = require('through2-filter').obj
const transform = require('parallel-transform')
const hasha = require('hasha')
const objWriter = require('flush-write-stream').obj
const path = require('path')

const noop = () => {}

module.exports = fileHasher
async function fileHasher(dir, opts) {
  opts = {
    onProgress: noop,
    parallel: 100,
    ...opts
  }

  // Written to by manifestCollector
  const files = {}
  const shaMap = {}

  // Progress tracking
  const progress = {
    total: 0,
    current: 0
  }
  let progressDue = true
  const throttle = setInterval(() => {
    progressDue = true
  }, 500)
  const progressLookahead = walker(dir)
  progressLookahead.on('data', () => {
    progress.total++
  })

  const fileStream = walker(dir)

  const filter = objFilter(
    fileObj => fileObj.type === 'file' && (fileObj.relname.match(/(\/__MACOSX|\/\.)/) ? false : true)
  )

  const hasher = transform(opts.parallel, { objectMode: true }, (fileObj, cb) => {
    hasha
      .fromFile(fileObj.filepath, { algorithm: 'sha1' })
      .then(sha1 => cb(null, { ...fileObj, sha1 }))
      .catch(err => cb(err))
  })

  const manifestCollector = objWriter(write, flush)
  function write(fileObj, _, cb) {
    const normalizedPath = normalizePath(fileObj.relname)

    files[normalizedPath] = fileObj.sha1
    shaMap[fileObj.sha1] = { ...fileObj, normalizedPath }

    progress.current++
    if (progressDue) {
      progressDue = false
      opts.onProgress({ ...progress })
    }

    cb(null)
  }
  function flush(cb) {
    opts.onProgress({ ...progress })
    clearInterval(throttle)
    cb(null)
  }

  await pump(fileStream, filter, hasher, manifestCollector)

  return { files, shaMap }
}

module.exports.normalizePath = normalizePath
function normalizePath(relname) {
  return (
    '/' +
    relname
      .split(path.sep)
      .map(segment => {
        return encodeURIComponent(segment)
      })
      .join('/')
  )
}