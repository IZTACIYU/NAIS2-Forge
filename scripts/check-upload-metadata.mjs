import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'

// Run with the installed Playwright module path as the first argument. No user files or network requests.
const require = createRequire(import.meta.url)
const { chromium } = require(process.argv[2] || 'playwright')
const compile = (path, module) => ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module },
}).outputText
const stripper = compile('src/lib/exif-stripper.ts', ts.ModuleKind.ESNext)
    .replace("import i18next from 'i18next';", '')
    .replaceAll('export ', '')
    .replace("await import('pako')", 'globalThis.pako')
    + '\nObject.assign(globalThis, {stripImageMetadata,reencodeImage,assertImageMetadataRemoved,ImageMetadataVerificationError});'
const actions = compile('src/lib/exif-actions.ts', ts.ModuleKind.CommonJS)
const handlers = ['src/components/scene/SceneR2DirectUploadDialog.tsx', 'src/pages/CloudR2.tsx'].map(path => {
    const file = ts.createSourceFile(path, compile(path, ts.ModuleKind.ESNext), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    let body
    const visit = node => {
        if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'handleUpload') body = node.initializer.body.getText(file).slice(1, -1)
        ts.forEachChild(node, visit)
    }
    visit(file)
    assert.ok(body, `Upload handler missing in ${path}`)
    return body
})
const resources = Object.fromEntries(['ko', 'en', 'ja'].map(language => [language, {
    translation: JSON.parse(readFileSync(`src/i18n/locales/${language}.json`, 'utf8')),
}]))
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
    const page = await browser.newPage()
    await page.route('**/*', route => route.abort())
    await page.addScriptTag({ content: readFileSync('node_modules/pako/dist/pako.min.js', 'utf8') })
    await page.addScriptTag({ content: readFileSync('node_modules/i18next/dist/umd/i18next.js', 'utf8') })
    await page.evaluate(resources => i18next.init({ lng: 'en', resources }), resources)
    await page.addScriptTag({ content: stripper })
    await page.addScriptTag({ content: `(() => {
        const exports = {};
        const require = name => name === '@/lib/exif-stripper' ? globalThis : {};
        ${actions}
        globalThis.imageActions = exports;
    })();` })
    const report = await page.evaluate(async ({ handlers }) => {
        const check = (condition, message) => { if (!condition) throw new Error(message) }
        const concat = (...parts) => {
            const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0))
            let offset = 0
            for (const part of parts) { result.set(part, offset); offset += part.length }
            return result
        }
        const chunk = (type, data) => {
            const result = new Uint8Array(12 + data.length)
            new DataView(result.buffer).setUint32(0, data.length)
            result.set(new TextEncoder().encode(type), 4)
            result.set(data, 8)
            let crc = 0xffffffff
            for (const byte of result.subarray(4, result.length - 4)) {
                crc ^= byte
                for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1)
            }
            new DataView(result.buffer).setUint32(result.length - 4, (crc ^ 0xffffffff) >>> 0)
            return result
        }
        const url = blob => new Promise((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result)
            reader.onerror = reject
            reader.readAsDataURL(blob)
        })
        const addMetadata = async (blob, pngType = 'tEXt', jpegMarker = 0xe1, webpType = 'EXIF') => {
            const bytes = new Uint8Array(await blob.arrayBuffer())
            const data = new TextEncoder().encode('Comment\0synthetic secret metadata')
            let result
            if (blob.type === 'image/png') result = concat(bytes.subarray(0, 33), chunk(pngType, data), bytes.subarray(33))
            if (blob.type === 'image/jpeg') result = concat(bytes.subarray(0, 2), new Uint8Array([255, jpegMarker, 0, data.length + 2]), data, bytes.subarray(2))
            if (blob.type === 'image/webp') {
                const extra = new Uint8Array(8 + data.length + (data.length & 1))
                extra.set(new TextEncoder().encode(webpType))
                new DataView(extra.buffer).setUint32(4, data.length, true)
                extra.set(data, 8)
                result = concat(bytes, extra)
                new DataView(result.buffer).setUint32(4, result.length - 8, true)
            }
            return new Blob([result], { type: blob.type })
        }
        const reject = async (action, label) => {
            try { await action() } catch (error) {
                check(error instanceof ImageMetadataVerificationError, `${label}: wrong failure ${error}`)
                return
            }
            throw new Error(`${label}: unsafe image accepted`)
        }
        const canvas = document.createElement('canvas')
        canvas.width = 64; canvas.height = 64
        const context = canvas.getContext('2d')
        const bits = bytes => [...bytes].flatMap(byte => byte.toString(2).padStart(8, '0').split('').map(Number))
        const text = new TextEncoder().encode(JSON.stringify({ Comment: JSON.stringify({ prompt: 'synthetic secret prompt', steps: 28 }) }))
        const sources = []
        for (const compressed of [false, true]) {
            const pixels = context.createImageData(64, 64)
            for (let index = 0; index < 4096; index++) pixels.data.set([120, 80, 200, 255], index * 4)
            const payload = compressed ? pako.gzip(text) : text
            const signature = compressed ? 'stealth_pngcomp' : 'stealth_pnginfo'
            const stream = [...bits(new TextEncoder().encode(signature)), ...bits(new Uint8Array([
                (payload.length * 8) >>> 24, (payload.length * 8) >>> 16, (payload.length * 8) >>> 8, payload.length * 8,
            ])), ...bits(payload)]
            stream.forEach((bit, index) => {
                const x = Math.floor(index / 64), y = index % 64
                pixels.data[(y * 64 + x) * 4 + 3] = 254 | bit
            })
            context.putImageData(pixels, 0, 0)
            const png = canvas.toDataURL('image/png')
            for (const format of ['png', 'jpeg', 'webp']) {
                const image = await reencodeImage(png, format, 0.85)
                const dirty = await addMetadata(image.blob)
                await reject(() => assertImageMetadataRemoved(dirty), `${format} standard metadata`)
                sources.push({ format, compressed, source: await url(dirty), dirty })
                if (format !== 'jpeg') await reject(() => assertImageMetadataRemoved(image.blob), `${format} stealth only`)
            }
        }
        let matrix = 0
        for (const { format: input, compressed, source } of sources) {
            for (const output of ['png', 'jpeg', 'webp']) {
                const result = await imageActions.prepareImageForR2Upload(source, output, 85, true)
                check(result.contentType === `image/${output}`, `${input}->${output}: MIME`)
                const bytes = Uint8Array.from(atob(result.contentBase64), character => character.charCodeAt(0))
                await assertImageMetadataRemoved(new Blob([bytes], { type: result.contentType }))
                matrix++
            }
            if (input === 'png') {
                const retained = await imageActions.prepareImageForR2Upload(source, 'png', 85, false)
                check(retained.contentBase64 === source.split(',')[1], 'PNG removal OFF must preserve original bytes')
            }
            if (input !== 'jpeg') {
                const retained = await imageActions.prepareImageForR2Upload(source, 'webp', 85, false)
                const blob = new Blob([Uint8Array.from(atob(retained.contentBase64), character => character.charCodeAt(0))], { type: retained.contentType })
                await reject(() => assertImageMetadataRemoved(blob), `OFF must not silently clear stealth (${input}/${compressed})`)
            }
        }
        const clean = {}
        for (const format of ['png', 'jpeg', 'webp']) clean[format] = await stripImageMetadata(sources[0].source, format, 0.85, format !== 'png')
        for (const format of ['png', 'jpeg', 'webp']) {
            const sameFormat = await stripImageMetadata(await url(await addMetadata(clean[format].blob)), format, 0.85)
            await assertImageMetadataRemoved(sameFormat.blob)
        }
        // A JPEG marker after the entropy-coded scan must not escape the final byte inspection.
        const jpegBytes = new Uint8Array(await clean.jpeg.blob.arrayBuffer())
        await reject(() => assertImageMetadataRemoved(new Blob([
            concat(jpegBytes.slice(0, -2), new Uint8Array([255, 225, 0, 4, 1, 2]), jpegBytes.slice(-2)),
        ], { type: 'image/jpeg' })), 'JPEG late APP1')
        for (const [width, height] of [[512, 2], [2, 512]]) {
            const narrow = document.createElement('canvas')
            narrow.width = width; narrow.height = height
            const ctx = narrow.getContext('2d'), pixels = ctx.createImageData(width, height)
            for (let index = 0; index < width * height; index++) pixels.data.set([120, 80, 200, 255], index * 4)
            const stream = [...bits(new TextEncoder().encode('stealth_pnginfo')), ...bits(new Uint8Array([
                (text.length * 8) >>> 24, (text.length * 8) >>> 16, (text.length * 8) >>> 8, text.length * 8,
            ])), ...bits(text)]
            stream.forEach((bit, index) => {
                const x = Math.floor(index / height), y = index % height
                pixels.data[(y * width + x) * 4 + 3] = 254 | bit
            })
            ctx.putImageData(pixels, 0, 0)
            const source = narrow.toDataURL('image/png')
            const dirty = await reencodeImage(source, 'webp', 0.85)
            await reject(() => assertImageMetadataRemoved(dirty.blob), `${width}x${height} stealth crop`)
            for (const format of ['png', 'jpeg', 'webp']) await imageActions.prepareImageForR2Upload(source, format, 85, true)
            narrow.width = narrow.height = 0
        }
        for (const type of ['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']) await reject(async () => assertImageMetadataRemoved(await addMetadata(clean.png.blob, type)), `PNG ${type}`)
        for (const marker of [0xe1, 0xed, 0xfe]) await reject(async () => assertImageMetadataRemoved(await addMetadata(clean.jpeg.blob, 'tEXt', marker)), `JPEG ${marker}`)
        for (const type of ['EXIF', 'XMP ']) await reject(async () => assertImageMetadataRemoved(await addMetadata(clean.webp.blob, 'tEXt', 0xe1, type)), `WebP ${type}`)
        for (const format of ['png', 'jpeg', 'webp']) {
            const bytes = new Uint8Array(await clean[format].blob.arrayBuffer())
            await reject(() => assertImageMetadataRemoved(new Blob([bytes.slice(0, -3)], { type: clean[format].mimeType })), `${format} truncated`)
            await reject(() => assertImageMetadataRemoved(new Blob([bytes], { type: 'image/gif' })), `${format} wrong MIME`)
        }
        // A recognizable header with a broken length/JSON is still metadata, not a successful null parse.
        const invalidPixels = context.createImageData(64, 64)
        for (let index = 0; index < 4096; index++) invalidPixels.data.set([120, 80, 200, 255], index * 4)
        const invalidBits = [...bits(new TextEncoder().encode('stealth_pngcomp')), ...Array(32).fill(1)]
        invalidBits.forEach((bit, index) => {
            const x = Math.floor(index / 64), y = index % 64
            invalidPixels.data[(y * 64 + x) * 4 + 3] = 254 | bit
        })
        context.putImageData(invalidPixels, 0, 0)
        const invalidSource = canvas.toDataURL('image/png')
        for (const format of ['png', 'webp']) await reject(() => imageActions.prepareImageForR2Upload(invalidSource, format, 85, true), `${format} corrupt stealth length`)
        for (let index = 0; index < 4096; index++) invalidPixels.data.set([120, 80, 200, 255], index * 4)
        bits(new TextEncoder().encode('stealth_rgbinfo')).forEach((bit, index) => {
            const pixel = Math.floor(index / 3), x = Math.floor(pixel / 64), y = pixel % 64
            invalidPixels.data[(y * 64 + x) * 4 + (index % 3)] = 120 | bit
        })
        context.putImageData(invalidPixels, 0, 0)
        const unsupported = await reencodeImage(canvas.toDataURL('image/png'), 'png')
        await reject(() => assertImageMetadataRemoved(unsupported.blob), 'RGB stealth header')
        const originalDecode = globalThis.createImageBitmap
        try {
            globalThis.createImageBitmap = async () => { throw new Error('Forced decode failure') }
            await reject(() => assertImageMetadataRemoved(clean.png.blob), 'Decode failure')
        } finally { globalThis.createImageBitmap = originalDecode }

        // Execute the actual UI handler bodies with mocked transport. Corrupt only the final encoder result.
        const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
        const originalEncode = HTMLCanvasElement.prototype.toBlob
        let batches = 0
        try {
            for (const format of ['png', 'jpeg', 'webp']) {
                for (const [handlerIndex, body] of handlers.entries()) {
                    for (const failAt of [1, 2]) {
                        let encodes = 0, uploads = 0, successes = 0, failures = 0
                        const input = sources.find(item => item.format === (format === 'png' ? 'jpeg' : 'png'))
                        const dirty = sources.find(item => item.format === format).dirty
                        HTMLCanvasElement.prototype.toBlob = function (callback, mime, quality) {
                            if (++encodes === failAt) callback(dirty)
                            else originalEncode.call(this, callback, mime, quality)
                        }
                        const extension = format === 'jpeg' ? 'jpg' : format
                        const noop = () => {}
                        const environment = {
                            ready: true, hasEmptyName: false, candidates: [1, 2, 3].map(index => ({ image: { url: input.source }, index })),
                            pendingFiles: [1, 2, 3].map(index => ({ name: `${index}.jpg`, type: 'image/jpeg' })),
                            config: {}, prefix: '', format, quality: 85, uploadFormat: format, uploadQuality: 85,
                            expertR2ExifRemovalEnabled: true, uploadFileNames: [1, 2, 3].map(index => `${index}.${extension}`),
                            setUploading: noop, setProgress: noop, setLoading: noop, setPendingFiles: noop,
                            listR2Objects: async () => ({ files: [] }), readImageDataUrl: async () => input.source,
                            fileToDataUrl: async () => input.source, fileToBase64: () => { throw new Error('Image bypassed processing') },
                            imageExtensions: ['.png', '.jpg', '.jpeg', '.webp'],
                            prepareImageForR2Upload: imageActions.prepareImageForR2Upload,
                            replaceImageExtension: imageActions.replaceImageExtension,
                            uploadR2Object: async () => { uploads++ }, listCache: { clear: noop }, refresh: noop, handleOpenChange: noop,
                            t: key => key, toast: toast => { if (toast.variant === 'success') successes++; else failures++ },
                        }
                        await new AsyncFunction('environment', `with (environment) { ${body} }`)(environment)
                        check(uploads === failAt - 1 && successes === 0 && failures === 1 && encodes === failAt,
                            `${format}/handler ${handlerIndex}/failure ${failAt}: batch did not stop (${uploads},${encodes})`)
                        batches++
                    }
                }
            }
        } finally { HTMLCanvasElement.prototype.toBlob = originalEncode }
        for (const language of ['ko', 'en', 'ja']) {
            await i18next.changeLanguage(language)
            const error = new ImageMetadataVerificationError('test')
            check(error.message === i18next.t('exif.verificationFailed') && error.message !== 'exif.verificationFailed', `${language} missing message`)
        }
        canvas.width = canvas.height = 0
        return { matrix, batches }
    }, { handlers })
    assert.equal(report.matrix, 18)
    assert.equal(report.batches, 12)
    console.log('Upload metadata checks passed: 18 real PNG/JPEG/WebP conversions; same-format and tall/wide cases; text/EXIF/XMP/IPTC/comment/stealth detection; malformed/decode failure brakes; 12 actual direct/file upload batch stop scenarios; OFF preservation; 3 languages. No cloud writes.')
} finally {
    await browser.close()
}
