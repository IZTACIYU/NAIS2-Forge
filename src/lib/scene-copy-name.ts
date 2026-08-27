import { sanitizeSceneFolderName } from './scene-path.ts'

export function getUniqueDuplicateName(sourceName: string, existingNames: Iterable<string>): string {
    const baseName = sourceName.replace(/\s*\(복사본(?:\s+\d+)?\)$/u, '') || sourceName
    const usedNames = new Set<string>()
    const usedFolderNames = new Set<string>()

    for (const name of existingNames) {
        usedNames.add(name.toLocaleLowerCase())
        usedFolderNames.add(sanitizeSceneFolderName(name).toLocaleLowerCase())
    }

    for (let copyNumber = 1; ; copyNumber++) {
        const candidate = copyNumber === 1
            ? `${baseName} (복사본)`
            : `${baseName} (복사본 ${copyNumber})`
        if (!usedNames.has(candidate.toLocaleLowerCase())
            && !usedFolderNames.has(sanitizeSceneFolderName(candidate).toLocaleLowerCase())) {
            return candidate
        }
    }
}
