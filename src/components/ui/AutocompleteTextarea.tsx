import { useState, useRef, useEffect, Fragment, KeyboardEvent, useCallback } from 'react'
import { createPortal } from 'react-dom'
import Editor from 'react-simple-code-editor'
import { getCaretCoordinates } from '@/utils/caret-coords'
import { cn } from '@/lib/utils'
import tagsData from '@/assets/tags.json'
import { useFragmentStore } from '@/stores/fragment-store'

// --- Types ---
interface Tag {
    label: string
    value: string
    count: number
    type: string
}

interface SuggestionItem {
    label: string
    value: string
    count?: number
    type: string
    _lower?: string
}

interface AutocompleteTextareaProps {
    value: string
    onChange: (e: { target: { value: string } }) => void
    className?: string
    maxSuggestions?: number
    style?: React.CSSProperties
    placeholder?: string
    disabled?: boolean
    readOnly?: boolean
}

// --- Constants ---
const ALL_TAGS = tagsData as Tag[]

// ?ъ쟾 泥섎━: ?뚮Ц??蹂?섎맂 label 罹먯떛 (理쒖큹 1?뚮쭔)
const TAGS_WITH_LOWER = ALL_TAGS.map(tag => ({
    ...tag,
    _lower: tag.label.toLowerCase()
}))

// 泥?湲?먮퀎 ?몃뜳???앹꽦 (O(1) ?묎렐)
const TAG_INDEX: Record<string, typeof TAGS_WITH_LOWER> = {}
for (const tag of TAGS_WITH_LOWER) {
    const firstChar = tag._lower[0] || '_'
    if (!TAG_INDEX[firstChar]) TAG_INDEX[firstChar] = []
    TAG_INDEX[firstChar].push(tag)
}

// Single source of truth for Typography to ensure Textarea and Pre match perfectly.
const TYPOGRAPHY = {
    fontFamily: '"Inter", "Pretendard Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    lineHeight: '1.5',
    letterSpacing: 'normal',
    fontVariantLigatures: 'none',
    tabSize: 4,
}

