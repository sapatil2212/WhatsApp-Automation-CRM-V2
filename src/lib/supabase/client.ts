import { createClient as createCompatClient } from './compat-client'

export function createClient() {
  return createCompatClient()
}

export function createBrowserClient() {
  return createCompatClient()
}
