export interface QueuedScene {
    id: string
    queueCount: number
}

export function findNextQueuedSceneIndex(
    scenes: readonly QueuedScene[],
    cursorSceneId: string | null,
    roundRobin: boolean,
) {
    if (!roundRobin || !cursorSceneId) {
        return scenes.findIndex(scene => scene.queueCount > 0)
    }

    const cursorIndex = scenes.findIndex(scene => scene.id === cursorSceneId)
    if (cursorIndex < 0) {
        return scenes.findIndex(scene => scene.queueCount > 0)
    }

    for (let offset = 1; offset <= scenes.length; offset++) {
        const index = (cursorIndex + offset) % scenes.length
        if (scenes[index].queueCount > 0) return index
    }

    return -1
}

export function buildSceneQueueOrder(scenes: readonly QueuedScene[], roundRobin: boolean) {
    if (!roundRobin) {
        return scenes.flatMap(scene => Array.from({ length: scene.queueCount }, () => scene.id))
    }

    const remaining = scenes.map(scene => Math.max(0, scene.queueCount))
    const order: string[] = []
    let total = remaining.reduce((sum, count) => sum + count, 0)

    while (total > 0) {
        scenes.forEach((scene, index) => {
            if (remaining[index] <= 0) return
            order.push(scene.id)
            remaining[index] -= 1
            total -= 1
        })
    }

    return order
}
