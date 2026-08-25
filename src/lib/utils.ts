import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function generateRandomSeed(): number {
  return Math.floor(Math.random() * 4294967295)
}

export function isEditableEventTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && (target.isContentEditable || target.matches('input, textarea, select'))
}

export function shouldIgnoreGlobalNavigation(event: Pick<KeyboardEvent, 'defaultPrevented' | 'target'>): boolean {
  return event.defaultPrevented || isEditableEventTarget(event.target)
}

export function getHistoryShortcut(event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'shiftKey' | 'key' | 'defaultPrevented' | 'target'>): 'undo' | 'redo' | null {
  if (shouldIgnoreGlobalNavigation(event) || (!event.ctrlKey && !event.metaKey)) return null
  const key = event.key.toLowerCase()
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo'
  return key === 'y' && !event.shiftKey ? 'redo' : null
}

export function appendBoundedHistory<T>(history: readonly T[], appliedSteps: number, entry: T, limit: number): T[] {
  return [...history.slice(0, appliedSteps), entry].slice(-Math.max(1, limit))
}
