import { readFile } from 'node:fs/promises'
import path from 'node:path'

// Upstream `@deepseek-ai/*` modules read their own manifest through
// `createRequire(import.meta.url)("../package.json")`. The extension ships as a
// single CJS bundle, where esbuild replaces `import.meta` with an empty object,
// so Node rejects the call with ERR_INVALID_ARG_VALUE ("...Received undefined")
// the moment such a module is first evaluated — which happens while the
// extension activates. A bundled module can never read a file next to itself,
// so inline the version its manifest declares and refuse to bundle any other
// `import.meta` use this plugin cannot translate.

// esbuild evaluates `onLoad` filters as Go regular expressions and translates a
// JavaScript `u` flag into `(?u)`, which Go rejects, so this one stays flagless.
const UPSTREAM_MODULE = /[\\/]@deepseek-ai[\\/][^\\/]+[\\/]/
const SCHEMASTERY_MODULE = /[\\/]@deepseek-ai[\\/]schemastery[\\/]lib[\\/]index\.(?:mjs|cjs|js)$/u
const SERIALIZED_CALLBACK =
  /if \(typeof schema\.callback === "string"\) try \{\s*schema\.callback = new Function\("return " \+ schema\.callback\)\(\);\s*\} catch \{\}/gu
const DYNAMIC_CODE = /\b(?:new\s+Function|eval)\s*\(/u

/** Preserve real function callbacks. Never rehydrate callbacks from source text in the Host. */
export const hardenSchemastery = (source) => {
  if ([...source.matchAll(SERIALIZED_CALLBACK)].length !== 1) {
    throw new Error('esbuild: Schemastery callback implementation changed. Review it before bundling.')
  }
  return source.replace(
    SERIALIZED_CALLBACK,
    'if (typeof schema.callback === "string") throw new TypeError("Serialized schema callbacks are unsupported in the DSH extension Host");',
  )
}

const IMPORT_META_USE = /import\.meta/u
const MANIFEST_READ = /createRequire\(\s*import\.meta\.url\s*\)\s*\(\s*(['"])([^'"]+)\1\s*\)/gu
const UNTRANSLATED_MANIFEST_READ = /import_meta\.url/u

const manifestVersion = async (modulePath, specifier) => {
  const manifestPath = path.resolve(path.dirname(modulePath), specifier)
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const version = manifest?.version
  if (typeof version !== 'string' || version === '') {
    throw new Error(
      `esbuild-import-meta-url: ${modulePath} reads ${specifier}, but ${manifestPath} declares no version`,
    )
  }
  return version
}

const inlineManifestReads = async (source, modulePath) => {
  const versions = new Map()
  for (const match of source.matchAll(MANIFEST_READ)) {
    const specifier = match[2]
    if (!versions.has(specifier)) versions.set(specifier, await manifestVersion(modulePath, specifier))
  }
  return source.replace(MANIFEST_READ, (_whole, _quote, specifier) => {
    const version = versions.get(specifier)
    if (version === undefined) {
      throw new Error(`esbuild-import-meta-url: ${specifier} was not resolved for ${modulePath}`)
    }
    return `/* @deepseek-ai manifest read inlined for the CJS bundle: ${specifier} */ ({ version: ${JSON.stringify(version)} })`
  })
}

/** Reject an artifact whose `import.meta` reads survived bundling. */
export const assertBundleTranslatesImportMeta = (bundleText) => {
  if (UNTRANSLATED_MANIFEST_READ.test(bundleText)) {
    throw new Error(
      'esbuild-import-meta-url: the emitted bundle still reads import_meta.url, which is undefined under the CJS output format. Extend the esbuild plugin for the new call shape before shipping.',
    )
  }
}

export const createImportMetaUrlPlugin = () => ({
  name: 'dsh-import-meta-url',
  setup: (build) => {
    build.onLoad({ filter: UPSTREAM_MODULE }, async (args) => {
      const source = await readFile(args.path, 'utf8')
      const hardened = SCHEMASTERY_MODULE.test(args.path) ? hardenSchemastery(source) : source
      if (hardened === source && !IMPORT_META_USE.test(source)) return undefined
      const contents = await inlineManifestReads(hardened, args.path)
      if (IMPORT_META_USE.test(contents)) {
        throw new Error(
          `esbuild-import-meta-url: ${args.path} still reads import.meta after its manifest reads were inlined. The CJS bundle has no import.meta, so this would throw during activation; teach this plugin the new shape.`,
        )
      }
      return { contents, loader: 'js', resolveDir: path.dirname(args.path) }
    })

    build.onEnd(async (result) => {
      if (result.errors.length > 0) return
      const emitted =
        result.outputFiles?.[0]?.text ??
        (build.initialOptions.outfile === undefined
          ? undefined
          : await readFile(build.initialOptions.outfile, 'utf8'))
      if (emitted === undefined) return
      assertBundleTranslatesImportMeta(emitted)
      if (DYNAMIC_CODE.test(emitted)) {
        throw new Error('esbuild: the emitted Extension Host contains a dynamic code execution call.')
      }
    })
  },
})
