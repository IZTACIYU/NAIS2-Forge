export type RemoteAssetKind = 'characters' | 'references' | 'fragments'
export interface RemoteAsset {
    kind: RemoteAssetKind; id: string; revision?: string; name: string; enabled: boolean;
    prompt?: string; negative?: string; position?: { x: number; y: number };
    mode?: 'character' | 'vibe'; referenceType?: 'character' | 'style' | 'character&style';
    strength?: number; fidelity?: number; informationExtracted?: number; image?: string;
    folder?: string; content?: string[];
}
export interface RemoteAssetPage {
    kind: RemoteAssetKind; page: number; totalPages: number;
    items: { id: string; name: string; enabled: boolean; thumbnail?: string }[];
    asset?: RemoteAsset;
    cached?: boolean;
}
export async function remoteRevision(value: unknown) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)))
    return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')
}
export function validateRemoteAssets(value: unknown): RemoteAsset[] {
    if (!Array.isArray(value) || value.length > 64 || new TextEncoder().encode(JSON.stringify(value)).byteLength > 1_500_000) throw new Error('Invalid assets')
    const text = (value: unknown, max: number) => typeof value === 'string' && value.length <= max
    const ids = new Set<string>()
    for (const item of value) {
        if (!item || typeof item !== 'object' || !['characters', 'references', 'fragments'].includes(item.kind) ||
            !text(item.id, 100) || !item.id || !text(item.name, 200) || typeof item.enabled !== 'boolean' ||
            item.revision !== undefined && (typeof item.revision !== 'string' || !/^[a-f0-9]{64}$/.test(item.revision))) throw new Error('Invalid asset')
        const allowed = ['kind', 'id', 'revision', 'name', 'enabled', ...(item.kind === 'characters' ? ['prompt', 'negative', 'position'] : item.kind === 'references' ? ['mode', 'referenceType', 'strength', 'fidelity', 'informationExtracted', 'image'] : ['folder', 'content'])]
        if (Object.keys(item).some(key => !allowed.includes(key)) || ids.has(`${item.kind}:${item.id}`)) throw new Error('Invalid asset fields')
        ids.add(`${item.kind}:${item.id}`)
        if (!item.revision && !item.id.startsWith('web-')) throw new Error('Invalid new asset')
        if (item.kind === 'characters' && (!text(item.prompt, 100_000) || !text(item.negative, 100_000) || !item.position ||
            Object.keys(item.position).some(key => !['x', 'y'].includes(key)) || ![item.position.x, item.position.y].every(number => typeof number === 'number' && Number.isFinite(number) && number >= 0 && number <= 1))) throw new Error('Invalid character')
        if (item.kind === 'references' && (!['character', 'vibe'].includes(item.mode) || !['character', 'style', 'character&style'].includes(item.referenceType) ||
            ![item.strength, item.fidelity, item.informationExtracted].every(number => typeof number === 'number' && Number.isFinite(number) && number >= 0 && number <= 1) ||
            item.image !== undefined && (!text(item.image, 1_000_000) || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(item.image)) || !item.revision && !item.image)) throw new Error('Invalid reference')
        if (item.kind === 'fragments' && (!text(item.folder, 200) || !Array.isArray(item.content) || item.content.length > 1000 ||
            !item.content.every((line: unknown) => text(line, 10_000)) || item.content.join('\n').length > 100_000 || /[<>|*\\]/.test(item.name))) throw new Error('Invalid fragment')
    }
    return structuredClone(value)
}
