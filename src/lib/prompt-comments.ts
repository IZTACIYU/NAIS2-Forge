/**
 * Removes full-line prompt comments. A comment starts with # after optional
 * leading whitespace, matching the editor's documented comment syntax.
 */
export function removePromptComments(prompt: string): string {
    return prompt
        .split(/\r?\n/)
        .filter(line => !line.trimStart().startsWith('#'))
        .join('\n')
}
