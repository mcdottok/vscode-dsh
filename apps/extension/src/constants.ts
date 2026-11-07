import { DEFAULT_INSTALL_DSH_VERSION, DSH_PACKAGE_NAME } from '@dsh-vscode/dsh-adapter'

export const EXTENSION_ID = 'mcdottok.dsh-coding-agent'
export const EXTENSION_DISPLAY_NAME = 'DSH Coding Agent'
export const VIEW_ID = 'dsh.chatView'
export const VIEW_CONTAINER_ID = 'vscode-dsh'
/** Editor-area chat surface (`WebviewPanel`) view type. */
export const EDITOR_CHAT_VIEW_TYPE = 'dsh.chatPanel'
/** Host-assigned identity of the secondary-side-bar chat surface. */
export const SIDEBAR_SURFACE_ID = 'sidebar'
export const DSH_PACKAGE = `${DSH_PACKAGE_NAME}@${DEFAULT_INSTALL_DSH_VERSION}`
export const INSTALL_COMMAND = `npm install --global ${DSH_PACKAGE}`
export const DSH_DOCUMENTATION_URL = 'https://github.com/deepseek-ai/deepseek-harness'
