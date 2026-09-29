import { useCharacterPromptStore } from '@/stores/character-prompt-store'
import { useCharacterStore } from '@/stores/character-store'
import type { ReferenceImage } from '@/stores/character-store'
import { useFragmentStore, normalizeFragmentPath } from '@/stores/fragment-store'
import { getModelCapabilities } from '@/lib/model-capabilities'
import { useSceneStore } from '@/stores/scene-store'
import { useGenerationStore } from '@/stores/generation-store'
import { pickRemoteSettings, type RemoteGenerationSettings, type RemoteSceneDraft } from '@/lib/remote-generation'
import { remoteRevision, type RemoteAsset, type RemoteAssetKind, type RemoteAssetPage } from '@/lib/remote-workspace'
import type { CharacterPrompt } from '@/stores/character-prompt-store'
import { resolveRemoteScene } from './remote-scene-queue'
export interface RemoteResolvedWorkspace {
    characters: CharacterPrompt[]; characterImages: ReferenceImage[]; vibeImages: ReferenceImage[];
    positionEnabled: boolean;
    charactersEdited: boolean;
    fragments: Record<string, string[]>;
    fragmentResolver?: (path: string, sequential: boolean) => Promise<string | null>;
}

export async function readRemoteAsset(kind: RemoteAssetKind, id: string): Promise<RemoteAsset> {
    let asset: RemoteAsset
    if (kind === 'characters') {
        const item = useCharacterPromptStore.getState().characters.find(item => item.id === id)
        if (!item) throw new Error('Missing character')
        asset = { kind, id, name: item.name || '', enabled: item.enabled, prompt: item.prompt, negative: item.negative, position: { ...item.position },
            ...(item.promptEnabled !== undefined && { promptEnabled: item.promptEnabled }), ...(item.negativeEnabled !== undefined && { negativeEnabled: item.negativeEnabled }), ...(item.costumeEnabled !== undefined && { costumeEnabled: item.costumeEnabled }) }
    } else if (kind === 'references') {
        const state = useCharacterStore.getState(), item = [...state.characterImages, ...state.vibeImages].find(item => item.id === id)
        if (!item) throw new Error('Missing reference')
        asset = { kind, id, name: item.name || '', enabled: item.enabled, mode: state.characterImages.includes(item) ? 'character' : 'vibe', referenceType: item.referenceType,
            strength: item.strength, fidelity: item.fidelity, informationExtracted: item.informationExtracted }
    } else {
        const item = await useFragmentStore.getState().getFileWithContent(id)
        if (!item) throw new Error('Missing fragment')
        asset = { kind, id, name: item.name, folder: item.folder, content: item.content, enabled: true }
    }
    return { ...asset, revision: await remoteRevision(asset) }
}
export async function remoteAssetPage(kind: unknown, page: unknown, id?: unknown): Promise<RemoteAssetPage> {
    if (!['characters', 'references', 'fragments'].includes(String(kind)) || typeof page !== 'number' || !Number.isInteger(page) || page < 0 || id !== undefined && (typeof id !== 'string' || id.length > 100)) throw new Error('Invalid asset query')
    const characters = useCharacterPromptStore.getState(), refs = useCharacterStore.getState(), fragments = useFragmentStore.getState()
    const source = kind === 'characters' ? characters.characters : kind === 'references' ? [...refs.characterImages, ...refs.vibeImages] : fragments.files
    const totalPages = Math.max(1, Math.ceil(source.length / 12))
    if (page >= totalPages) throw new Error('Invalid page')
    return { kind: kind as RemoteAssetKind, page, totalPages, items: source.slice(page * 12, page * 12 + 12).map(item => ({ id: item.id, name: item.name || (kind === 'characters' ? '' : item.id),
        enabled: 'enabled' in item ? item.enabled : true, thumbnail: 'thumbnail' in item && item.thumbnail && item.thumbnail.length < 80_000 ? item.thumbnail : undefined })),
        asset: id === undefined ? undefined : await readRemoteAsset(kind as RemoteAssetKind, id as string),
        cached: kind === 'references' && typeof id === 'string' ? refs.vibeImages.some(item => item.id === id && !!(item.encodedVibe || item.encodedVibePath)) : undefined }
}
export async function resolveRemoteAssets(assets: RemoteAsset[], model: string): Promise<RemoteResolvedWorkspace> {
    const characterState = useCharacterPromptStore.getState(), refs = useCharacterStore.getState()
    const charactersEdited = assets.some(asset => asset.kind === 'characters')
    const result: RemoteResolvedWorkspace = { characters: structuredClone(characterState.characters), charactersEdited, positionEnabled: characterState.positionEnabled || charactersEdited, characterImages: refs.characterImages.map(item => ({ ...item })), vibeImages: refs.vibeImages.map(item => ({ ...item })), fragments: Object.create(null) }
    for (const asset of assets) {
        if (asset.revision) {
            const current = await readRemoteAsset(asset.kind, asset.id)
            if (current.revision !== asset.revision) throw new Error('PC item changed; reload before editing')
            if (asset.kind === 'references' && (asset.image || asset.mode !== current.mode)) throw new Error('Cannot replace a stored reference source')
        } else if (asset.kind === 'characters' && characterState.characters.some(item => item.id === asset.id) || asset.kind === 'references' && [...refs.characterImages, ...refs.vibeImages].some(item => item.id === asset.id)) throw new Error('Duplicate asset')
        if (asset.kind === 'characters') {
            const index = result.characters.findIndex(item => item.id === asset.id)
            const item = { ...(index < 0 ? {} : result.characters[index]), id: asset.id, name: asset.name, enabled: asset.enabled, prompt: asset.prompt!, negative: asset.negative!, position: asset.position!,
                ...(asset.promptEnabled !== undefined && { promptEnabled: asset.promptEnabled }), ...(asset.negativeEnabled !== undefined && { negativeEnabled: asset.negativeEnabled }), ...(asset.costumeEnabled !== undefined && { costumeEnabled: asset.costumeEnabled }) }
            if (index < 0) result.characters.push(item); else result.characters[index] = item
        } else if (asset.kind === 'references') {
            if (asset.image) {
                const image = new Image(); image.src = asset.image
                try { await image.decode(); if (image.width < 1 || image.height < 1 || image.width * image.height > 16_777_216) throw new Error('Reference image too large') }
                finally { image.src = '' }
            }
            const target = asset.mode === 'character' ? result.characterImages : result.vibeImages, index = target.findIndex(item => item.id === asset.id)
            const item: ReferenceImage = { ...(index < 0 ? { base64: asset.image! } : target[index]), id: asset.id, name: asset.name, enabled: asset.enabled, referenceType: asset.referenceType!, strength: asset.strength!, fidelity: asset.fidelity!, informationExtracted: asset.informationExtracted! }
            if (index >= 0 && item.informationExtracted !== target[index].informationExtracted) { item.encodedVibe = undefined; item.encodedVibePath = undefined }
            if (index < 0) target.push(item); else target[index] = item
        } else {
            const path = normalizeFragmentPath([asset.folder, asset.name].filter(Boolean).join('/'))
            const existing = useFragmentStore.getState().getFileByPath(path)
            if (!path || path in result.fragments || existing && existing.id !== asset.id) throw new Error('Duplicate fragment path')
            result.fragments[path] = asset.content!
        }
    }
    const activeRefs = result.characterImages.filter(item => item.enabled), activeVibes = result.vibeImages.filter(item => item.enabled)
    if (activeRefs.length && activeVibes.length || activeRefs.length > 10 || activeVibes.length > 10 || result.characters.filter(item => item.enabled).length > getModelCapabilities(model).maxCharacterPrompts) throw new Error('Invalid active reference or character count')
    const counters = new Map<string, number>()
    result.fragmentResolver = async (path, sequential) => {
        if (!(path in result.fragments)) {
            const file = useFragmentStore.getState().getFileByPath(path)
            result.fragments[path] = file ? await useFragmentStore.getState().loadFileContent(file.id) : []
        }
        const lines = result.fragments[path].filter(line => line.trim())
        if (!lines.length) return null
        const index = sequential ? counters.get(path) ?? 0 : Math.floor(Math.random() * lines.length)
        if (sequential) counters.set(path, index + 1)
        return lines[index % lines.length]
    }
    return result
}

