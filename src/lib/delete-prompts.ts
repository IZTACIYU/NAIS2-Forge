const normalize = (text: string) => text.trim().replace(/\s+/g, ' ').toLowerCase()

/** Collect before joining prompt boxes, so a trailing directive cannot eat the next box. */
export function stripDeleteDirectives(prompt: string, targets: Set<string>): string {
    return prompt.split(/(\r?\n)/).map((line, index, lines) => {
        if (index % 2) return /^\s*#del-/i.test(lines[index - 1]) ? '' : line
        const match = line.match(/^\s*#del-(.*)$/i)
        if (!match) return line
        const target = normalize(match[1].replace(/,\s*$/, ''))
        if (target) targets.add(target)
        return ''
    }).join('')
}

/** Delete whole tags, preserving untouched text and the remaining weight groups. */
export function deletePromptTags(prompt: string, targets: ReadonlySet<string>): string {
    if (!targets.size) return prompt
    let offset = 0
    const weightPattern = /(?:[+-]?(?:\d+(?:\.\d+)?|\.\d+))?::/y
    function parse(close = '', depth = 0): { text: string; changed: boolean; closed: boolean } {
        const start = offset
        const parts: { text: string; separator: string; removed: boolean }[] = []
        let text = '', changed = false, segmentChanged = false
        const flush = (separator: string) => {
            const removed = targets.has(normalize(text)) || (segmentChanged && !text.trim())
            changed ||= removed
            parts.push({ text, separator, removed })
            text = ''; segmentChanged = false
        }
        while (offset < prompt.length) {
            if (close && prompt.startsWith(close, offset)) break
            const char = prompt[offset]
            // Quoted text is not a tag list; commas/weights inside it stay literal.
            if (char === '"' || (char === "'" && !/[\p{L}\p{N}_]/u.test(prompt[offset - 1] || ''))) {
                let end = offset + 1
                while (end < prompt.length) {
                    if (prompt[end] === '\\') { end += 2; continue }
                    if (prompt[end] === char) { end++; break }
                    end++
                }
                text += prompt.slice(offset, end); offset = end; continue
            }
            weightPattern.lastIndex = offset
            const weight = weightPattern.exec(prompt)
            const opener = weight?.[0] ?? (char === '{' || char === '[' ? char : '')
            if (opener && depth < 64) {
                const groupStart = offset
                offset += opener.length
                const inner = parse(opener === '{' ? '}' : opener === '[' ? ']' : '::', depth + 1)
                if (!inner.closed) { text += prompt.slice(groupStart, offset); continue }
                const closer = opener === '{' ? '}' : opener === '[' ? ']' : '::'
                offset += closer.length
                text += inner.changed && !inner.text.trim() ? '' : opener + inner.text + closer
                changed ||= inner.changed
                segmentChanged ||= inner.changed
                continue
            }
            if (char === ',' || char === '\n' || char === '\r') {
                const separator = prompt.startsWith('\r\n', offset) ? '\r\n' : char
                flush(separator); offset += separator.length; continue
            }
            text += char; offset++
        }
        flush('')
        if (!changed) return { text: prompt.slice(start, offset), changed: false, closed: !!close && prompt.startsWith(close, offset) }
        const kept = parts.filter(part => !part.removed)
        return {
            text: kept.map((part, i) => part.text + (i < kept.length - 1 ? part.separator : '')).join(''),
            changed: true,
            closed: !!close && prompt.startsWith(close, offset),
        }
    }
    return parse().text
}
