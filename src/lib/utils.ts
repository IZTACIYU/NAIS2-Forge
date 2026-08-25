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