// Only changed items are written; never swap a whole persisted store for a web snapshot.
export async function applyRemoteAssets(assets: RemoteAsset[], model: string, isCurrent: () => boolean) {
    await resolveRemoteAssets(assets, model)
    const undo: (() => unknown | Promise<unknown>)[] = [], applied: { kind: RemoteAssetKind; id: string; originalId: string }[] = []
    const characters = useCharacterPromptStore.getState(), previousLimit = characters.activeCharacterLimit
    const temporaryLimit = Math.max(previousLimit, getModelCapabilities(model).maxCharacterPrompts)
    characters.setActiveCharacterLimit(temporaryLimit)
    undo.push(() => { if (useCharacterPromptStore.getState().activeCharacterLimit === temporaryLimit) useCharacterPromptStore.setState({ activeCharacterLimit: previousLimit }) })
    // Roll back only the exact value written by this operation, never a later PC edit.
    const guardedUndo = (read: () => unknown, restore: () => unknown | Promise<unknown>) => {
        const written = JSON.stringify(read())
        undo.push(() => { if (JSON.stringify(read()) === written) return restore() })
    }
    try {
        for (const asset of [...assets].sort((a, b) => Number(a.enabled) - Number(b.enabled))) {
            if (!isCurrent()) throw new Error('Connection expired')
            const old = asset.revision ? await readRemoteAsset(asset.kind, asset.id) : undefined
            if (old?.revision !== asset.revision) throw new Error('PC item changed')
            if (!isCurrent()) throw new Error('Connection expired')
            if (asset.kind === 'characters') {
                const state = useCharacterPromptStore.getState(), fields = { name: asset.name, enabled: asset.enabled, prompt: asset.prompt!, negative: asset.negative!, position: asset.position!,
                    ...(asset.promptEnabled !== undefined && { promptEnabled: asset.promptEnabled }), ...(asset.negativeEnabled !== undefined && { negativeEnabled: asset.negativeEnabled }), ...(asset.costumeEnabled !== undefined && { costumeEnabled: asset.costumeEnabled }) }
                const read = () => useCharacterPromptStore.getState().characters.find(item => item.id === asset.id)
                if (old) { const previous = structuredClone(read()!); state.updateCharacter(asset.id, fields); guardedUndo(read, () => useCharacterPromptStore.setState(current => ({ characters: current.characters.map(item => item.id === asset.id ? previous : item) }))) }
                else { state.addCharacter({ id: asset.id, ...fields }); guardedUndo(read, () => state.removeCharacter(asset.id)) }
                applied.push({ kind: asset.kind, id: asset.id, originalId: asset.id })
            } else if (asset.kind === 'fragments') {
                const state = useFragmentStore.getState()
                if (old) { await state.updateFile(asset.id, { name: asset.name, folder: asset.folder, content: asset.content }, isCurrent); guardedUndo(() => useFragmentStore.getState().files.find(item => item.id === asset.id), () => state.updateFile(asset.id, { name: old.name, folder: old.folder, content: old.content }, () => true)); applied.push({ kind: asset.kind, id: asset.id, originalId: asset.id }) }
                else { const item = await state.addFile(asset.name, asset.folder, asset.content, asset.id); guardedUndo(() => useFragmentStore.getState().files.find(file => file.id === item.id), () => useFragmentStore.setState(state => ({ files: state.files.filter(file => file.id !== item.id) }))); applied.push({ kind: asset.kind, id: item.id, originalId: asset.id }) }
            } else {
                const state = useCharacterStore.getState(), key = asset.mode === 'character' ? 'characterImages' : 'vibeImages'
                const update = asset.mode === 'character' ? state.updateCharacterImage : state.updateVibeImage
                let id = asset.id
                let newReference: string | undefined
                if (!old) {
                    const before = new Set(state[key].map(item => item.id))
                    if (asset.mode === 'character') await state.addCharacterImage(asset.image!, asset.name)
                    else await state.addVibeImage(asset.image!, undefined, asset.informationExtracted, asset.strength, asset.name)
                    const item = useCharacterStore.getState()[key].find(item => !before.has(item.id) && item.name === asset.name)
                    if (!item) throw new Error('Reference save failed')
                    id = item.id
                    newReference = JSON.stringify(item)
                    undo.push(() => { if (JSON.stringify(useCharacterStore.getState()[key].find(item => item.id === id)) === newReference) useCharacterStore.setState(state => ({ [key]: state[key].filter(item => item.id !== id) })) })
                    if (!item.filePath) throw new Error('Reference file save failed')
                }
                const previous = { ...useCharacterStore.getState()[key].find(item => item.id === id)! }
                update(id, { name: asset.name, enabled: asset.enabled, referenceType: asset.referenceType, strength: asset.strength, fidelity: asset.fidelity, informationExtracted: asset.informationExtracted,
                    ...(previous.informationExtracted !== asset.informationExtracted ? { encodedVibe: undefined, encodedVibePath: undefined } : {}) })
                if (old) guardedUndo(() => useCharacterStore.getState()[key].find(item => item.id === id), () => update(id, previous))
                else newReference = JSON.stringify(useCharacterStore.getState()[key].find(item => item.id === id))
                applied.push({ kind: asset.kind, id, originalId: asset.id })
            }
        }
        if (!isCurrent()) throw new Error('Connection expired')
        const saved = await Promise.all(assets.map(asset => { const item = applied.find(item => item.kind === asset.kind && item.originalId === asset.id)!; return readRemoteAsset(item.kind, item.id) }))
        for (let index = 0; index < assets.length; index++) {
            const { id: _id, revision: _revision, image: _image, ...requested } = assets[index]
            const { id: _savedId, revision: _savedRevision, ...actual } = saved[index]
            if (requested.kind === 'fragments') { requested.name = requested.name.trim(); requested.folder = requested.folder!.trim() }
            if (Object.keys(requested).length !== Object.keys(actual).length || Object.entries(actual).some(([key, value]) => JSON.stringify(value) !== JSON.stringify(requested[key as keyof typeof requested]))) throw new Error('PC item changed during save')
        }
        return { assets: saved, rollback: async () => { for (const restore of undo.reverse()) await restore() } }
    } catch (error) {
        for (const restore of undo.reverse()) await restore()
        throw error
    }
}

