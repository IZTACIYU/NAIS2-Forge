export function parseSceneFeatureCommand(command: string) {
    const match = command.trim().match(/^scene\.(stack|czip)\s+(on|off)$/i)
    return match ? { feature: match[1].toLowerCase() as 'stack' | 'czip', enabled: match[2].toLowerCase() === 'on' } : null
}

export function isSceneConsoleShortcut(event: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey' | 'repeat' | 'isComposing' | 'defaultPrevented'>, editable: boolean) {
    return !editable && !event.defaultPrevented && !event.repeat && !event.isComposing
        && event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey && event.code === 'Backquote'
}
