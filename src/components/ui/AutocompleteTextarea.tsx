import { useState, useRef, useEffect, Fragment, KeyboardEvent, useCallback } from 'react'
import { createPortal } from 'react-dom'
import Editor from 'react-simple-code-editor'
import { getCaretCoordinates } from '@/utils/caret-coords'
import { appendBoundedHistory, cn, describeTextEdit, groupTextEdit, type TextEditGroup } from '@/lib/utils'
import { searchTags } from '@/lib/tag-search-client'
import { useFragmentStore } from '@/stores/fragment-store'
import { isPromptCommentLine } from '@/lib/prompt-comments'
import { formatWeightedPrompt } from '@/lib/prompt-formatting'

// --- Types ---
interface SuggestionItem {
    label: string
    value: string
    count?: number
    type: string
    _lower?: string
}

const DIRECTIVE_SUGGESTIONS: SuggestionItem[] = [
    { label: '# comment', value: '# ', type: 'directive' },
    { label: '#if base:', value: '#if base:', type: 'directive' },
    { label: '#if-condition:', value: '#if-condition:', type: 'directive' },
    { label: '#if+condition:', value: '#if+condition:', type: 'directive' },
    { label: '#if b:', value: '#if b:', type: 'directive' },
    { label: '#if g:', value: '#if g:', type: 'directive' },
    { label: '#if o:', value: '#if o:', type: 'directive' },
    { label: '#if mb:', value: '#if mb:', type: 'directive' },
    { label: '#if mg:', value: '#if mg:', type: 'directive' },
    { label: '#if mo:', value: '#if mo:', type: 'directive' },
    { label: '#source', value: '#source', type: 'directive' },
    { label: '#target', value: '#target', type: 'directive' },
]

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

// Single source of truth for Typography to ensure Textarea and Pre match perfectly.
const TYPOGRAPHY = {
    fontFamily: '"Inter", "Pretendard Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    lineHeight: '1.5',
    letterSpacing: 'normal',
    fontVariantLigatures: 'none',
    fontKerning: 'none' as const,
    tabSize: 4,
}

interface TextHistoryRecord {
    value: string
    selectionStart: number
    selectionEnd: number
}