export function remoteSceneDocument(presetId: string, sceneId: string) {
    const state = useSceneStore.getState(), scene = state.getScene(presetId, sceneId)
    if (!scene) throw new Error('Missing scene')
    const addition = state.sceneCharacterAdditions[presetId]?.[sceneId]
    return { scenePrompt: scene.scenePrompt, sceneNegativePrompt: scene.sceneNegativePrompt || '', multiCharacterSlots: scene.multiCharacterSlots || [], characterPromptIds: addition?.characterPromptIds || [], npcs: addition?.customCharacters || [] }
}
export async function applyRemoteWorkspace(settings: RemoteGenerationSettings, revision: unknown, assets: RemoteAsset[], queue: RemoteSceneDraft[] | undefined, isCurrent: () => boolean) {
    const generation = useGenerationStore.getState(), previous = pickRemoteSettings(generation)
    if (typeof revision !== 'string' || revision !== await remoteRevision(previous)) throw new Error('PC settings changed; reload before applying')
    const sceneDocuments = new Map<string, string>()
    for (const item of queue || []) {
        const scene = useSceneStore.getState().getScene(item.presetId, item.sceneId)
        if (scene && item.revision !== await remoteRevision(remoteSceneDocument(item.presetId, item.sceneId))) throw new Error('PC scene changed; reload before applying')
        if (!scene && !item.newScene) throw new Error('Missing scene')
        sceneDocuments.set(JSON.stringify([item.presetId, item.sceneId]), JSON.stringify(scene ? remoteSceneDocument(item.presetId, item.sceneId) : null))
    }
    if (!isCurrent()) throw new Error('Connection expired')
    const saved = await applyRemoteAssets(assets, settings.model, isCurrent)
    // Synchronous owner actions after all awaited reads, so late PC prompt changes are not overwritten.
    if (!isCurrent() || JSON.stringify(previous) !== JSON.stringify(pickRemoteSettings(useGenerationStore.getState()))) { await saved.rollback(); throw new Error('PC settings changed; reload before applying') }
    for (const item of queue || []) {
        const scene = useSceneStore.getState().getScene(item.presetId, item.sceneId)
        if (sceneDocuments.get(JSON.stringify([item.presetId, item.sceneId])) !== JSON.stringify(scene ? remoteSceneDocument(item.presetId, item.sceneId) : null)) { await saved.rollback(); throw new Error('PC scene changed') }
    }
    if (!isCurrent()) { await saved.rollback(); throw new Error('Connection expired') }
    const sceneBefore = useSceneStore.getState(), characterBefore = useCharacterPromptStore.getState()
    const generationBefore = { ...previous, modelOptionMemory: useGenerationStore.getState().modelOptionMemory }
    try {
        for (const item of queue || []) resolveRemoteScene(item, settings.model)
        generation.applyPreset(settings)
        generation.setModelMode(settings.modelMode); generation.setQualityTagPreset(settings.qualityTagPreset)
        generation.setTransparentBackground(settings.transparentBackground); generation.setSeed(settings.seed); generation.setSeedLocked(settings.seedLocked)
        generation.setInpaintingPrompt(settings.inpaintingPrompt); generation.setStrength(settings.strength); generation.setNoise(settings.noise)
        for (const item of queue || []) {
            const state = useSceneStore.getState()
            if (!state.getScene(item.presetId, item.sceneId)) state.addScene(item.presetId, item.newScene!.name, item.sceneId)
            if (!useSceneStore.getState().getScene(item.presetId, item.sceneId)) throw new Error('Scene save failed')
            state.updateScenePrompt(item.presetId, item.sceneId, item.scenePrompt)
            state.updateSceneNegativePrompt(item.presetId, item.sceneId, item.sceneNegativePrompt)
            state.updateSceneMultiCharacterSlots(item.presetId, item.sceneId, item.multiCharacterSlots || [])
            if (item.newScene) state.updateSceneSettings(item.presetId, item.sceneId, { width: item.newScene.width, height: item.newScene.height })
            const old = useSceneStore.getState().sceneCharacterAdditions[item.presetId]?.[item.sceneId]
            state.updateSceneCharacterAddition(item.presetId, item.sceneId, { ...old, characterPromptIds: item.characterPromptIds, customCharacters: item.npcs,
                characterReferenceIds: old?.characterReferenceIds || [], vibeReferenceIds: old?.vibeReferenceIds || [] })
        }
    } catch (error) {
        // No awaits inside this commit block: no later user edits can be overwritten by restoration.
        useGenerationStore.setState(generationBefore)
        useSceneStore.setState({ presets: sceneBefore.presets, sceneCharacterAdditions: sceneBefore.sceneCharacterAdditions })
        useCharacterPromptStore.setState({ characters: characterBefore.characters, activeCharacterLimit: characterBefore.activeCharacterLimit })
        await saved.rollback()
        throw error
    }
    return { assets: saved.assets, revision: await remoteRevision(pickRemoteSettings(useGenerationStore.getState())), sceneRevisions: await Promise.all((queue || []).map(async item => ({ presetId: item.presetId, sceneId: item.sceneId, revision: await remoteRevision(remoteSceneDocument(item.presetId, item.sceneId)) }))) }
}