export function AutocompleteTextarea({
    value,
    onChange,
    className,
    maxSuggestions = 15,
    style, // mainly used for fontSize
    placeholder,
    ...props
}: AutocompleteTextareaProps) {
    // --- Refs ---
    const textareaRef = useRef<HTMLTextAreaElement | null>(null)
    const containerRef = useRef<HTMLDivElement>(null) // The scrolling container
    const listRef = useRef<HTMLDivElement>(null)

    // onChange ?붾컮?댁뒪瑜??꾪븳 ??대㉧ ref
    const onChangeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    // Fragment Store 援щ룆 (議곌컖 ?꾨＼?꾪듃 紐⑸줉)
    const fragmentFiles = useFragmentStore(state => state.files)

    // --- State ---
    // ?대? state濡?利됱떆 ?뚮뜑留?(uncontrolled 諛⑹떇)
    const [internalValue, setInternalValue] = useState(value)
    const internalValueRef = useRef(value)
    const [suggestions, setSuggestions] = useState<SuggestionItem[]>([])
    const [selectedIndex, setSelectedIndex] = useState(0)
    const [isVisible, setIsVisible] = useState(false)
    const [coords, setCoords] = useState({ top: 0, left: 0 })
    const [suggestionMode, setSuggestionMode] = useState<'tag' | 'wildcard'>('tag')

    // ?몃? value媛 蹂寃쎈릺硫??대? state ?숆린??(?? ?꾨━??濡쒕뱶)
    // ?? ?대?媛믨낵 ?숈씪?섎㈃ ?숆린???ㅽ궢 (而ㅼ꽌 ?먰봽 諛⑹?)
    useEffect(() => {
        internalValueRef.current = internalValue
    }, [internalValue])

    useEffect(() => {
        if (value !== internalValueRef.current) {
            internalValueRef.current = value
            setInternalValue(value)
        }
    }, [value])

    // --- Helpers ---
    const getCurrentWord = (text: string, position: number) => {
        const left = text.slice(0, position)
        // Match backwards to comma, newline, or :: (for V4 weight syntax like 2::tag::)
        const match = left.match(/[^,\n:]*$/)
        return match ? match[0].trimStart() : ''
    }

    // `<` ?댄썑????쇰뱶移대뱶 ?대쫫 異붿텧
    const getWildcardWord = (text: string, position: number): string | null => {
        const left = text.slice(0, position)
        // `<` ?댄썑???띿뒪??李얘린 (?꾩쭅 ?ロ엳吏 ?딆? 寃쎌슦)
        const match = left.match(/<([^<>]*)$/)
        return match ? match[1] : null
    }

    // --- Autocomplete Logic ---
    const checkAutocomplete = useCallback((val: string, el: HTMLTextAreaElement) => {

        const pos = el.selectionEnd || val.length

        // 1. 議곌컖 紐⑤뱶 泥댄겕 (`<` ?댄썑)
        const wildcardWord = getWildcardWord(val, pos)
        if (wildcardWord !== null) {
            // 議곌컖 ?꾨＼?꾪듃 ?먮룞?꾩꽦 (利됱떆, ?붾컮?댁뒪 ?놁쓬)
            const lower = wildcardWord.toLowerCase()
            const matches: SuggestionItem[] = []

            for (const file of fragmentFiles) {
                if (matches.length >= maxSuggestions) break
                const names = file.name.split('||').map(alias => alias.trim()).filter(Boolean)
                for (const name of names) {
                    if (matches.length >= maxSuggestions) break
                    const fullPath = file.folder ? `${file.folder}/${name}` : name
                    const fullPathLower = fullPath.toLowerCase()
                    if (wildcardWord === '' || fullPathLower.includes(lower)) {
                        matches.push({
                            label: fullPath,
                            value: fullPath,
                            count: file.lineCount,
                            type: 'fragment'
                        })
                    }
                }
            }

            if (matches.length > 0) {
                setSuggestions(matches)
                setSuggestionMode('wildcard')
                setSelectedIndex(0)

                const rect = el.getBoundingClientRect()
                const caret = getCaretCoordinates(el, pos)

                setCoords({
                    top: rect.top + window.scrollY + caret.top + 24,
                    left: rect.left + window.scrollX + caret.left
                })
                setIsVisible(true)
            } else {
                setIsVisible(false)
            }
            return
        }

        // 2. ?쇰컲 ?쒓렇 ?먮룞?꾩꽦
        const word = getCurrentWord(val, pos)
        if (word.length < 2) {
            setIsVisible(false)
            return
        }

        // 利됱떆 寃??(?붾컮?댁뒪 ?놁쓬 - 鍮좊Ⅸ 諛섏쓳??
        const lower = word.toLowerCase()
        const firstChar = lower[0] || ''

        // ?몃뜳??湲곕컲 寃??(?대떦 泥?湲???쒓렇留?寃??
        const indexedTags = TAG_INDEX[firstChar] || []
        const matches: SuggestionItem[] = []

        // 1?④퀎: ?몃뜳?ㅻ맂 ?쒓렇?먯꽌 startsWith 留ㅼ묶
        for (const tag of indexedTags) {
            if (matches.length >= maxSuggestions) break
            if (tag._lower.startsWith(lower)) {
                matches.push(tag)
            }
        }

        // 2?④퀎: 遺議깊븯硫??꾩껜?먯꽌 includes 寃??(?먮━吏留?fallback)
        if (matches.length < maxSuggestions) {
            for (const tag of TAGS_WITH_LOWER) {
                if (matches.length >= maxSuggestions) break
                if (!tag._lower.startsWith(lower) && tag._lower.includes(lower)) {
                    matches.push(tag)
                }
            }
        }

        if (matches.length > 0) {
            setSuggestions(matches)
            setSuggestionMode('tag')
            setSelectedIndex(0)

            const rect = el.getBoundingClientRect()
            const caret = getCaretCoordinates(el, pos)

            setCoords({
                top: rect.top + window.scrollY + caret.top + 24,
                left: rect.left + window.scrollX + caret.left
            })
            setIsVisible(true)
        } else {
            setIsVisible(false)
        }
    }, [maxSuggestions, fragmentFiles])

    const insertSuggestion = (suggestion: SuggestionItem) => {
        if (!textareaRef.current) return
        const el = textareaRef.current
        const val = internalValue  // Use internal value for immediate update
        const pos = el.selectionEnd || 0

        if (suggestionMode === 'wildcard') {
            // ??쇰뱶移대뱶 ?쎌엯: <name> ?뺥깭濡?
            const wildcardWord = getWildcardWord(val, pos)
            if (wildcardWord === null) return

            // `<` ?꾩튂 李얘린
            const left = val.slice(0, pos)
            const bracketPos = left.lastIndexOf('<')
            if (bracketPos === -1) return

            const before = val.slice(0, bracketPos)
            const after = val.slice(pos)

            // <name> ?뺥깭濡??쎌엯 (?ル뒗 愿꾪샇 ?ы븿)
            const newValue = before + '<' + suggestion.value + '>' + after
            const newCursorPos = bracketPos + suggestion.value.length + 2 // <name>

            // Update internal state immediately (no flicker)
            internalValueRef.current = newValue
            setInternalValue(newValue)
            setIsVisible(false)

            // Set cursor position immediately
            requestAnimationFrame(() => {
                if (textareaRef.current) {
                    textareaRef.current.setSelectionRange(newCursorPos, newCursorPos)
                    textareaRef.current.focus()
                }
            })

            // Debounce external onChange to avoid re-render resetting cursor
            if (onChangeTimerRef.current) clearTimeout(onChangeTimerRef.current)
            onChangeTimerRef.current = setTimeout(() => {
                onChange({ target: { value: newValue } })
            }, 50)
        } else {
            // ?쇰컲 ?쒓렇 ?쎌엯 (:: 臾몃쾿 吏??
            const left = val.slice(0, pos)
            const wordMatch = left.match(/[^,\n:]*$/)
            if (!wordMatch) return

            const wordStart = wordMatch.index!
            const before = val.slice(0, wordStart)
            const after = val.slice(pos)

            // Add space only if not at start and not after special chars
            const lastChar = before.slice(-1)
            const needsSpace = before.length > 0 && ![' ', '\n', ':'].includes(lastChar)
            const prefix = needsSpace ? ' ' : ''

            // Always use ", " as suffix (user will close :: manually if needed)
            const suffix = ', '

            // Keep after as-is to preserve newlines and formatting
            const newValue = before + prefix + suggestion.value + suffix + after

            // Calculate new cursor position
            const newCursorPos = wordStart + prefix.length + suggestion.value.length + suffix.length

            // Update internal state immediately (no flicker)
            internalValueRef.current = newValue
            setInternalValue(newValue)
            setIsVisible(false)

            // Set cursor position immediately
            requestAnimationFrame(() => {
                if (textareaRef.current) {
                    textareaRef.current.setSelectionRange(newCursorPos, newCursorPos)
                    textareaRef.current.focus()
                    scrollToCaret()
                }
            })

            // Debounce external onChange to avoid re-render resetting cursor
            if (onChangeTimerRef.current) clearTimeout(onChangeTimerRef.current)
            onChangeTimerRef.current = setTimeout(() => {
                onChange({ target: { value: newValue } })
            }, 50)
        }
    }

    // --- Scroll Sync Logic ---
    // Manually scrolls the container to keep the caret in view during typing/navigation
    const scrollToCaret = () => {
        if (!textareaRef.current || !containerRef.current) return
        const el = textareaRef.current
        const container = containerRef.current

        requestAnimationFrame(() => {
            const { top, height } = getCaretCoordinates(el, el.selectionEnd)
            // Padding offset (must match Editor padding prop)
            const PADDING_OFFSET = 12
            const caretTop = top + PADDING_OFFSET
            const caretBottom = caretTop + height + 4 // Small buffer

            const containerTop = container.scrollTop
            const containerBottom = containerTop + container.clientHeight

            // Scroll if out of bounds
            if (caretBottom > containerBottom) {
                container.scrollTop = caretBottom - container.clientHeight
            } else if (caretTop < containerTop) {
                container.scrollTop = caretTop
            }
        })
    }

    // --- Event Handlers ---
    const handleValueChange = (code: string) => {
        // ?대? state 利됱떆 ?낅뜲?댄듃 (UI 諛섏쓳??
        internalValueRef.current = code
        setInternalValue(code)

        // onChange瑜?100ms ?붾컮?댁뒪 (Zustand ?낅뜲?댄듃 吏?곗쑝濡???諛⑹?)
        if (onChangeTimerRef.current) {
            clearTimeout(onChangeTimerRef.current)
        }
        onChangeTimerRef.current = setTimeout(() => {
            onChange({ target: { value: code } })
        }, 100)

        if (textareaRef.current) {
            checkAutocomplete(code, textareaRef.current)
            scrollToCaret()
        }
    }

    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement | HTMLDivElement>) => {
        // Ensure ref is captured
        if (e.target instanceof HTMLTextAreaElement) {
            textareaRef.current = e.target
        }

        if (isVisible) {
            if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSelectedIndex(prev => (prev + 1) % suggestions.length)
                return
            } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSelectedIndex(prev => (prev - 1 + suggestions.length) % suggestions.length)
                return
            } else if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault()
                e.stopPropagation() // Prevent default newline
                if (suggestions[selectedIndex]) {
                    insertSuggestion(suggestions[selectedIndex])
                }
                return
            } else if (e.key === 'Escape') {
                setIsVisible(false)
                return
            }
        }
    }

    // --- Effects ---
    // ??대㉧ ?뺣━ (而댄룷?뚰듃 ?몃쭏?댄듃 ??
    useEffect(() => {
        return () => {
            if (onChangeTimerRef.current) clearTimeout(onChangeTimerRef.current)
        }
    }, [])

    // Scroll active suggestion into view
    useEffect(() => {
        if (!isVisible || !listRef.current) return
        const list = listRef.current
        const item = list.children[0]?.children[selectedIndex] as HTMLElement
        if (item) {
            const itemTop = item.offsetTop
            const itemBottom = itemTop + item.offsetHeight
            const listTop = list.scrollTop
            const listBottom = listTop + list.clientHeight
            if (itemTop < listTop) list.scrollTop = itemTop
            else if (itemBottom > listBottom) list.scrollTop = itemBottom - list.clientHeight
        }
    }, [selectedIndex, isVisible])

    // Close on outside events
    useEffect(() => {
        const handleWindowEvents = (e: Event) => {
            if (isVisible && listRef.current && !listRef.current.contains(e.target as Node)) {
                setIsVisible(false)
            }
        }
        if (isVisible) {
            window.addEventListener('scroll', handleWindowEvents, true)
            window.addEventListener('resize', handleWindowEvents)
            window.addEventListener('click', handleWindowEvents)
        }
        return () => {
            window.removeEventListener('scroll', handleWindowEvents, true)
            window.removeEventListener('resize', handleWindowEvents)
            window.removeEventListener('click', handleWindowEvents)
        }
    }, [isVisible])

    // --- Highlighting ---
    const renderHighlights = (text: string) => {
        if (!text) return null

        // 癒쇱? 以??⑥쐞濡?遺꾨━?섏뿬 二쇱꽍 泥섎━
        const lines = text.split('\n')

        return (
            <Fragment>
                {lines.map((line, lineIndex) => {
                    const isComment = line.trimStart().startsWith('#')
                    const isLastLine = lineIndex === lines.length - 1

                    // 二쇱꽍 以꾩씤 寃쎌슦 ?꾩껜瑜??뚯깋 諛곌꼍?쇰줈
                    if (isComment) {
                        return (
                            <Fragment key={lineIndex}>
                                <span className="bg-muted-foreground/20 text-muted-foreground rounded-[2px]">{line}</span>
                                {!isLastLine && '\n'}
                            </Fragment>
                        )
                    }

                    // ?쇰컲 以? 湲곗〈 援щЦ ?섏씠?쇱씠???곸슜
                    // Syntax regex: 
                    // 1. Weights: 1.2::tag:: OR -0.5::tag::
                    // 2. Fragments: <fragment>
                    const regex = /(-?[\d.]+::.*?::)|(<[^>]+>)/g
                    const parts = line.split(regex)

                    return (
                        <Fragment key={lineIndex}>
                            {parts.map((part, i) => {
                                if (part === undefined) return null
                                let styleClass = ""
                                if (/^-?[\d.]+::.*::$/.test(part)) {
                                    styleClass = part.startsWith('-')
                                        ? "bg-sky-500/30 rounded-[2px]"
                                        : "bg-pink-500/30 rounded-[2px]"
                                } else if (/^<[^>]+>$/.test(part)) {
                                    styleClass = "bg-green-500/30 rounded-[2px]"
                                }
                                return <span key={i} className={styleClass}>{part}</span>
                            })}
                            {!isLastLine && '\n'}
                        </Fragment>
                    )
                })}
            </Fragment>
        )
    }

    // --- Styles ---
    // Force sync styles for both Pre (generated by Editor) and Textarea


    return (
        <div
            className={cn(
                "prompt-editor-wrapper relative w-full min-w-0 max-w-full h-full flex flex-col border rounded-md border-input bg-transparent overflow-hidden group focus-within:ring-1 focus-within:ring-ring",
                className
            )}
        >
            <style>{`
                .prompt-editor-wrapper pre,
                .prompt-editor-wrapper textarea {
                    font-family: "Inter", "Pretendard Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
                    line-height: 1.5 !important;
                    font-size: inherit !important;
                    letter-spacing: normal !important;
                    font-variant-ligatures: none !important;
                    tab-size: 4 !important;
                    white-space: pre-wrap !important;
                    overflow-wrap: anywhere !important;
                    word-break: break-word !important;
                    box-sizing: border-box !important;
                }
                .prompt-editor-wrapper textarea {
                    overflow: hidden !important;
                    height: 100% !important; /* Prevent internal scroll by matching container height */
                }
            `}</style>

            {/* Scrollable Container */}
            <div
                ref={containerRef}
                className="flex-1 min-w-0 w-full max-w-full relative overflow-y-auto"
                style={{ scrollBehavior: 'smooth' }} // Optional smooth scroll
            >
                <Editor
                    value={internalValue}
                    onValueChange={handleValueChange}
                    highlight={renderHighlights}
                    padding={12}
                    textareaId="prompt-editor"

                    // Core Editor Style
                    style={{
                        ...TYPOGRAPHY,
                        fontSize: style?.fontSize || 'inherit',
                        minHeight: '100%',
                        height: 'auto',
                        overflow: 'visible',
                    }}

                    // Wrapper Class
                    className="min-h-full min-w-0 w-full max-w-full"

                    // Textarea Class
                    // Styles are now handled by global CSS injection above
                    textareaClassName="focus:outline-none bg-transparent min-h-full min-w-0 resize-none"

                    // Event wiring
                    onFocus={(e) => textareaRef.current = e.target as HTMLTextAreaElement}
                    onClick={(e) => {
                        textareaRef.current = e.target as HTMLTextAreaElement
                        scrollToCaret()
                    }}
                    onKeyUp={scrollToCaret} // Handle arrow keys
                    onKeyDown={handleKeyDown}

                    placeholder={placeholder}
                    readOnly={props.readOnly}
                    disabled={props.disabled}
                    {...props}
                />
            </div>

            {/* Autocomplete Dropdown */}
            {isVisible && suggestions.length > 0 && createPortal(
                <div
                    ref={listRef}
                    className="fixed z-[9999] w-64 bg-popover/95 backdrop-blur-md text-popover-foreground rounded-lg border border-border shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-100"
                    style={{
                        top: coords.top,
                        left: coords.left,
                        maxHeight: '300px',
                        overflowY: 'auto'
                    }}
                >
                    <div className="p-1">
                        {suggestions.map((item, index) => (
                            <div
                                key={item.value + index}
                                className={cn(
                                    "flex items-center justify-between px-3 py-2 text-sm rounded-md cursor-pointer select-none transition-colors",
                                    index === selectedIndex ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                                )}
                                onMouseDown={(e) => {
                                    e.preventDefault()
                                    insertSuggestion(item)
                                }}
                            >
                                <div className="flex flex-col overflow-hidden">
                                    <span className="truncate font-semibold">
                                        {item.type === 'fragment' ? `<${item.label}>` : item.label}
                                    </span>
                                    <div className="flex items-center gap-2 text-[10px] opacity-80">
                                        <span className={cn(
                                            "uppercase tracking-wider font-bold",
                                            item.type === 'fragment' ? "text-green-300" :
                                                item.type === 'artist' ? "text-yellow-300" :
                                                    item.type === 'character' ? "text-green-300" :
                                                        item.type === 'copyright' ? "text-fuchsia-300" :
                                                            "text-blue-300"
                                        )}>
                                            {item.type}
                                        </span>
                                        <span>
                                            {item.type === 'fragment'
                                                ? `${item.count} lines`
                                                : (item.count ?? 0) >= 1000 ? ((item.count ?? 0) / 1000).toFixed(1) + 'k' : item.count}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>,
                document.body
            )}
        </div>
    )
}