const TEXT_HISTORY_LIMIT = 100

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

    // react-simple-code-editor keeps the textarea above the highlighted <pre>.
    // Move any browser-initiated textarea scroll to the shared outer container so
    // both layers always use the same scroll origin for caret hit testing.
    const syncTextareaScroll = useCallback(() => {
        const textarea = textareaRef.current
        const container = containerRef.current
        if (!textarea || !container) return

        const offsetTop = textarea.scrollTop
        const offsetLeft = textarea.scrollLeft
        if (offsetTop === 0 && offsetLeft === 0) return

        textarea.scrollTop = 0
        textarea.scrollLeft = 0
        if (offsetTop !== 0) {
            const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight)
            container.scrollTop = Math.min(maxScrollTop, Math.max(0, container.scrollTop + offsetTop))
        }
    }, [])

    // onChange ?붾컮?댁뒪瑜??꾪븳 ??대㉧ ref
    const onChangeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const pendingLocalValueRef = useRef<string | null>(null)
    const onChangeRef = useRef(onChange)
    const autocompleteRequestRef = useRef(0)
    onChangeRef.current = onChange

    // Fragment Store 援щ룆 (議곌컖 ?꾨＼?꾪듃 紐⑸줉)
    const fragmentFiles = useFragmentStore(state => state.files)

    // --- State ---
    // ?대? state濡?利됱떆 ?뚮뜑留?(uncontrolled 諛⑹떇)
    const [internalValue, setInternalValue] = useState(value)
    const internalValueRef = useRef(value)
    const textHistoryRef = useRef<{ stack: TextHistoryRecord[]; offset: number }>({
        stack: [{ value, selectionStart: 0, selectionEnd: 0 }],
        offset: 0,
    })
    const lastTextEditRef = useRef<TextEditGroup | null>(null)
    const isComposingRef = useRef(false)
    const compositionCommitPendingRef = useRef(false)
    const compositionCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const selectionRestorePendingRef = useRef(false)
    const [suggestions, setSuggestions] = useState<SuggestionItem[]>([])
    const [selectedIndex, setSelectedIndex] = useState(0)
    const [isVisible, setIsVisible] = useState(false)
    const [coords, setCoords] = useState({ top: 0, left: 0 })
    const [suggestionMode, setSuggestionMode] = useState<'tag' | 'wildcard' | 'directive'>('tag')

    const updateCurrentHistorySelection = useCallback(() => {
        if (selectionRestorePendingRef.current) return
        const editor = textareaRef.current
        const history = textHistoryRef.current
        const current = history.stack[history.offset]
        if (!editor || !current) return
        history.stack[history.offset] = {
            ...current,
            selectionStart: editor.selectionStart,
            selectionEnd: editor.selectionEnd,
        }
    }, [])

    const resetTextHistory = useCallback((nextValue: string) => {
        if (compositionCommitTimerRef.current) {
            clearTimeout(compositionCommitTimerRef.current)
            compositionCommitTimerRef.current = null
        }
        isComposingRef.current = false
        compositionCommitPendingRef.current = false
        selectionRestorePendingRef.current = false
        const caret = Math.min(textareaRef.current?.selectionStart ?? nextValue.length, nextValue.length)
        textHistoryRef.current = {
            stack: [{ value: nextValue, selectionStart: caret, selectionEnd: caret }],
            offset: 0,
        }
        lastTextEditRef.current = null
    }, [])

    // ?몃? value媛 蹂寃쎈릺硫??대? state ?숆린??(?? ?꾨━??濡쒕뱶)
    // ?? ?대?媛믨낵 ?숈씪?섎㈃ ?숆린???ㅽ궢 (而ㅼ꽌 ?먰봽 諛⑹?)
    useEffect(() => {
        if (value === internalValueRef.current) {
            pendingLocalValueRef.current = null
            return
        }

        // A parent update can arrive after a newer local keystroke. Keep the
        // editor authoritative until that local value has been acknowledged.
        if (pendingLocalValueRef.current !== null) return

        internalValueRef.current = value
        setInternalValue(value)
        resetTextHistory(value)
    }, [resetTextHistory, value])

    useEffect(() => {
        const textarea = containerRef.current?.querySelector<HTMLTextAreaElement>('textarea')
        if (!textarea) return

        textareaRef.current = textarea
        textarea.addEventListener('scroll', syncTextareaScroll, { passive: true })
        return () => textarea.removeEventListener('scroll', syncTextareaScroll)
    }, [syncTextareaScroll])

    const scheduleValueChange = useCallback((nextValue: string, delay: number) => {
        pendingLocalValueRef.current = nextValue
        if (onChangeTimerRef.current) clearTimeout(onChangeTimerRef.current)
        onChangeTimerRef.current = setTimeout(() => {
            onChangeTimerRef.current = null
            onChangeRef.current({ target: { value: nextValue } })
        }, delay)
    }, [])

    const flushPendingValue = useCallback(() => {
        if (!onChangeTimerRef.current) return
        clearTimeout(onChangeTimerRef.current)
        onChangeTimerRef.current = null
        const pendingValue = pendingLocalValueRef.current
        if (pendingValue !== null) {
            onChangeRef.current({ target: { value: pendingValue } })
        }
    }, [])

    const recordTextHistory = useCallback((record: TextHistoryRecord, merge: boolean) => {
        const history = textHistoryRef.current
        const current = history.stack[history.offset]
        if (current?.value === record.value) {
            history.stack[history.offset] = record
            return
        }

        if (merge && history.offset > 0) {
            const applied = history.stack.slice(0, history.offset + 1)
            applied[applied.length - 1] = record
            history.stack = applied
            history.offset = applied.length - 1
            return
        }

        const nextStack = appendBoundedHistory(
            history.stack,
            history.offset + 1,
            record,
            TEXT_HISTORY_LIMIT,
        )
        history.stack = nextStack
        history.offset = nextStack.length - 1
    }, [])

    const applyTextHistoryOffset = useCallback((nextOffset: number) => {
        const history = textHistoryRef.current
        if (nextOffset < 0 || nextOffset >= history.stack.length || nextOffset === history.offset) return

        updateCurrentHistorySelection()
        history.offset = nextOffset
        const record = history.stack[nextOffset]

        if (onChangeTimerRef.current) {
            clearTimeout(onChangeTimerRef.current)
            onChangeTimerRef.current = null
        }
        pendingLocalValueRef.current = record.value
        internalValueRef.current = record.value
        lastTextEditRef.current = null
        selectionRestorePendingRef.current = true
        autocompleteRequestRef.current++
        setInternalValue(record.value)
        setIsVisible(false)
        onChangeRef.current({ target: { value: record.value } })

        requestAnimationFrame(() => {
            const editor = textareaRef.current
            if (editor) {
                editor.setSelectionRange(record.selectionStart, record.selectionEnd)
                editor.focus()
            }
            selectionRestorePendingRef.current = false
        })
    }, [updateCurrentHistorySelection])

    const commitProgrammaticText = useCallback((nextValue: string, caret: number, delay: number) => {
        updateCurrentHistorySelection()
        recordTextHistory({ value: nextValue, selectionStart: caret, selectionEnd: caret }, false)
        lastTextEditRef.current = null
        selectionRestorePendingRef.current = true
        internalValueRef.current = nextValue
        setInternalValue(nextValue)
        scheduleValueChange(nextValue, delay)
        requestAnimationFrame(() => {
            const editor = textareaRef.current
            if (editor) {
                editor.setSelectionRange(caret, caret)
                editor.focus()
            }
            selectionRestorePendingRef.current = false
        })
    }, [recordTextHistory, scheduleValueChange, updateCurrentHistorySelection])

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

    const getDirectiveWord = (text: string, position: number): string | null => {
        const left = text.slice(0, position)
        const line = left.slice(left.lastIndexOf('\n') + 1)
        const hashIndex = line.indexOf('#')
        if (hashIndex === -1 || !/^\s*$/.test(line.slice(0, hashIndex))) return null

        const directive = line.slice(hashIndex)
        // Once a conditional header is complete, continue with normal tag search
        // for its content instead of treating the rest as a directive query.
        if (/^#if(?:\s+[a-z][a-z0-9_-]*|[+-][^:\r\n]+)\s*:/i.test(directive)) return null
        return directive
    }

    const showSuggestionsAtCaret = (el: HTMLTextAreaElement, pos: number) => {
        const rect = el.getBoundingClientRect()
        const caret = getCaretCoordinates(el, pos)
        setCoords({
            top: rect.top + window.scrollY + caret.top + 24,
            left: rect.left + window.scrollX + caret.left
        })
    }

    // --- Autocomplete Logic ---
    const checkAutocomplete = useCallback(async (val: string, el: HTMLTextAreaElement) => {
        const requestId = ++autocompleteRequestRef.current

        const pos = el.selectionEnd || val.length

        // 1. Prompt directives only apply at the beginning of a line.
        const directiveWord = getDirectiveWord(val, pos)
        if (directiveWord !== null) {
            const query = directiveWord.trimEnd().toLowerCase()
            const matches = DIRECTIVE_SUGGESTIONS.filter(item =>
                query === '#' || item.label.toLowerCase().includes(query)
            ).slice(0, maxSuggestions)

            if (matches.length > 0) {
                setSuggestions(matches)
                setSuggestionMode('directive')
                setSelectedIndex(0)
                showSuggestionsAtCaret(el, pos)
                setIsVisible(true)
            } else {
                setIsVisible(false)
            }
            return
        }

        // 2. 議곌컖 紐⑤뱶 泥댄겕 (`<` ?댄썑)
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
        let matches: SuggestionItem[] = []
        try {
            matches = await searchTags(lower, maxSuggestions)
        } catch {
            if (requestId === autocompleteRequestRef.current) setIsVisible(false)
            return
        }
        if (requestId !== autocompleteRequestRef.current) return

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

        if (suggestionMode === 'directive') {
            const directiveWord = getDirectiveWord(val, pos)
            if (directiveWord === null) return

            const start = pos - directiveWord.length
            const newValue = val.slice(0, start) + suggestion.value + val.slice(pos)
            const newCursorPos = start + suggestion.value.length

            commitProgrammaticText(newValue, newCursorPos, 50)
            setIsVisible(false)

            requestAnimationFrame(() => {
                if (textareaRef.current) {
                    textareaRef.current.setSelectionRange(newCursorPos, newCursorPos)
                    textareaRef.current.focus()
                    scrollToCaret()
                }
            })
        } else if (suggestionMode === 'wildcard') {
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
            commitProgrammaticText(newValue, newCursorPos, 50)
            setIsVisible(false)

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
            commitProgrammaticText(newValue, newCursorPos, 50)
            setIsVisible(false)

            // Set cursor position immediately
            requestAnimationFrame(() => {
                if (textareaRef.current) {
                    textareaRef.current.setSelectionRange(newCursorPos, newCursorPos)
                    textareaRef.current.focus()
                    scrollToCaret()
                }
            })
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
    const shouldInsertWeightClosing = (code: string, cursor: number) => {
        if (code.slice(cursor - 2, cursor) !== "::") return false
        if (code.slice(cursor, cursor + 2) === "::") return false

        const beforeMarker = code.slice(0, cursor - 2)
        const followsExistingPrompt = /[^\s,]/.test(code.charAt(cursor))
        if (followsExistingPrompt) return false

        return /(?:^|[\s,])(?:[+-]?(?:\d+(?:\.\d+)?|\.\d+))?$/.test(beforeMarker)
    }

    const handleValueChange = (code: string) => {
        const editor = textareaRef.current
        const cursor = editor?.selectionEnd ?? code.length
        const previousValue = internalValueRef.current
        const isDeletion = code.length < previousValue.length
        const nextValue = !isDeletion && shouldInsertWeightClosing(code, cursor)
            ? code.slice(0, cursor) + "::" + code.slice(cursor)
            : code

        if (nextValue !== code) selectionRestorePendingRef.current = true
        internalValueRef.current = nextValue
        setInternalValue(nextValue)

        if (isComposingRef.current || compositionCommitPendingRef.current) return

        const selectionStart = editor?.selectionStart ?? cursor
        const selectionEnd = editor?.selectionEnd ?? cursor
        const groupedEdit = nextValue === code
            ? groupTextEdit(lastTextEditRef.current, describeTextEdit(previousValue, nextValue), selectionEnd, Date.now())
            : { merge: false, group: null }
        recordTextHistory({ value: nextValue, selectionStart, selectionEnd }, groupedEdit.merge)
        lastTextEditRef.current = groupedEdit.group
        scheduleValueChange(nextValue, 100)

        if (editor) {
            if (nextValue !== code) {
                requestAnimationFrame(() => {
                    textareaRef.current?.setSelectionRange(cursor, cursor)
                    textareaRef.current?.focus()
                    selectionRestorePendingRef.current = false
                    scrollToCaret()
                })
            }
            checkAutocomplete(nextValue, editor)
            scrollToCaret()
        }
    }

    const handleCompositionStart = () => {
        if (compositionCommitTimerRef.current) clearTimeout(compositionCommitTimerRef.current)
        updateCurrentHistorySelection()
        isComposingRef.current = true
        compositionCommitPendingRef.current = true
        lastTextEditRef.current = null
    }

    const handleCompositionEnd = () => {
        isComposingRef.current = false
        if (compositionCommitTimerRef.current) clearTimeout(compositionCommitTimerRef.current)
        compositionCommitTimerRef.current = setTimeout(() => {
            compositionCommitTimerRef.current = null
            compositionCommitPendingRef.current = false
            const editor = textareaRef.current
            const nextValue = internalValueRef.current
            const selectionStart = editor?.selectionStart ?? nextValue.length
            const selectionEnd = editor?.selectionEnd ?? selectionStart
            recordTextHistory({ value: nextValue, selectionStart, selectionEnd }, false)
            scheduleValueChange(nextValue, 0)
            if (editor) checkAutocomplete(nextValue, editor)
        }, 0)
    }

    const adjustWeightAtCaret = (direction: 1 | -1) => {
        const editor = textareaRef.current
        if (!editor) return false

        const code = internalValueRef.current
        const caret = editor.selectionStart
        const start = Math.max(code.lastIndexOf(',', caret - 1), code.lastIndexOf('\n', caret - 1)) + 1
        const nextComma = code.indexOf(',', caret)
        const nextLine = code.indexOf('\n', caret)
        const end = [nextComma, nextLine].filter(index => index >= 0).sort((a, b) => a - b)[0] ?? code.length
        const segment = code.slice(start, end)
        const leading = segment.match(/^\s*/)?.[0] ?? ''
        const trailing = segment.match(/\s*$/)?.[0] ?? ''
        const bodyStart = start + leading.length
        const body = segment.trim()
        const weighted = body.match(/^([+-]?(?:\d+(?:\.\d+)?|\.\d+))::(.+?)::$/)
        const prompt = weighted ? weighted[2] : body
        if (!prompt || body.startsWith('#') || (!weighted && body.includes('::'))) return false

        const weight = Math.round(((weighted ? Number(weighted[1]) : 1) + direction * 0.1) * 10) / 10
        const weightText = String(weight)
        const weightedPrompt = formatWeightedPrompt(prompt, weightText)
        const nextValue = `${code.slice(0, bodyStart)}${weightedPrompt}${trailing}${code.slice(end)}`
        const promptStart = bodyStart + weightText.length + 2 + (/^\d/.test(prompt) ? 1 : 0)
        const previousPromptStart = weighted ? bodyStart + weighted[1].length + 2 : bodyStart
        const nextCaret = promptStart + Math.max(0, Math.min(caret - previousPromptStart, prompt.length))

        commitProgrammaticText(nextValue, nextCaret, 0)
        setIsVisible(false)
        return true
    }

    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement | HTMLDivElement>) => {
        // Ensure ref is captured
        if (e.target instanceof HTMLTextAreaElement) {
            textareaRef.current = e.target
        }

        const key = e.key.toLowerCase()
        const historyAction = !isComposingRef.current && !e.altKey && (e.ctrlKey || e.metaKey)
            ? key === 'z'
                ? (e.shiftKey ? 'redo' : 'undo')
                : key === 'y' && !e.shiftKey ? 'redo' : null
            : null
        if (historyAction) {
            e.preventDefault()
            e.stopPropagation()
            const history = textHistoryRef.current
            applyTextHistoryOffset(history.offset + (historyAction === 'undo' ? -1 : 1))
            return
        }

        if (e.ctrlKey && !e.altKey && !e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
            if (adjustWeightAtCaret(e.key === 'ArrowUp' ? 1 : -1)) {
                e.preventDefault()
                e.stopPropagation()
            }
            return
        }

        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) {
            lastTextEditRef.current = null
        }

        if (isVisible && suggestions.length > 0) {
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
                e.preventDefault()
                e.stopPropagation()
                setIsVisible(false)
                return
            }
        }
    }

    // --- Effects ---
    // ??대㉧ ?뺣━ (而댄룷?뚰듃 ?몃쭏?댄듃 ??
    useEffect(() => {
        return () => {
            autocompleteRequestRef.current++
            if (compositionCommitTimerRef.current) clearTimeout(compositionCommitTimerRef.current)
            flushPendingValue()
        }
    }, [flushPendingValue])

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
                    const isComment = isPromptCommentLine(line)
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
                    // Highlight prompt syntax without changing the submitted text.
                    const isConditionalDirective = /^\s*#if(?:\s+[a-z][a-z0-9_-]*|[+-][^:\r\n]+)\s*:/i.test(line)
                    const regex = /(^\s*#if(?:\s+[a-z][a-z0-9_-]*|[+-][^:\r\n]+)\s*:)|((?:-?[\d.]+)?::.*?::)|(<[^>]+>)|(#(?:source|target)\b)/gi
                    const parts = line.split(regex)

                    return (
                        <Fragment key={lineIndex}>
                            {parts.map((part, i) => {
                                if (part === undefined) return null
                                let styleClass = ""
                                if (/^(?:-?[\d.]+)?::.*::$/.test(part)) {
                                    styleClass = part.startsWith('-')
                                        ? "bg-sky-500/30 rounded-[2px]"
                                        : "bg-pink-500/30 rounded-[2px]"
                                } else if (/^<[^>]+>$/.test(part)) {
                                    styleClass = "bg-green-500/30 rounded-[2px]"
                                } else if (/^\s*#if(?:\s+[a-z][a-z0-9_-]*|[+-][^:\r\n]+)\s*:$/i.test(part)) {
                                    styleClass = "bg-amber-500/15 text-amber-700/85 dark:text-amber-200/85 rounded-[2px]"
                                } else if (/^#(?:source|target)$/i.test(part)) {
                                    styleClass = "bg-cyan-500/15 text-cyan-700/85 dark:text-cyan-200/85 rounded-[2px]"
                                } else if (isConditionalDirective && part) {
                                    styleClass = "text-amber-700/70 dark:text-amber-200/70"
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
                    font-kerning: none !important;
                    font-synthesis: none !important;
                    tab-size: 4 !important;
                    white-space: pre-wrap !important;
                    overflow-wrap: break-word !important;
                    word-break: keep-all !important;
                    hyphens: none !important;
                    box-sizing: border-box !important;
                    width: 100% !important;
                    max-width: 100% !important;
                    overflow-x: hidden !important;
                }
                .prompt-editor-wrapper textarea {
                    overflow: hidden !important;
                    height: 100% !important; /* Prevent internal scroll by matching container height */
                }
            `}</style>

            {/* Scrollable Container */}
            <div
                ref={containerRef}
                className="flex-1 min-w-0 w-full max-w-full relative overflow-x-hidden overflow-y-auto"
                style={{ scrollBehavior: 'smooth', overscrollBehaviorX: 'none' }}
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
                        width: '100%',
                        maxWidth: '100%',
                    }}

                    // Wrapper Class
                    className="min-h-full min-w-0 w-full max-w-full"

                    // Textarea Class
                    // Styles are now handled by global CSS injection above
                    textareaClassName="focus:outline-none bg-transparent min-h-full min-w-0 resize-none"

                    // Event wiring
                    onFocus={(e) => {
                        textareaRef.current = e.target as HTMLTextAreaElement
                        updateCurrentHistorySelection()
                    }}
                    onBlur={() => {
                        updateCurrentHistorySelection()
                        flushPendingValue()
                    }}
                    onClick={(e) => {
                        textareaRef.current = e.target as HTMLTextAreaElement
                        lastTextEditRef.current = null
                        updateCurrentHistorySelection()
                        scrollToCaret()
                    }}
                    onKeyUp={() => {
                        updateCurrentHistorySelection()
                        scrollToCaret()
                    }} // Handle arrow keys
                    onKeyDown={handleKeyDown}
                    onSelect={updateCurrentHistorySelection}
                    onCompositionStart={handleCompositionStart}
                    onCompositionEnd={handleCompositionEnd}

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
                                            item.type === 'directive' ? "text-cyan-300" :
                                                item.type === 'fragment' ? "text-green-300" :
                                                item.type === 'artist' ? "text-yellow-300" :
                                                    item.type === 'character' ? "text-green-300" :
                                                        item.type === 'copyright' ? "text-fuchsia-300" :
                                                            "text-blue-300"
                                        )}>
                                            {item.type === 'directive' ? 'syntax' : item.type}
                                        </span>
                                        {item.type !== 'directive' && (
                                            <span>
                                                {item.type === 'fragment'
                                                    ? `${item.count} lines`
                                                    : (item.count ?? 0) >= 1000 ? ((item.count ?? 0) / 1000).toFixed(1) + 'k' : item.count}
                                            </span>
                                        )}
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
