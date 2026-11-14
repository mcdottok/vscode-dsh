import type { Plugin } from 'esbuild'

export declare const hardenSchemastery: (source: string) => string
export declare const assertBundleTranslatesImportMeta: (bundleText: string) => void
export declare const createImportMetaUrlPlugin: () => Plugin
