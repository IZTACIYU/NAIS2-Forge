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

export interface TextEdit {
  start: number
  removed: string
  inserted: string
}

export interface TextEditGroup {
  kind: 'insert' | 'delete'
  start: number
  caretAfter: number
  timestamp: number
}

export function describeTextEdit(before: string, after: string): TextEdit {
  let start = 0
  while (start < before.length && start < after.length && before[start] === after[start]) start++

  let beforeEnd = before.length
  let afterEnd = after.length
  while (beforeEnd > start && afterEnd > start && before[beforeEnd - 1] === after[afterEnd - 1]) {
    beforeEnd--
    afterEnd--
  }

  return {
    start,
    removed: before.slice(start, beforeEnd),
    inserted: after.slice(start, afterEnd),
  }
}

export function groupTextEdit(
  previous: TextEditGroup | null,
  edit: TextEdit,
  caretAfter: number,
  timestamp: number,
  timeGap = 700,
): { merge: boolean; group: TextEditGroup | null } {
  const isInsert = edit.removed === '' && edit.inserted.length === 1
  const isDelete = edit.inserted === '' && edit.removed.length === 1
  const character = isInsert ? edit.inserted : edit.removed
  if ((!isInsert && !isDelete) || /[\s,]/.test(character)) return { merge: false, group: null }

  const kind = isInsert ? 'insert' : 'delete'
  const merge = previous !== null
    && previous.kind === kind
    && timestamp - previous.timestamp <= timeGap
    && (kind === 'insert'
      ? edit.start === previous.caretAfter
      : edit.start === previous.start || edit.start + 1 === previous.start)

  return {
    merge,
    group: { kind, start: edit.start, caretAfter, timestamp },
  }
}
