/** A comment is an otherwise empty # line or a # followed by whitespace. */
export function isPromptCommentLine(line: string): boolean {
    const trimmed = line.trimStart()
    return trimmed === '#' || /^#\s/.test(trimmed)
}

/**
 * Removes full-line prompt comments while preserving NovelAI directives such
 * as #target and #source.
 */
export function removePromptComments(prompt: string): string {
    return prompt
        .split(/\r?\n/)
        .filter(line => !isPromptCommentLine(line))
        .join('\n')
}
