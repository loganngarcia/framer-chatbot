// @ts-nocheck
// -----------------------------------------------------------------------------
// Imports
// -----------------------------------------------------------------------------
import {
    useState,
    useRef,
    useEffect,
    startTransition,
    useCallback,
    CSSProperties,
    Fragment,
} from "react"
import { addPropertyControls, ControlType, RenderTarget } from "framer"
// Framer Motion: animations + scroll hooks for collapsed input scroll-reveal
import { motion, useDragControls, useScroll, useMotionValueEvent } from "framer-motion"

// -----------------------------------------------------------------------------
// Type Definitions
// -----------------------------------------------------------------------------

/** Defines the reasoning effort for the Gemini API call. */
type ReasoningEffort = "low" | "medium" | "high" | "none"

interface FramerFontInfo {
    fontFamily: string
    fontSize: number
    fontWeight: number | string
    fontStyle: string
    letterSpacing: number | string
    lineHeight: number | string
    textAlign?: "left" | "center" | "right" | "justify"
}

interface ResponsiveImageType {
    src: string
    srcSet?: string
    alt?: string
}

interface ChatOverlayProps {
    geminiApiKey: string
    model: string
    reasoningEffort: ReasoningEffort
    systemPrompt: string
    welcomeMessage?: string // New prop for the welcome message
    placeholder: string
    inputBarBackground: string
    expandedInputAreaBackground: string
    chatAreaBackground: string
    userMessageBackgroundColor: string
    shadow: boolean
    iconColor: string
    sendIconColor: string
    iconBgColor: string
    sendBgColor: string
    textColor: string
    placeholderTextColor: string
    linkColor: string
    sendIconOverrideUrl?: ResponsiveImageType
    loadingIconOverrideUrl?: ResponsiveImageType
    textFont?: FramerFontInfo
    style?: CSSProperties
    suggestedReply1?: string
    suggestedReply2?: string
    suggestedReply3?: string
    enableAiSuggestions?: boolean
    universalBorderRadius: number
    /**
     * Enables scroll-reveal for the collapsed input bar.
     * When true (and not on Canvas/Thumbnail), the input bar animates
     * from translateY(400px) scale(0.3), opacity 0.5 to translateY(0) scale(1), opacity 1
     * once window scrollY >= 10. Disabled when expanded.
     */
    enableScrollReveal?: boolean
}

interface Message {
    role: "user" | "assistant" | "system"
    content:
        | string
        | Array<
              | { type: "text"; text: string }
              | { type: "image_url"; image_url: { url: string } }
          >
}
// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------
const DESKTOP_BREAKPOINT = 855
const DEFAULT_EXPANDED_BOTTOM_OFFSET = 32
const DEFAULT_EXPANDED_INPUT_BG = "rgba(255,255,255,0.95)"
const DRAG_CLOSE_THRESHOLD_Y = 64

const DEFAULT_FONT_INFO: FramerFontInfo = {
    fontFamily: "Inter, sans-serif",
    fontSize: 16,
    fontWeight: 400,
    fontStyle: "normal",
    letterSpacing: 0,
    lineHeight: 1.5,
    textAlign: "left",
}

const SUGGESTION_MODEL_ID = "gemini-2.5-flash-lite"

// -----------------------------------------------------------------------------
// Helper Functions
// -----------------------------------------------------------------------------

/**
 * Extracts the alpha (opacity) value from various color string formats.
 *
 * This utility function parses RGBA/HSLA color strings and hex colors with alpha
 * channels to extract the transparency value. Used throughout the component for
 * dynamic styling decisions based on background opacity, such as adjusting
 * backdrop blur intensity and shadow visibility.
 *
 * @param color - Color string in formats like "rgba(255,0,0,0.5)", "hsla(120,100%,50%,0.3)", or "#rrggbbaa"
 * @returns Alpha value between 0.0 (fully transparent) and 1.0 (fully opaque)
 */
function getAlphaFromColorString(color: string): number {
    if (!color || typeof color !== "string") return 1.0
    const trimmedColor = color.toLowerCase().trim()
    if (trimmedColor === "transparent") return 0.0
    let match =
        trimmedColor.match(
            /^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)$/
        ) ||
        trimmedColor.match(/^rgba\(\s*\d+\s+\d+\s+\d+\s*\/\s*([\d.]+)\s*\)$/)
    if (match && match[1]) return parseFloat(match[1])
    match =
        trimmedColor.match(
            /^hsla\(\s*[\d.]+\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*([\d.]+)\s*\)$/
        ) ||
        trimmedColor.match(
            /^hsla\(\s*[\d.]+\s+[\d.]+%?\s+[\d.]+%?\s*\/\s*([\d.]+)\s*\)$/
        )
    if (match && match[1]) return parseFloat(match[1])
    if (trimmedColor.startsWith("#")) {
        const hex = trimmedColor.substring(1)
        if (hex.length === 8) {
            return parseInt(hex.substring(6, 8), 16) / 255
        }
        if (hex.length === 4) {
            return parseInt(hex.substring(3, 4) + hex.substring(3, 4), 16) / 255
        }
    }
    return 1.0
}

/**
 * Ensures URLs have a proper protocol prefix for secure external linking.
 *
 * This function validates and prepends "https://" to URLs that appear to be
 * web addresses but lack a protocol. Used by the markdown renderer when
 * processing links to prevent broken hrefs and ensure secure external navigation.
 * Handles special protocols like mailto: and tel: that should remain unchanged.
 *
 * @param url - Raw URL string that may or may not have a protocol
 * @returns Properly formatted URL with protocol prefix when appropriate
 */
function ensureProtocol(url: string): string {
    if (
        url.startsWith("mailto:") ||
        url.startsWith("tel:") ||
        url.startsWith("http://") ||
        url.startsWith("https://")
    ) {
        return url
    }
    if (url.includes(".") && !url.includes(" ") && !url.startsWith("/")) {
        if (/[a-zA-Z0-9-]+\.[a-zA-Z]{2,}/.test(url.split("/")[0])) {
            return "https://" + url
        }
    }
    return url
}

/**
 * Strips markdown formatting from text to prepare it for text-to-speech synthesis.
 *
 * This function removes markdown syntax elements that would interfere with
 * natural speech patterns or be pronounced awkwardly by TTS engines. Used
 * specifically by the text-to-speech functionality to provide clean, natural
 * audio output of assistant responses. Preserves the essential content while
 * removing visual formatting artifacts.
 *
 * @param markdownText - Raw markdown-formatted text from assistant messages
 * @returns Plain text with markdown syntax removed, optimized for speech synthesis
 */
function stripMarkdownForTTS(markdownText: string): string {
    if (!markdownText) return ""
    return (
        markdownText
            // Remove headings
            .replace(/^#{1,6}\s+/gm, "")
            // Remove bold and italic (asterisks and underscores)
            .replace(/(\*\*|__)(.*?)\1/g, "$2")
            .replace(/(\*|_)(.*?)\1/g, "$2")
            // Remove strikethrough
            .replace(/~~(.*?)~~/g, "$1")
            // Convert markdown links to just their text
            .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1")
            // Remove images, keeping alt text if present
            .replace(/!\[([^\]]*)\]\([^\)]+\)/g, "$1")
            // Remove horizontal rules
            .replace(/^(---|\*\*\*|___)\s*$/gm, "")
            // Remove blockquotes
            .replace(/^>\s?/gm, "")
            // Remove list markers (unordered and ordered)
            .replace(/^\s*[-*+]\s+/gm, "")
            .replace(/^\s*\d+\.\s+/gm, "")
            // Remove inline code backticks
            .replace(/`([^`]+)`/g, "$1")
            // Collapse multiple newlines into a single space
            .replace(/\n+/g, " ")
            .trim()
    )
}

/**
 * Parses and renders inline markdown formatting within text segments.
 *
 * This core markdown rendering function processes text for bold, italic, links,
 * email addresses, and general URLs, converting them into styled React elements.
 * It's the foundation of the component's rich text display capabilities, used
 * by renderSimpleMarkdown to transform plain text with markdown syntax into
 * visually formatted content with interactive links.
 *
 * The function uses a sophisticated regex to match multiple markdown patterns
 * simultaneously, then recursively processes nested formatting within each match.
 * This enables complex formatting like **bold with [links](url) inside**.
 *
 * @param textSegment - Raw text that may contain markdown formatting
 * @param keyPrefix - Unique prefix for React keys to avoid conflicts in rendering
 * @param linkStyle - CSS styles to apply to rendered links
 * @returns Array of strings and JSX elements representing the formatted content
 */
const applyInlineFormatting = (
    textSegment: string,
    keyPrefix: string,
    linkStyle: CSSProperties
): (string | JSX.Element)[] => {
    if (!textSegment) return []
    const parts: (string | JSX.Element)[] = []
    let lastIndex = 0
    const combinedRegex =
        /(\*\*(.*?)\*\*|__(.*?)__|\_(.*?)\_|\[([^\]]+?)\]\(([^\s)]+)\)|([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,63})|((?:https?:\/\/)?(?:(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}|localhost)(?::\d+)?(?:(?:\/[^\s!"'(),.:;<>@[\]`{|}~]*)*)?))/gi
    let match
    while ((match = combinedRegex.exec(textSegment)) !== null) {
        if (match.index > lastIndex) {
            parts.push(textSegment.substring(lastIndex, match.index))
        }
        const fullMatch = match[0]
        const boldStarContent = match[2]
        const boldUnderscoreContent = match[3]
        const italicUnderscoreContent = match[4]
        const markdownLinkText = match[5]
        const markdownLinkUrl = match[6]
        const emailAddress = match[7]
        const generalLinkUrl = match[8]

        if (boldStarContent !== undefined) {
            parts.push(
                <strong key={`${keyPrefix}-${match.index}-bs`}>
                    {applyInlineFormatting(
                        boldStarContent,
                        `${keyPrefix}-${match.index}-bs-text`,
                        linkStyle
                    )}
                </strong>
            )
        } else if (boldUnderscoreContent !== undefined) {
            parts.push(
                <strong key={`${keyPrefix}-${match.index}-bu`}>
                    {applyInlineFormatting(
                        boldUnderscoreContent,
                        `${keyPrefix}-${match.index}-bu-text`,
                        linkStyle
                    )}
                </strong>
            )
        } else if (italicUnderscoreContent !== undefined) {
            parts.push(
                <em key={`${keyPrefix}-${match.index}-iu`}>
                    {applyInlineFormatting(
                        italicUnderscoreContent,
                        `${keyPrefix}-${match.index}-iu-text`,
                        linkStyle
                    )}
                </em>
            )
        } else if (
            markdownLinkText !== undefined &&
            markdownLinkUrl !== undefined
        ) {
            let href = markdownLinkUrl.trim()
            if (
                /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,63}$/.test(
                    href
                ) &&
                !href.toLowerCase().startsWith("mailto:")
            ) {
                href = `mailto:${href}`
            } else {
                href = ensureProtocol(href)
            }
            parts.push(
                <a
                    key={`${keyPrefix}-${match.index}-mdlink`}
                    href={href}
                    target={
                        href.startsWith("mailto:") || href.startsWith("tel:")
                            ? "_self"
                            : "_blank"
                    }
                    rel="noopener noreferrer"
                    style={linkStyle}
                >
                    {markdownLinkText}
                </a>
            )
        } else if (emailAddress !== undefined) {
            parts.push(
                <a
                    key={`${keyPrefix}-${match.index}-email`}
                    href={`mailto:${emailAddress}`}
                    style={linkStyle}
                >
                    {emailAddress}
                </a>
            )
        } else if (generalLinkUrl !== undefined) {
            const fullUrl = ensureProtocol(generalLinkUrl.trim())
            parts.push(
                <a
                    key={`${keyPrefix}-${match.index}-link`}
                    href={fullUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={linkStyle}
                >
                    {generalLinkUrl}
                </a>
            )
        } else {
            parts.push(fullMatch)
        }
        lastIndex = match.index + fullMatch.length
    }
    if (lastIndex < textSegment.length) {
        parts.push(textSegment.substring(lastIndex))
    }
    return parts
}

/**
 * Renders markdown-formatted text as structured React elements.
 *
 * This is the main markdown rendering engine that converts plain text with
 * markdown syntax into a structured JSX element tree. It handles block-level
 * elements like headings, paragraphs, lists, and delegates inline formatting
 * to applyInlineFormatting. Used throughout the chat interface to display
 * rich text responses from the Gemini API with proper visual hierarchy and
 * interactive elements.
 *
 * The function processes text block by block, maintaining state for list
 * processing and ensuring proper nesting of elements. It's designed to be
 * lightweight while supporting the most common markdown features needed
 * for chat conversations.
 *
 * @param markdownText - Raw markdown text to be rendered
 * @param baseTextStyle - Base CSS styles for text elements
 * @param linkStyle - CSS styles for link elements
 * @returns JSX Fragment containing the fully rendered markdown content
 */
const renderSimpleMarkdown = (
    markdownText: string,
    baseTextStyle: CSSProperties,
    linkStyle: CSSProperties
): JSX.Element => {
    if (!markdownText) return <Fragment />
    const elements: JSX.Element[] = []
    const blocks = markdownText.split(/\n\s*\n+/)
    const baseFontSize = parseFloat(baseTextStyle.fontSize as string) || 16

    blocks.forEach((block, blockIndex) => {
        if (block.trim() === "") return

        const lines = block.split("\n")
        let currentListType: "ul" | "ol" | null = null
        let listItems: JSX.Element[] = []

        const flushList = () => {
            if (listItems.length > 0) {
                const listKey = `${currentListType}-${blockIndex}-${elements.length}`
                const listStyle: CSSProperties = {
                    ...baseTextStyle,
                    listStylePosition: "outside",
                    paddingLeft: "20px",
                    margin: "0.5em 0",
                }
                if (currentListType === "ul") {
                    elements.push(
                        <ul key={listKey} style={listStyle}>
                            {listItems}
                        </ul>
                    )
                } else if (currentListType === "ol") {
                    elements.push(
                        <ol key={listKey} style={listStyle}>
                            {listItems}
                        </ol>
                    )
                }
                listItems = []
            }
            currentListType = null
        }

        lines.forEach((line, lineIndex) => {
            const lineKeyPrefix = `b${blockIndex}-l${lineIndex}`

            if (line.startsWith("# ")) {
                flushList()
                elements.push(
                    <h1
                        key={`${lineKeyPrefix}-h1`}
                        style={{
                            ...baseTextStyle,
                            fontSize: `${Math.max(baseFontSize * 1.8, 24)}px`,
                            fontWeight: "bold",
                            margin: "0.67em 0",
                        }}
                    >
                        {applyInlineFormatting(
                            line.substring(2),
                            `${lineKeyPrefix}-h1c`,
                            linkStyle
                        )}
                    </h1>
                )
                return
            }
            if (line.startsWith("## ")) {
                flushList()
                elements.push(
                    <h2
                        key={`${lineKeyPrefix}-h2`}
                        style={{
                            ...baseTextStyle,
                            fontSize: `${Math.max(baseFontSize * 1.4, 20)}px`,
                            fontWeight: "bold",
                            margin: "0.83em 0",
                        }}
                    >
                        {applyInlineFormatting(
                            line.substring(3),
                            `${lineKeyPrefix}-h2c`,
                            linkStyle
                        )}
                    </h2>
                )
                return
            }
            if (line.startsWith("### ")) {
                flushList()
                elements.push(
                    <h3
                        key={`${lineKeyPrefix}-h3`}
                        style={{
                            ...baseTextStyle,
                            fontSize: `${Math.max(baseFontSize * 1.15, 18)}px`,
                            fontWeight: "bold",
                            margin: "1em 0",
                        }}
                    >
                        {applyInlineFormatting(
                            line.substring(4),
                            `${lineKeyPrefix}-h3c`,
                            linkStyle
                        )}
                    </h3>
                )
                return
            }

            const ulMatch = line.match(/^(\s*)(?:[-*]|\u2022)\s+(.*)/)
            if (ulMatch) {
                if (currentListType !== "ul") {
                    flushList()
                    currentListType = "ul"
                }
                const indentLevel = Math.floor(ulMatch[1].length / 2)
                listItems.push(
                    <li
                        key={`${lineKeyPrefix}-li`}
                        style={{
                            ...baseTextStyle,
                            marginLeft: `${indentLevel * 20}px`,
                            display: "list-item",
                            listStyleType: "disc",
                        }}
                    >
                        {applyInlineFormatting(
                            ulMatch[2],
                            `${lineKeyPrefix}-lic`,
                            linkStyle
                        )}
                    </li>
                )
                return
            }

            const olMatch = line.match(/^(\s*)(\d+)\.\s+(.*)/)
            if (olMatch) {
                if (currentListType !== "ol") {
                    flushList()
                    currentListType = "ol"
                }
                const indentLevel = Math.floor(olMatch[1].length / 2)
                listItems.push(
                    <li
                        key={`${lineKeyPrefix}-li`}
                        style={{
                            ...baseTextStyle,
                            marginLeft: `${indentLevel * 20}px`,
                            display: "list-item",
                            listStyleType: "decimal",
                        }}
                    >
                        {applyInlineFormatting(
                            olMatch[3],
                            `${lineKeyPrefix}-lic`,
                            linkStyle
                        )}
                    </li>
                )
                return
            }

            flushList()
            if (line.trim() !== "") {
                elements.push(
                    <div
                        key={`${lineKeyPrefix}-p`}
                        style={{ ...baseTextStyle, margin: "0.5em 0" }}
                    >
                        {applyInlineFormatting(
                            line,
                            `${lineKeyPrefix}-pc`,
                            linkStyle
                        )}
                    </div>
                )
            }
        })
        flushList()
    })

    return <Fragment>{elements}</Fragment>
}
// -----------------------------------------------------------------------------
// Main ChatOverlay Component
// -----------------------------------------------------------------------------
/**
 * A chat overlay component that connects to Gemini for responses.
 * Allows text and image inputs, streaming, and AI-generated suggestions.
 * @framerIntrinsicWidth 248
 * @framerIntrinsicHeight 48
 * @framerSupportedLayoutWidth any
 * @framerSupportedLayoutHeight any
 */
/**
 * Main ChatOverlay component that provides a Gemini AI chat interface.
 *
 * This component implements a complete chat experience with the following key features:
 * - Text and image input capabilities
 * - Streaming responses from Gemini API
 * - Mobile and desktop responsive design
 * - Rich markdown rendering of responses
 * - Text-to-speech functionality
 * - AI-generated contextual suggestions
 * - Framer-compatible property controls for design customization
 *
 * The component operates in two main states: collapsed (compact input bar) and
 * expanded (full chat interface). It integrates deeply with Framer's rendering
 * system and follows best practices for Canvas/Preview safety.
 */
export default function ChatOverlay(props: ChatOverlayProps) {
    // =========================================================================
    // Props Destructuring & Configuration
    // =========================================================================

    /**
     * Extract and provide default values for all component props.
     * These props control the behavior, appearance, and integration of the chat overlay.
     * Many have sensible defaults while others are required for core functionality.
     */
    const {
        geminiApiKey,
        model,
        reasoningEffort,
        systemPrompt,
        welcomeMessage = "Hi, how can I help?",
        placeholder,
        inputBarBackground,
        expandedInputAreaBackground,
        chatAreaBackground,
        userMessageBackgroundColor,
        shadow,
        iconColor,
        sendIconColor,
        sendBgColor,
        textColor,
        placeholderTextColor,
        linkColor = "#007AFF",
        sendIconOverrideUrl,
        loadingIconOverrideUrl,
        textFont = DEFAULT_FONT_INFO,
        style,
        suggestedReply1 = "",
        suggestedReply2 = "",
        suggestedReply3 = "",
        enableAiSuggestions = true,
        universalBorderRadius = 24,
        enableScrollReveal = true,
    } = props

    // =========================================================================
    // Core State Management & Refs
    // =========================================================================

    /**
     * Framer Motion drag controls for handling mobile gesture-based collapse.
     * Enables the overlay to be dragged down to close on mobile devices.
     */
    const dragControls = useDragControls()
    // Motion value that tracks window scrollY (Framer Motion). Used to drive the
    // collapsed input's reveal-on-scroll animation when enabled.
    const { scrollY } = useScroll()

    /**
     * Computed font styles from the textFont prop.
     * Converts Framer font configuration into CSS-compatible properties.
     * Used throughout the component for consistent typography.
     */
    const globalFontStyles: CSSProperties = {
        fontFamily: textFont.fontFamily,
        fontSize:
            typeof textFont.fontSize === "number"
                ? `${textFont.fontSize}px`
                : textFont.fontSize,
        fontWeight: textFont.fontWeight,
        fontStyle: textFont.fontStyle,
        lineHeight:
            typeof textFont.lineHeight === "number" && textFont.lineHeight > 5
                ? `${textFont.lineHeight}px`
                : textFont.lineHeight || DEFAULT_FONT_INFO.lineHeight,
        letterSpacing:
            typeof textFont.letterSpacing === "number"
                ? `${textFont.letterSpacing}px`
                : textFont.letterSpacing,
    }

    // =========================================================================
    // Component State Variables
    // =========================================================================

    /**
     * Core UI state variables that control the chat interface behavior.
     * These manage everything from user input to API communication state.
     */

    /** Current text input from the user */
    const [input, setInput] = useState<string>("")

    /** Whether the chat overlay is in expanded (full) or collapsed (compact) mode */
    const [expanded, setExpanded] = useState<boolean>(false)
    /**
     * Array of chat messages with roles (system, user, assistant).
     * Initialized with system prompt and optional welcome message.
     * This is the core data structure that tracks the conversation history.
     */
    const [messages, setMessages] = useState<Message[]>(() => {
        const initialMessages: Message[] = [
            {
                role: "system",
                content: systemPrompt || "You are a helpful assistant.",
            },
        ]
        if (welcomeMessage && welcomeMessage.trim() !== "") {
            initialMessages.push({
                role: "assistant",
                content: welcomeMessage,
            })
        }
        return initialMessages
    })
    /** Whether a message is currently being sent to/received from the Gemini API */
    const [isLoading, setIsLoading] = useState<boolean>(false)

    /** Current error message to display to the user (if any) */
    const [error, setError] = useState<string>("")

    /** Partial response text being streamed from Gemini API (shown before complete) */
    const [streamed, setStreamed] = useState<string>("")

    /** Currently selected image file for upload with the next message */
    const [imageFile, setImageFile] = useState<File | null>(null)

    /** Object URL for previewing the selected image file */
    const [imagePreviewUrl, setImagePreviewUrl] = useState<string>("")
    /** Index of the message currently being spoken via TTS (null if none) */
    const [speakingMessageIndex, setSpeakingMessageIndex] = useState<
        number | null
    >(null)

    /** Whether the current viewport is considered mobile (affects layout and interactions) */
    const [isMobileView, setIsMobileView] = useState<boolean>(
        typeof window !== "undefined"
            ? window.innerWidth < DESKTOP_BREAKPOINT
            : false
    )
    /** Selected voice for text-to-speech synthesis */
    const [selectedVoice, setSelectedVoice] =
        useState<SpeechSynthesisVoice | null>(null)

    /** Bottom offset for expanded overlay to avoid viewport conflicts */
    const [expandedViewBottomOffset, setExpandedViewBottomOffset] =
        useState<number>(DEFAULT_EXPANDED_BOTTOM_OFFSET)

    /** Array of AI-generated contextual reply suggestions */
    const [aiGeneratedSuggestions, setAiGeneratedSuggestions] = useState<
        string[]
    >([])

    // =========================================================================
    // DOM Refs & Imperative Handles
    // =========================================================================

    /** Controller for aborting ongoing API requests */
    const abortControllerRef = useRef<AbortController | null>(null)

    /** Ref to the collapsed input bar container for positioning calculations */
    const inputBarRef = useRef<HTMLDivElement | null>(null)

    /** Ref to the collapsed input field for focus management */
    const collapsedInputRef = useRef<HTMLInputElement | null>(null)

    /** Ref to the expanded textarea for dynamic resizing and focus management */
    const inputRef = useRef<HTMLTextAreaElement | null>(null)

    /** Hidden file input element for image uploads */
    const fileInputRef = useRef<HTMLInputElement | null>(null)

    /** Ref for scrolling to bottom of messages (auto-scroll behavior) */
    const messagesEndRef = useRef<HTMLDivElement | null>(null)

    /** Current TTS utterance being spoken */
    const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null)

    /** Ref to expanded overlay for click-outside detection */
    const expandedOverlayRef = useRef<HTMLDivElement | null>(null)

    /** Tracks whether initial focus has been applied to prevent focus conflicts */
    const initialFocusPendingRef = useRef(true)

    /** Ref to messages scroll container for gesture handling */
    const scrollContainerRef = useRef<HTMLDivElement | null>(null)

    /** Tracks the start of mobile drag gestures for collapse functionality */
    const gestureStartRef = useRef<{ y: number; isDragging: boolean } | null>(
        null
    )

    /** Previous loading state for detecting state transitions */
    const prevIsLoadingRef = useRef<boolean>(isLoading)

    /** Previous expanded state for detecting state transitions */
    const prevExpandedRef = useRef<boolean>(expanded)
    // Local style state for collapsed input scroll-reveal.
    // Initialized synchronously so the first paint matches the intended state
    // (avoids a flash/jump from visible -> hidden).
    const [scrollRevealStyle, setScrollRevealStyle] = useState<CSSProperties | null>(() => {
        const isStaticEnv =
            RenderTarget.current() === RenderTarget.canvas ||
            RenderTarget.current() === RenderTarget.thumbnail
        if (!enableScrollReveal || expanded || isStaticEnv) return null
        if (typeof window === "undefined") {
            return { opacity: 0.5, transform: "translateY(400px) scale(0.3)" }
        }
        const initialVisible = window.scrollY >= 10
        return {
            opacity: initialVisible ? 1 : 0.5,
            transform: initialVisible
                ? "translateY(0px) scale(1)"
                : "translateY(400px) scale(0.3)",
        }
    })

    // =========================================================================
    // Computed Values & UI State
    // =========================================================================

    /** Whether the input has content (text or image) ready to send */
    const hasContent = !!(input.trim() || imageFile)

    /** Whether the send button should be disabled in collapsed mode */
    const isCollapsedSendDisabled = isLoading || !hasContent

    /** Computed opacity for send button based on disabled state */
    const sendButtonEffectiveOpacity = isCollapsedSendDisabled ? 0.5 : 1

    // =========================================================================
    // Effect Hooks - Side Effects & Lifecycle Management
    // =========================================================================

    /**
     * COLLAPSED INPUT SCROLL-REVEAL EFFECT
     * - Enabled via enableScrollReveal
     * - Trigger: window.scrollY >= 10
     * - Animation: translateY(400px) scale(0.3), opacity 0.5 -> translateY(0) scale(1), opacity 1
     * - Environments: active in Preview/Export, skipped on Canvas/Thumbnail
     * - Inactive when overlay is expanded
     */
    useEffect(() => {
        const isStaticEnv =
            RenderTarget.current() === RenderTarget.canvas ||
            RenderTarget.current() === RenderTarget.thumbnail
        if (!enableScrollReveal || expanded || isStaticEnv) {
            setScrollRevealStyle(null)
            return
        }
        if (typeof window === "undefined") return
        const initialVisible = window.scrollY >= 10
        setScrollRevealStyle({
            opacity: initialVisible ? 1 : 0.5,
            transform: initialVisible
                ? "translateY(0px) scale(1)"
                : "translateY(400px) scale(0.3)",
        })
    }, [enableScrollReveal, expanded])

    useMotionValueEvent(scrollY, "change", (latest) => {
        const isStaticEnv =
            RenderTarget.current() === RenderTarget.canvas ||
            RenderTarget.current() === RenderTarget.thumbnail
        if (!enableScrollReveal || expanded || isStaticEnv) return
        setScrollRevealStyle({
            opacity: latest >= 10 ? 1 : 0.5,
            transform:
                latest >= 10
                    ? "translateY(0px) scale(1)"
                    : "translateY(400px) scale(0.3)",
        })
    })

    /**
     * MOBILE SCROLL LOCK EFFECT
     * Prevents background scrolling and touch actions when overlay is expanded on mobile.
     * This creates a modal-like experience where the user can only interact with the chat.
     * Also compensates for scrollbar disappearance by adding right padding to prevent layout shift.
     */
    useEffect(() => {
        if (
            typeof document === "undefined" ||
            typeof document.body === "undefined" ||
            typeof window === "undefined"
        ) {
            return
        }

        if (expanded && isMobileView) {
            const originalBodyOverflow = document.body.style.overflow
            const originalBodyTouchAction = document.body.style.touchAction
            const originalBodyPaddingRight = document.body.style.paddingRight

            const scrollbarWidth =
                window.innerWidth - document.documentElement.clientWidth

            document.body.style.overflow = "hidden"
            document.body.style.touchAction = "none"
            if (scrollbarWidth > 0) {
                document.body.style.paddingRight = `${scrollbarWidth}px`
            }

            return () => {
                document.body.style.overflow = originalBodyOverflow
                document.body.style.touchAction = originalBodyTouchAction
                if (scrollbarWidth > 0) {
                    document.body.style.paddingRight = originalBodyPaddingRight
                }
            }
        }
    }, [expanded, isMobileView])

    const fetchAiSuggestions = useCallback(
        async (lastAiMessageContent: string) => {
            if (
                !geminiApiKey ||
                !enableAiSuggestions ||
                !lastAiMessageContent.trim()
            ) {
                setAiGeneratedSuggestions([])
                return
            }
            setAiGeneratedSuggestions([])

            const suggestionPrompt = `Based on the last AI message:\n\n"${lastAiMessageContent}"\n\nSuggest three helpful, short (max 5 words) follow-up questions that make sense at a glance and the user might ask or say next. Present them as a JSON array of strings. For example: ["Tell me more.", "How does it work?", "What is that?"]`

            try {
                const response = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models/${SUGGESTION_MODEL_ID}:generateContent?key=${geminiApiKey}`,
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            contents: [{ parts: [{ text: suggestionPrompt }] }],
                            generationConfig: {
                                temperature: 0.7,
                                maxOutputTokens: 100,
                                stopSequences: ["\n\n"],
                            },
                        }),
                    }
                )

                if (!response.ok) {
                    const errorData = await response.text()
                    console.error(
                        "Error fetching AI suggestions:",
                        response.status,
                        errorData
                    )
                    setAiGeneratedSuggestions([])
                    return
                }

                const data = await response.json()
                const responseText =
                    data.candidates?.[0]?.content?.parts?.[0]?.text || ""

                if (responseText) {
                    try {
                        const jsonMatch = responseText.match(/(\[[\s\S]*?\])/)
                        if (jsonMatch && jsonMatch[0]) {
                            const suggestionsArray = JSON.parse(jsonMatch[0])
                            if (
                                Array.isArray(suggestionsArray) &&
                                suggestionsArray.every(
                                    (s) => typeof s === "string"
                                )
                            ) {
                                setAiGeneratedSuggestions(
                                    suggestionsArray
                                        .slice(0, 3)
                                        .filter((s) => s.trim() !== "")
                                )
                            } else {
                                setAiGeneratedSuggestions([])
                            }
                        } else {
                            setAiGeneratedSuggestions([])
                        }
                    } catch (e) {
                        console.error(
                            "Failed to parse AI suggestions JSON:",
                            e,
                            "\nRaw text for suggestions:",
                            responseText
                        )
                        setAiGeneratedSuggestions([])
                    }
                } else {
                    setAiGeneratedSuggestions([])
                }
            } catch (e) {
                console.error("Exception fetching AI suggestions:", e)
                setAiGeneratedSuggestions([])
            }
        },
        [geminiApiKey, enableAiSuggestions]
    )

    const handleStopGeneration = useCallback(() => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort()
        }
    }, [])

    const handleCollapse = useCallback(() => {
        startTransition(() => setExpanded(false))
        if (typeof window !== "undefined" && window.speechSynthesis) {
            window.speechSynthesis.cancel()
        }
        setSpeakingMessageIndex(null)
        if (utteranceRef.current) {
            utteranceRef.current = null
        }
        handleStopGeneration()
        initialFocusPendingRef.current = true
    }, [handleStopGeneration])

    const handleExpand = useCallback(() => {
        if (inputBarRef.current && typeof window !== "undefined") {
            const rect = inputBarRef.current.getBoundingClientRect()
            const distanceFromViewportBottom = window.innerHeight - rect.bottom
            setExpandedViewBottomOffset(
                Math.max(distanceFromViewportBottom, 16)
            )
        } else {
            setExpandedViewBottomOffset(DEFAULT_EXPANDED_BOTTOM_OFFSET)
        }
        startTransition(() => setExpanded(true))
    }, [])

    /**
     * VIEWPORT DETECTION EFFECT
     * Monitors window resize events to determine if we're in mobile or desktop view.
     * This affects layout decisions, interaction patterns, and overlay positioning.
     * Uses DESKTOP_BREAKPOINT (855px) as the threshold for switching between modes.
     */
    useEffect(() => {
        const checkViewport = () => {
            if (typeof window !== "undefined") {
                setIsMobileView(window.innerWidth < DESKTOP_BREAKPOINT)
            }
        }
        if (typeof window !== "undefined") {
            checkViewport()
            window.addEventListener("resize", checkViewport)
            return () => window.removeEventListener("resize", checkViewport)
        }
    }, [])

    /**
     * IMAGE PREVIEW URL MANAGEMENT EFFECT
     * Creates and manages object URLs for image previews when files are selected.
     * Properly cleans up URLs to prevent memory leaks when images change or are removed.
     * This enables showing image thumbnails in the input area before sending.
     */
    useEffect(() => {
        if (imageFile && typeof window !== "undefined") {
            const objectUrl = URL.createObjectURL(imageFile)
            setImagePreviewUrl(objectUrl)
            return () => URL.revokeObjectURL(objectUrl)
        } else {
            setImagePreviewUrl("")
        }
    }, [imageFile])

    /**
     * COLLAPSED INPUT FOCUS MANAGEMENT EFFECT
     * Manages focus behavior for the collapsed input bar to ensure good UX.
     * Automatically focuses the input when component mounts or when appropriate,
     * but only in Preview/Export (not Canvas/Thumbnail) to avoid focus issues.
     * Resets focus pending state when expanding to allow expanded input focus.
     */
    useEffect(() => {
        if (
            !expanded &&
            initialFocusPendingRef.current &&
            collapsedInputRef.current &&
            RenderTarget.current() !== RenderTarget.canvas &&
            RenderTarget.current() !== RenderTarget.thumbnail
        ) {
            const activeEl =
                typeof document !== "undefined" ? document.activeElement : null
            if (
                activeEl === document.body ||
                !activeEl ||
                activeEl === collapsedInputRef.current.parentElement ||
                activeEl.closest('[data-layer="send-button-collapsed-wrapper"]')
            ) {
                collapsedInputRef.current.focus({ preventScroll: true })
            }
            initialFocusPendingRef.current = false
        } else if (expanded) {
            initialFocusPendingRef.current = true
        }
    }, [expanded])

    /**
     * EXPANDED INPUT FOCUS MANAGEMENT EFFECT
     * Handles focus transitions for the expanded textarea with smart timing.
     * Focuses the expanded input when:
     * - Chat overlay is first opened (justOpened)
     * - Message loading completes (justFinishedLoading)
     * Uses previous state refs to detect transitions and applies delayed focus
     * to ensure DOM is ready. Only operates in Preview/Export, not Canvas.
     */
    useEffect(() => {
        const wasExpanded = prevExpandedRef.current
        const wasLoading = prevIsLoadingRef.current

        if (
            expanded &&
            inputRef.current &&
            RenderTarget.current() !== RenderTarget.canvas &&
            RenderTarget.current() !== RenderTarget.thumbnail
        ) {
            const justOpened = !wasExpanded && expanded
            const justFinishedLoading = wasLoading && !isLoading

            if (justOpened || justFinishedLoading) {
                const timer = setTimeout(() => {
                    if (
                        inputRef.current &&
                        typeof document !== "undefined" &&
                        document.activeElement !== inputRef.current
                    ) {
                        inputRef.current.focus({ preventScroll: true })
                    }
                }, 100)
                return () => clearTimeout(timer)
            }
        }
        prevExpandedRef.current = expanded
        prevIsLoadingRef.current = isLoading
    }, [expanded, isLoading])

    /**
     * INITIAL SCROLL TO BOTTOM EFFECT
     * Scrolls to bottom of messages when overlay first opens.
     * Uses setTimeout to ensure DOM is fully rendered before scrolling.
     * Uses "auto" behavior for instant positioning on initial load.
     */
    useEffect(() => {
        if (expanded && messagesEndRef.current) {
            setTimeout(() => {
                messagesEndRef.current?.scrollIntoView({ behavior: "auto" })
            }, 0)
        }
    }, [expanded])

    /**
     * CONTINUOUS SCROLL TO BOTTOM EFFECT
     * Maintains scroll position at bottom during active conversations.
     * Triggers on new messages, streaming text, or new AI suggestions.
     * Uses smooth scrolling for better UX during ongoing conversations.
     * Only scrolls when there are actual messages (length > 1 excludes initial state).
     */
    useEffect(() => {
        if (
            expanded &&
            (messages.length > 1 ||
                streamed ||
                aiGeneratedSuggestions.length > 0) &&
            messagesEndRef.current
        ) {
            messagesEndRef.current.scrollIntoView({ behavior: "smooth" })
        }
    }, [messages, streamed, expanded, aiGeneratedSuggestions])

    /**
     * SYSTEM PROMPT & WELCOME MESSAGE UPDATE EFFECT
     * Dynamically updates the conversation when system prompt or welcome message changes.
     * Preserves user messages while updating the system context and welcome message.
     * Uses startTransition for smooth state updates to prevent blocking UI.
     * Carefully manages message ordering to maintain conversation continuity.
     */
    useEffect(() => {
        startTransition(() => {
            setMessages((prevMessages) => {
                const welcomeMsg = prevMessages.find(
                    (m) =>
                        m.role === "assistant" && m.content === welcomeMessage
                )
                const nonSystemUserMessages = prevMessages.filter(
                    (m) =>
                        m.role !== "system" && (!welcomeMsg || m !== welcomeMsg)
                )

                const newSystemMessage = {
                    role: "system",
                    content: systemPrompt || "You are a helpful assistant.",
                }

                const finalMessages = [newSystemMessage]
                if (welcomeMsg) {
                    finalMessages.push(welcomeMsg)
                }
                finalMessages.push(...nonSystemUserMessages)
                return finalMessages
            })
        })
    }, [systemPrompt, welcomeMessage])

    /**
     * TEXT-TO-SPEECH VOICE POPULATION EFFECT
     * Initializes and selects the best available TTS voice for speech synthesis.
     * Implements a sophisticated fallback strategy prioritizing:
     * 1. Neural voices (highest quality)
     * 2. Cloud-based voices (better than local)
     * 3. Default English voices
     * 4. Any available voice as last resort
     * Handles asynchronous voice loading with onvoiceschanged event listener.
     */
    useEffect(() => {
        const populate = () => {
            if (typeof window !== "undefined" && window.speechSynthesis) {
                const voices = window.speechSynthesis.getVoices()
                if (voices.length > 0) {
                    const pref =
                        voices.find(
                            (v) =>
                                v.lang === "en-US" &&
                                !v.localService &&
                                v.name.toLowerCase().includes("neural")
                        ) ||
                        voices.find(
                            (v) => v.lang === "en-US" && !v.localService
                        ) ||
                        voices.find((v) => v.lang === "en-US" && v.default) ||
                        voices.find((v) => v.lang === "en-US") ||
                        voices.find(
                            (v) => v.default && v.lang.startsWith("en")
                        ) ||
                        voices[0]
                    setSelectedVoice(pref || null)
                }
            }
        }
        if (typeof window !== "undefined" && window.speechSynthesis) {
            const vs = window.speechSynthesis.getVoices()
            if (
                vs.length === 0 &&
                window.speechSynthesis.onvoiceschanged !== undefined
            ) {
                window.speechSynthesis.onvoiceschanged = populate
            } else {
                populate()
            }
        }
        return () => {
            if (typeof window !== "undefined" && window.speechSynthesis) {
                window.speechSynthesis.onvoiceschanged = null
            }
        }
    }, [])

    /**
     * TEXT-TO-SPEECH CLEANUP EFFECT
     * Ensures proper cleanup of TTS resources when component unmounts.
     * Clears event listeners from current utterance, cancels any ongoing speech,
     * and resets speaking state to prevent memory leaks and state corruption.
     */
    useEffect(() => {
        const utt = utteranceRef.current
        return () => {
            if (utt) {
                utt.onend = null
                utt.onerror = null
            }
            if (
                typeof window !== "undefined" &&
                window.speechSynthesis &&
                window.speechSynthesis.speaking
            ) {
                window.speechSynthesis.cancel()
            }
            setSpeakingMessageIndex(null)
        }
    }, [])

    /**
     * TEXTAREA AUTO-RESIZE EFFECT
     * Dynamically adjusts textarea height based on content, images, and font settings.
     * Implements sophisticated sizing logic that:
     * 1. Calculates minimum height based on font size and line height
     * 2. Accounts for image preview space when present (48px + 8px gap)
     * 3. Respects maximum container height while allowing scrolling within bounds
     * 4. Handles various font configurations (px, em, unitless numbers)
     * 5. Ensures consistent UX across different font settings and content types
     * This creates a smooth, responsive input experience that adapts to content.
     */
    useEffect(() => {
        if (expanded && inputRef.current) {
            const txt = inputRef.current
            txt.style.height = "auto"
            let sH = txt.scrollHeight
            const imgP = imageFile && imagePreviewUrl
            const imgH = imgP ? 48 + 8 : 0

            let minTextareaHeight = 24
            if (globalFontStyles.fontSize) {
                const fontSizeNum = parseFloat(
                    globalFontStyles.fontSize as string
                )
                if (globalFontStyles.lineHeight) {
                    if (typeof globalFontStyles.lineHeight === "number") {
                        minTextareaHeight =
                            fontSizeNum * globalFontStyles.lineHeight
                    } else if (
                        typeof globalFontStyles.lineHeight === "string" &&
                        globalFontStyles.lineHeight.endsWith("px")
                    ) {
                        minTextareaHeight = parseFloat(
                            globalFontStyles.lineHeight
                        )
                    } else if (
                        typeof globalFontStyles.lineHeight === "string" &&
                        !isNaN(parseFloat(globalFontStyles.lineHeight))
                    ) {
                        minTextareaHeight =
                            fontSizeNum *
                            parseFloat(globalFontStyles.lineHeight)
                    } else {
                        minTextareaHeight =
                            fontSizeNum *
                            (typeof DEFAULT_FONT_INFO.lineHeight === "number"
                                ? DEFAULT_FONT_INFO.lineHeight
                                : 1.5)
                    }
                } else {
                    minTextareaHeight =
                        fontSizeNum *
                        (typeof DEFAULT_FONT_INFO.lineHeight === "number"
                            ? DEFAULT_FONT_INFO.lineHeight
                            : 1.5)
                }
            }
            minTextareaHeight = Math.max(minTextareaHeight, 24)

            const btnH = 36 + 12
            const pad = 12 * 2
            const totalMaxInputBoxHeight = 196

            const maxTextAndImageScrollAreaHeight =
                totalMaxInputBoxHeight - pad - btnH
            const maxTextareaHeight = maxTextAndImageScrollAreaHeight - imgH

            const cappedMaxTextareaHeight = Math.max(
                minTextareaHeight,
                maxTextareaHeight > 0 ? maxTextareaHeight : minTextareaHeight
            )

            if (sH > cappedMaxTextareaHeight) {
                sH = cappedMaxTextareaHeight
            } else if (sH < minTextareaHeight) {
                sH = minTextareaHeight
            }
            txt.style.height = `${sH}px`
        }
    }, [input, expanded, imageFile, imagePreviewUrl, globalFontStyles])

    /**
     * CLICK-OUTSIDE COLLAPSE EFFECT
     * Automatically collapses the expanded overlay when user clicks outside.
     * Implements smart exclusion logic to prevent accidental collapse when:
     * - Clicking on mobile backdrop (handled separately)
     * - Clicking on suggestion buttons (allows interaction)
     * Only active when overlay is expanded. Uses mousedown for immediate response.
     */
    useEffect(() => {
        if (!expanded || typeof document === "undefined") {
            return
        }
        const handleClickOutside = (event: MouseEvent) => {
            if (
                expandedOverlayRef.current &&
                !expandedOverlayRef.current.contains(event.target as Node) &&
                !(event.target as HTMLElement)?.closest(
                    '[data-layer="mobile-backdrop"]'
                ) &&
                !(event.target as HTMLElement)?.closest(
                    '[data-layer="suggested-replies-container"] button'
                )
            ) {
                handleCollapse()
            }
        }
        document.addEventListener("mousedown", handleClickOutside)
        return () => {
            document.removeEventListener("mousedown", handleClickOutside)
        }
    }, [expanded, handleCollapse])

    /**
     * MAIN MESSAGE SENDING FUNCTION
     * Core business logic for sending messages to Gemini API with full feature support.
     *
     * FEATURES HANDLED:
     * - Text message sending with optional image attachments
     * - Streaming response handling with real-time UI updates
     * - Request cancellation and error handling
     * - Image upload with base64 encoding
     * - AI suggestions generation after responses
     * - AbortController management for request cancellation
     *
     * FLOW:
     * 1. Input validation and preparation
     * 2. Image processing (if present)
     * 3. Message state updates and UI preparation
     * 4. API request with streaming response
     * 5. Response processing and state updates
     * 6. Error handling and cleanup
     *
     * @param overrideText - Optional text to send instead of current input (used by suggestions)
     */
    async function sendMessage(overrideText?: string) {
        // =========================================================================
        // INPUT VALIDATION & EARLY RETURNS
        // =========================================================================

        /** Prevent duplicate requests while one is in progress */
        if (isLoading) return

        /** Clear any existing AI suggestions when sending new message */
        setAiGeneratedSuggestions([])

        // =========================================================================
        // CONTENT PREPARATION
        // =========================================================================

        /** Use override text (from suggestions) or current input */
        const textToSend = overrideText || input

        /** Only send images with manual input, not with suggestion clicks */
        const imageFileToSend = overrideText ? null : imageFile

        /** Validate that we have content to send and required API key */
        if ((!textToSend.trim() && !imageFileToSend) || !geminiApiKey) {
            if (!geminiApiKey) setError("Gemini API key is required.")
            return
        }

        // =========================================================================
        // REQUEST SETUP & STATE INITIALIZATION
        // =========================================================================

        /** Cancel any existing request before starting new one */
        if (abortControllerRef.current) {
            abortControllerRef.current.abort()
        }

        /** Create new abort controller for this request */
        abortControllerRef.current = new AbortController()
        const signal = abortControllerRef.current.signal

        /** Update UI state to show loading and clear previous results */
        setIsLoading(true)
        setError("")
        setStreamed("")

        // =========================================================================
        // CONTENT PROCESSING & MESSAGE PREPARATION
        // =========================================================================

        /** Will hold the processed content for state updates (string or complex object) */
        let userContentForState: Message["content"]

        /** Handle different content types based on input method */
        if (overrideText) {
            /** Simple text content from suggestion clicks */
            userContentForState = overrideText
        } else if (imageFileToSend) {
            /** Complex content with both text and image - requires base64 processing */
                try {
                    /** Convert image file to base64 string for API transmission */
                    const base64 = await new Promise<string>((resolve, reject) => {
                        if (typeof window !== "undefined" && window.FileReader) {
                            const reader = new window.FileReader()
                            reader.onload = () => {
                                const result = reader.result as string
                                if (typeof result === "string") {
                                    /** Extract base64 data after comma (removes "data:image/jpeg;base64," prefix) */
                                    const base64str = result.substring(
                                        result.indexOf(",") + 1
                                    )
                                    resolve(base64str)
                                } else {
                                    reject(
                                        new Error(
                                            "Failed to read image as base64 string"
                                        )
                                    )
                                }
                            }
                            reader.onerror = reject
                            reader.readAsDataURL(imageFileToSend)
                        } else {
                            reject(new Error("FileReader API not available"))
                        }
                    })

                    /** Create multimodal content parts array for Gemini API */
                    const parts: Array<
                        | { type: "text"; text: string }
                        | { type: "image_url"; image_url: { url: string } }
                    > = []

                    /** Add text part if present */
                    if (textToSend.trim())
                        parts.push({ type: "text", text: textToSend })

                    /** Add image part with proper data URL format */
                    parts.push({
                        type: "image_url",
                        image_url: {
                            url: `data:${imageFileToSend.type};base64,${base64}`,
                        },
                    })
                    userContentForState = parts
                } catch (e: any) {
                    /** Handle image processing errors gracefully */
                    setError("Failed to process image. " + e.message)
                    setIsLoading(false)
                    abortControllerRef.current = null
                    return
                }
            } else {
                /** Simple text-only content */
                userContentForState = textToSend
            }

        // =========================================================================
        // MESSAGE STATE UPDATE & UI PREPARATION
        // =========================================================================

        /** Create the new user message object with processed content */
        const newUserMessage: Message = {
            role: "user",
            content: userContentForState,
        }

        /** Capture current messages state before async operations */
        const currentMessagesSnapshot = messages

        /** Update UI state with new message using React's concurrent features */
        startTransition(() => {
            /** Add new message to conversation history */
            setMessages((prev) => [...prev, newUserMessage])

            /** Clear input field after sending */
            setInput("")

            /** Clear image file if it was sent (or if using suggestion) */
            if (overrideText || imageFileToSend) {
                setImageFile(null)
                if (fileInputRef.current) fileInputRef.current.value = ""
            }

            /** Smooth scroll to show new message (delayed for DOM update) */
            setTimeout(() => {
                if (expanded && messagesEndRef.current)
                    messagesEndRef.current.scrollIntoView({
                        behavior: "smooth",
                    })
            }, 0)
        })

        // =========================================================================
        // API REQUEST PREPARATION & DATA TRANSFORMATION
        // =========================================================================

        /** Extract system message for special Gemini API handling */
        const systemInstructionMessage = currentMessagesSnapshot.find(
            (msg) => msg.role === "system"
        )

        /** Prepare conversation history for API (exclude system message, include new message) */
        const chatHistoryForApi = [
            ...currentMessagesSnapshot.filter(
                (m) => m.role === "user" || m.role === "assistant"
            ),
            newUserMessage,
        ]

        /**
         * TRANSFORM INTERNAL MESSAGE FORMAT TO GEMINI API FORMAT
         * Convert our Message[] structure to Gemini's expected {role, parts}[] format.
         * Handles complex multimodal content (text + images) and ensures proper data types.
         */
        const geminiContents = chatHistoryForApi.map((msg) => {
            /** Map internal roles to Gemini API roles */
            const role = msg.role === "assistant" ? "model" : "user"
            let parts: any[] = []

            if (Array.isArray(msg.content)) {
                /** Handle multimodal content (text + images) */
                parts = msg.content
                    .map((part) => {
                        if (part.type === "text") {
                            /** Convert text parts to Gemini format */
                            return { text: part.text }
                        }
                        if (part.type === "image_url" && part.image_url?.url) {
                            /** Convert image parts to Gemini's inlineData format */
                            const [header, base64Data] =
                                part.image_url.url.split(",")
                            if (!base64Data) {
                                console.warn(
                                    "Invalid image_url format:",
                                    part.image_url.url
                                )
                                return null
                            }
                            /** Extract MIME type from data URL header */
                            const mimeTypeMatch =
                                header.match(/data:(.*);base64/)
                            const mimeType = mimeTypeMatch
                                ? mimeTypeMatch[1]
                                : "image/jpeg"
                            return {
                                inlineData: { mimeType, data: base64Data },
                            }
                        }
                        return null
                    })
                    .filter(Boolean) /** Remove any null entries */
            } else if (typeof msg.content === "string") {
                /** Handle simple text-only messages */
                parts = [{ text: msg.content }]
            }

            /** Ensure every message has at least one part (Gemini requirement) */
            if (parts.length === 0 && (role === "user" || role === "model")) {
                parts.push({ text: "" })
            }
            return { role, parts }
        })

        /** Construct the final Gemini API payload */
        const geminiPayload: any = {
            contents: geminiContents,
        }

        /** Add system instruction if present (special Gemini API feature) */
        if (
            systemInstructionMessage &&
            typeof systemInstructionMessage.content === "string" &&
            systemInstructionMessage.content.trim() !== ""
        ) {
            geminiPayload.systemInstruction = {
                parts: [{ text: systemInstructionMessage.content }],
            }
        }

        // =========================================================================
        // API REQUEST EXECUTION & STREAMING RESPONSE HANDLING
        // =========================================================================

        try {
            /** Construct streaming API endpoint URL with authentication */
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${geminiApiKey}&alt=sse`

            /** Make the streaming request with abort signal for cancellation support */
            const response = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(geminiPayload),
                signal,
            })

            if (!response.ok) {
                let errMsg = `API error: ${response.status}`
                if (!signal.aborted) {
                    try {
                        const errData = await response.json()
                        errMsg =
                            errData?.error?.message ||
                            JSON.stringify(errData.error) ||
                            errMsg
                    } catch (pE) {
                        try {
                            errMsg = (await response.text()) || errMsg
                        } catch (tE) {}
                    }
                    setError(errMsg.substring(0, 300))
                }
            } else if (!response.body && !signal.aborted) {
                throw new Error("No response body from API.")
            } else if (response.body) {
                const reader = response.body.getReader()
                let fullResp = ""
                let firstChunk = true
                const decoder = new TextDecoder()

                while (true) {
                    if (signal.aborted) {
                        setStreamed("")
                        break
                    }
                    const { value, done } = await reader.read()
                    if (done) break

                    const chunk = decoder.decode(value, { stream: true })
                    const lines = chunk.split("\n")
                    for (const line of lines) {
                        if (line.startsWith("data: ")) {
                            try {
                                const jsonStr = line.substring(5).trim()
                                if (!jsonStr) continue

                                const json = JSON.parse(jsonStr)

                                const candidate = json.candidates?.[0]
                                if (
                                    candidate?.finishReason &&
                                    candidate.finishReason !== "STOP" &&
                                    candidate.finishReason !== "MAX_TOKENS"
                                ) {
                                    console.error(
                                        "Streaming error from API:",
                                        candidate.finishReason,
                                        json
                                    )
                                    let displayError = `API Error: ${candidate.finishReason}`
                                    if (json.promptFeedback?.blockReason) {
                                        displayError = `Blocked: ${json.promptFeedback.blockReason}`
                                    } else if (
                                        candidate.safetyRatings?.some(
                                            (r: any) => r.blocked
                                        )
                                    ) {
                                        displayError = `Blocked due to safety settings.`
                                    }
                                    setError(displayError)
                                    fullResp = ""
                                    setStreamed("")
                                    setIsLoading(false)
                                    return
                                }

                                let delta =
                                    candidate?.content?.parts?.[0]?.text || ""
                                if (firstChunk && delta) {
                                    delta = delta.trimStart()
                                    if (delta) firstChunk = false
                                }
                                if (delta) {
                                    fullResp += delta
                                    startTransition(() =>
                                        setStreamed((prev) => prev + delta)
                                    )
                                }
                            } catch (e) {
                                console.error(
                                    "Error parsing streaming chunk:",
                                    e,
                                    "Chunk part:",
                                    line
                                )
                            }
                        }
                    }
                }

                if (!signal.aborted && fullResp.trim()) {
                    startTransition(() => {
                        setMessages((prev) => [
                            ...prev,
                            { role: "assistant", content: fullResp.trim() },
                        ])
                        setStreamed("")
                    })
                    if (enableAiSuggestions) {
                        fetchAiSuggestions(fullResp.trim())
                    }
                } else if (
                    !signal.aborted &&
                    !error &&
                    !fullResp.trim() &&
                    streamed.trim() === ""
                ) {
                    setStreamed("")
                } else if (signal.aborted) {
                    setStreamed("")
                }
            }
        } catch (e: any) {
            if (e.name === "AbortError") {
                setStreamed("")
            } else if (!error) {
                setError(e?.message || "Error contacting Gemini API")
                setStreamed("")
            }
        } finally {
            setIsLoading(false)
            abortControllerRef.current = null
        }
    }

    // =========================================================================
    // Event Handlers & User Interactions
    // =========================================================================

    /**
     * INPUT CHANGE HANDLER
     * Updates the input state as user types in either collapsed or expanded input fields.
     * Connected to both the collapsed input bar and expanded textarea for consistent behavior.
     */
    const handleInput = (
        e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
    ) => {
        setInput(e.target.value)
    }

    /**
     * EXPANDED VIEW KEYBOARD HANDLER
     * Handles Enter key in expanded textarea to send messages.
     * Shift+Enter creates new lines, Enter alone sends the message.
     * Includes loading state check to prevent duplicate requests.
     */
    const handleExpandedViewKeyDown = (
        e: React.KeyboardEvent<HTMLTextAreaElement>
    ) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault()
            if (!isLoading && (input.trim() || imageFile)) sendMessage()
        }
    }

    /**
     * EXPANDED VIEW SEND BUTTON HANDLER
     * Triggered when user clicks the send button in expanded view.
     * Validates content availability and loading state before sending.
     */
    const handleExpandedViewSendClick = () => {
        if (!isLoading && (input.trim() || imageFile)) sendMessage()
    }

    /**
     * AI SUGGESTION CLICK HANDLER
     * Handles clicks on AI-generated contextual reply suggestions.
     * Sends the suggestion text as a new message, enabling conversational flow.
     * Clears suggestions after sending to prevent UI clutter.
     */
    const handleSuggestionClick = (suggestionText: string) => {
        if (!isLoading && suggestionText.trim()) {
            sendMessage(suggestionText)
        }
    }

    /**
     * IMAGE FILE SELECTION HANDLER
     * Processes image file selection from the hidden file input.
     * Automatically expands the overlay if collapsed, enabling multimodal input.
     * Clears AI suggestions when image is selected to prevent context confusion.
     */
    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files && e.target.files[0]
        setImageFile(file || null)
        setAiGeneratedSuggestions([])
        if (!expanded && file) handleExpand()
    }

    /**
     * IMAGE REMOVAL HANDLER
     * Removes selected image from the input area.
     * Stops event propagation to prevent triggering parent click handlers.
     * Resets file input value to allow re-selection of the same file.
     */
    const handleRemoveImage = (e: React.MouseEvent<HTMLDivElement>) => {
        e.stopPropagation()
        setImageFile(null)
        if (fileInputRef.current) fileInputRef.current.value = ""
    }
    // =========================================================================
    // Text-to-Speech (TTS) Functions
    // =========================================================================

    /**
     * TEXT-TO-SPEECH PLAYBACK HANDLER
     * Converts text messages to speech using Web Speech API.
     * Provides audio accessibility for visually impaired users and enhances UX.
     *
     * FEATURES:
     * - Intelligent pause/resume: clicking same message stops playback
     * - Markdown stripping: cleans formatting for natural speech
     * - Voice optimization: uses selected neural/cloud voice with tuned parameters
     * - Error handling: gracefully handles TTS failures
     * - State management: tracks which message is currently speaking
     *
     * @param text - Raw message text (may contain markdown)
     * @param index - Message index for state tracking and UI feedback
     */
    const handlePlayTTS = (text: string, index: number) => {
        // Validate TTS availability and voice selection
        if (
            typeof window !== "undefined" &&
            window.speechSynthesis &&
            selectedVoice
        ) {
            // Handle play/pause toggle: if clicking same message, stop playback
            if (window.speechSynthesis.speaking) {
                window.speechSynthesis.cancel()
                if (speakingMessageIndex === index) {
                    setSpeakingMessageIndex(null)
                    utteranceRef.current = null
                    return
                }
            }

            // Clean markdown formatting for natural speech synthesis
            const cleanedText = stripMarkdownForTTS(text)

            // Create and configure speech utterance
            utteranceRef.current = new SpeechSynthesisUtterance(cleanedText)
            utteranceRef.current.voice = selectedVoice
            utteranceRef.current.rate = 1.1      // Slightly faster than default for better UX
            utteranceRef.current.pitch = 1.0     // Natural pitch
            utteranceRef.current.volume = 1.0     // Full volume

            // Handle successful speech completion
            utteranceRef.current.onend = () => {
                setSpeakingMessageIndex(null)
                utteranceRef.current = null
            }

            // Handle speech synthesis errors
            utteranceRef.current.onerror = (event) => {
                console.error("SpeechSynthesisUtterance.onerror:", event)
                setSpeakingMessageIndex(null)
                utteranceRef.current = null
            }

            // Start speech synthesis and update UI state
            window.speechSynthesis.speak(utteranceRef.current)
            setSpeakingMessageIndex(index)
        } else if (!selectedVoice && typeof window !== "undefined") {
            console.error("TTS voice not available.")
        }
    }
    /**
     * TEXT-TO-SPEECH STOP HANDLER
     * Immediately stops any ongoing speech synthesis.
     * Used by stop buttons in the UI and cleanup functions.
     * Ensures proper state reset and resource cleanup.
     */
    const handleStopTTS = () => {
        if (typeof window !== "undefined" && window.speechSynthesis) {
            window.speechSynthesis.cancel()
        }
        setSpeakingMessageIndex(null)
        utteranceRef.current = null
    }

    // =========================================================================
    // Layout & Positioning Calculations
    // =========================================================================

    /**
     * DESKTOP OVERLAY POSITIONING
     * Defines the layout for expanded overlay on desktop screens.
     * Fixed dimensions with centered positioning and dynamic bottom offset
     * to avoid overlapping with collapsed input bar.
     */
    const finalDesktopPosStyle: CSSProperties = {
        width: 760,                                    // Fixed width for desktop
        height: 540,                                   // Fixed height for desktop
        bottom: `${expandedViewBottomOffset}px`,       // Dynamic offset from bottom
        left: "50%",                                   // Center horizontally
        borderRadius: `${universalBorderRadius}px`,    // Configurable corner radius
    }

    /**
     * MOBILE OVERLAY POSITIONING
     * Defines full-screen layout for mobile devices.
     * Uses viewport units for responsive sizing and bottom-aligned positioning.
     * Top corners rounded to create modal-like appearance.
     */
    const finalMobilePosStyle: CSSProperties = {
        width: "100vw",                                // Full viewport width
        height: "95dvh",                               // 95% of viewport height (leaves space for browser UI)
        bottom: "0",                                   // Align to bottom of screen
        left: "0",                                     // Align to left edge
        borderRadius: `${universalBorderRadius}px ${universalBorderRadius}px 0px 0px`, // Rounded top corners only
    }

    /**
     * RESPONSIVE POSITION STYLE SELECTION
     * Chooses appropriate positioning based on current viewport.
     * Dynamically switches between desktop and mobile layouts.
     */
    const finalPosStylesToApply = isMobileView
        ? finalMobilePosStyle
        : finalDesktopPosStyle

    // =========================================================================
    // Dynamic Visual Effects & Backdrop Calculations
    // =========================================================================

    /**
     * BACKDROP BLUR INTENSITY CALCULATION
     * Dynamically adjusts backdrop blur based on background opacity.
     * More transparent backgrounds need stronger blur for better readability.
     * Creates depth and focus without being computationally expensive.
     */
    const alpha = getAlphaFromColorString(chatAreaBackground)
    let backdropBlurValue = "8px"                    // Default blur for opaque backgrounds
    if (alpha <= 0.7) backdropBlurValue = "32px"     // Strong blur for very transparent backgrounds
    else if (alpha <= 0.84) backdropBlurValue = "24px" // Medium blur for semi-transparent
    else if (alpha <= 0.94) backdropBlurValue = "16px" // Light blur for mostly opaque

    // =========================================================================
    // Animation Variants & Motion Configuration
    // =========================================================================

    /**
     * FRAMER MOTION ANIMATION VARIANTS
     * Defines smooth enter/exit animations for the overlay.
     * Uses spring physics for natural, bouncy feel.
     * Desktop: slides down from top, Mobile: slides up from bottom.
     * Includes transform origin compensation for centered desktop layout.
     */
    const overlayVariants = {
        open: {
            opacity: 1,
            y: 0,                                       // No vertical offset when open
            x:
                finalPosStylesToApply.left === "50%" && !isMobileView
                    ? "-50%"                             // Center horizontally on desktop
                    : "0%",                             // No horizontal offset on mobile
            transition: { type: "spring", stiffness: 350, damping: 30 }, // Smooth, responsive spring
        },
        closed: {
            opacity: 0,
            y: isMobileView ? "100%" : 60,              // Mobile: slide down off-screen, Desktop: slide up slightly
            x:
                finalPosStylesToApply.left === "50%" && !isMobileView
                    ? "-50%"                             // Maintain horizontal centering
                    : "0%",
            transition: { type: "spring", stiffness: 350, damping: 35 }, // Slightly more damped for exit
        },
    }

    // =========================================================================
    // Asset & Icon Handling
    // =========================================================================

    /** Safely extract icon URLs with null coalescing for optional custom icons */
    const safeSendIconUrl = sendIconOverrideUrl?.src
    const safeLoadingIconUrl = loadingIconOverrideUrl?.src

    // =========================================================================
    // Typography & Text Styling
    // =========================================================================

    /**
     * BASE MARKDOWN TEXT STYLE
     * Foundation styling for all rendered message content.
     * Inherits global font settings and applies consistent color.
     * Word-wrap ensures long URLs and text don't overflow containers.
     */
    const markdownBaseTextStyle: CSSProperties = {
        ...globalFontStyles,                            // Inherit font family, size, weight, etc.
        color: props.textColor,                         // User-configurable text color
        wordWrap: "break-word",                         // Break long words to prevent overflow
    }

    /**
     * MARKDOWN LINK STYLE
     * Styling for clickable links within message content.
     * Uses user-configurable link color with underline for accessibility.
     * Maintains readability while being clearly identifiable as interactive.
     */
    const markdownLinkStyle: CSSProperties = {
        color: props.linkColor,                         // User-configurable link color
        textDecoration: "underline",                    // Standard underline for link indication
    }

    /**
     * ERROR MESSAGE TEXT STYLE
     * Specialized styling for error messages with reduced font size.
     * Makes errors visually distinct without being overwhelming.
     * Scales down from base font size while maintaining minimum readability.
     */
    const errorFontStyle: CSSProperties = {
        ...globalFontStyles,
        fontSize:
            typeof globalFontStyles.fontSize === "string"
                ? `${Math.max(parseFloat(globalFontStyles.fontSize) * 0.875, 12)}px` // 87.5% of base size, min 12px
                : "14px",                             // Fallback for non-string font sizes
    }

    // =========================================================================
    // Suggestion System Logic & Display Conditions
    // =========================================================================

    /**
     * STATIC SUGGESTIONS PREPARATION
     * Filters out empty suggestion props and prepares them for display.
     * Only shows suggestions that have actual content after trimming whitespace.
     */
    const staticSuggestedReplies = [
        suggestedReply1,
        suggestedReply2,
        suggestedReply3,
    ].filter((reply) => reply && reply.trim() !== "")

    /**
     * COMMON SUGGESTION DISPLAY CONDITIONS
     * Shared prerequisites for showing any type of suggestions.
     * Suggestions only appear when overlay is expanded, not loading, and no image is selected.
     */
    const commonSuggestionDisplayConditions =
        expanded && !isLoading && !imageFile

    /**
     * AI-GENERATED SUGGESTIONS DISPLAY CONDITION
     * Shows AI-generated contextual suggestions when:
     * - AI suggestions are enabled
     * - AI suggestions are available
     * - Common display conditions are met
     */
    const showAiSuggestions =
        enableAiSuggestions &&
        aiGeneratedSuggestions.length > 0 &&
        commonSuggestionDisplayConditions

    /**
     * STATIC PROP SUGGESTIONS DISPLAY CONDITION
     * Shows designer-configured suggestions when:
     * - AI suggestions are not being shown
     * - Static suggestions are available
     * - No user messages exist yet (welcome context)
     * - Common display conditions are met
     */
    const showPropSuggestions =
        !showAiSuggestions &&
        staticSuggestedReplies.length > 0 &&
        messages.filter((m) => m.role === "user").length === 0 &&
        commonSuggestionDisplayConditions

    /**
     * SUGGESTION PRIORITY & SELECTION LOGIC
     * Determines which suggestions to display based on availability and context.
     * AI suggestions take priority over static suggestions for better UX.
     */
    let displayedSuggestions: string[] = []
    if (showAiSuggestions) {
        displayedSuggestions = aiGeneratedSuggestions
    } else if (showPropSuggestions) {
        displayedSuggestions = staticSuggestedReplies
    }

    /** Whether to render the suggestions area based on available suggestions */
    const showSuggestionsArea = displayedSuggestions.length > 0

    // =========================================================================
    // Button & Interactive Element Styling
    // =========================================================================

    /**
     * SUGGESTION BUTTON STYLE CONFIGURATION
     * Defines the visual appearance of suggestion buttons.
     * Features responsive font sizing, transparent background with colored border,
     * and optimized layout for various suggestion text lengths.
     *
     * KEY FEATURES:
     * - Responsive font size (90% of base, minimum 13px)
     * - Dynamic border color with opacity for visual consistency
     * - Flexible layout with word wrapping for long suggestions
     * - Smooth hover transitions for better UX
     * - Consistent spacing and alignment
     */
    const suggestedReplyButtonStyle: CSSProperties = {
        ...globalFontStyles,                           // Inherit base font properties
        fontSize:
            typeof globalFontStyles.fontSize === "string"
                ? `${Math.max(parseFloat(globalFontStyles.fontSize as string) * 0.9, 13)}px` // 90% of base size, min 13px
                : "13px",                              // Fallback for numeric font sizes
        lineHeight: globalFontStyles.lineHeight || "1.4em", // Consistent line height
        color: iconColor,                             // Use icon color for text
        backgroundColor: "transparent",               // Transparent background
        padding: "8px 12px",                         // Balanced padding
        borderRadius: `${universalBorderRadius}px`,   // Configurable corner radius
        border: `1px solid ${iconColor ? iconColor.replace(/rgba?\((\d+,\s*\d+,\s*\d+)(?:,\s*[\d.]+)?\)/, "rgba($1, 0.25)") : "rgba(0,0,0,0.25)"}`,
                                                        // Dynamic border color with 25% opacity
        cursor: "pointer",                            // Pointer cursor for interactivity
        textAlign: "center",                          // Center-aligned text
        whiteSpace: "normal",                         // Allow text wrapping
        maxWidth: "180px",                            // Maximum width constraint
        minWidth: "max-content",                      // Minimum width based on content
        minHeight: "39px",                            // Minimum touch target height
        wordBreak: "break-word",                      // Break long words
        display: "inline-flex",                       // Flexible inline layout
        alignItems: "center",                         // Vertical center alignment
        justifyContent: "center",                     // Horizontal center alignment
        flexShrink: 0,                                // Prevent shrinking
        transition: "background-color 0.2s ease, border-color 0.2s ease", // Smooth hover effects
    }

    // =========================================================================
    // Layout Container Styling
    // =========================================================================

    /**
     * SUGGESTIONS CONTAINER STYLE
     * Horizontal scrolling container for suggestion buttons.
     * Optimized for touch interaction with hidden scrollbars.
     * Provides smooth scrolling experience on both desktop and mobile.
     */
    const suggestionsContainerStyle: CSSProperties = {
        display: "flex",                                // Horizontal flex layout
        flexWrap: "nowrap",                            // Prevent wrapping to single row
        gap: "8px",                                    // Consistent spacing between buttons
        padding: "8px 12px 12px 12px",                 // Balanced padding (more bottom padding)
        justifyContent: "flex-start",                   // Left-aligned buttons
        alignItems: "stretch",                          // Stretch to consistent height
        overflowX: "auto",                             // Horizontal scrolling for overflow
        scrollbarWidth: "none",                        // Hide scrollbars (Firefox)
        WebkitOverflowScrolling: "touch",              // Smooth touch scrolling (iOS)
        flexShrink: 0,                                 // Prevent shrinking
        position: "relative",                          // Positioning context
    }

    /**
     * MESSAGES SCROLL CONTAINER STYLE
     * Main scrolling area for chat messages with optimized spacing.
     * Uses flexbox column layout with proper gap between messages.
     * Contains overscroll behavior to prevent background scroll.
     */
    const messagesScrollContainerStyle: CSSProperties = {
        flexGrow: 1,                                   // Take remaining vertical space
        overflowY: "auto",                             // Vertical scrolling only
        paddingTop: 12,                                // Top padding for visual balance
        paddingLeft: 12,                               // Left padding for content margin
        paddingRight: 12,                              // Right padding for content margin
        paddingBottom: 8,                              // Bottom padding before input area
        display: "flex",                               // Flex layout for message stacking
        flexDirection: "column",                       // Vertical stacking of messages
        gap: 24,                                       // Generous gap between messages
        overscrollBehavior: "contain",                 // Prevent scroll propagation
        position: "relative",                          // Positioning context
    }

    /**
     * INPUT AREA FRAME STYLE
     * Container for the input area with consistent layout structure.
     * Centers content and provides proper spacing for input elements.
     * Acts as the foundation for the input bar in both collapsed and expanded states.
     */
    const inputAreaFrameStyle: CSSProperties = {
        width: "100%",                                 // Full width container
        flexShrink: 0,                                 // Prevent shrinking
        display: "flex",                               // Flex layout for input elements
        flexDirection: "column",                       // Vertical stacking
        alignItems: "center",                          // Center-aligned content
        gap: 8,                                        // Spacing between input elements
        position: "relative",                          // Positioning context
    }

    /**
     * DRAG INDICATOR BAR STYLE
     * Visual drag handle for mobile gesture-based overlay collapse.
     * Provides visual feedback and proper touch interaction area.
     * Centers the drag indicator (three dots) and prevents accidental scrolling.
     */
    const dragIndicatorBarStyle: CSSProperties = {
        width: "100%",                                 // Full width container
        height: 16,                                    // Fixed height for touch target
        paddingTop: 5,                                 // Top padding for visual balance
        paddingBottom: 5,                              // Bottom padding for visual balance
        position: "relative",                          // Positioning context
        flexShrink: 0,                                 // Prevent shrinking
        cursor: "grab",                                // Visual cursor for drag interaction
        display: "flex",                               // Flex layout for centering
        justifyContent: "center",                      // Horizontal center alignment
        alignItems: "center",                          // Vertical center alignment
        touchAction: "none",                          // Prevent default touch behaviors
    }

    const placeholderStyleTagContent = `
      .chat-overlay-collapsed-input::placeholder {
          color: ${placeholderTextColor};
          opacity: 1; /* Firefox */
      }
      .chat-overlay-collapsed-input::-webkit-input-placeholder {
          color: ${placeholderTextColor};
      }
      .chat-overlay-collapsed-input::-moz-placeholder { /* Mozilla Firefox 19+ */
          color: ${placeholderTextColor};
          opacity: 1;
      }
      .chat-overlay-collapsed-input:-ms-input-placeholder { /* Internet Explorer 10-11 */
          color: ${placeholderTextColor};
      }
      .chat-overlay-collapsed-input::-ms-input-placeholder { /* Microsoft Edge */
          color: ${placeholderTextColor};
      }
  `
    // =========================================================================
    // Pointer/Touch Gesture Handlers
    // =========================================================================

    /**
     * POINTER MOVE GESTURE HANDLER
     * Processes pointer movement during mobile drag gestures.
     * Detects when user has dragged far enough to initiate overlay collapse.
     * Uses a 5px threshold to distinguish between scrolling and drag-to-close.
     *
     * @param event - Pointer event with client coordinates
     */
    const handleContainerPointerMove = (event: PointerEvent) => {
        // Ignore if no gesture is in progress or already dragging
        if (!gestureStartRef.current || gestureStartRef.current.isDragging)
            return

        const startY = gestureStartRef.current.y
        const currentY = event.clientY
        const deltaY = currentY - startY

        // If dragged down more than 5px, initiate drag-to-close
        if (deltaY > 5) {
            gestureStartRef.current.isDragging = true
            dragControls.start(event)                    // Start Framer Motion drag
            handleContainerPointerUp()                   // Clean up event listeners
        }
    }

    /**
     * POINTER UP GESTURE CLEANUP HANDLER
     * Cleans up event listeners and resets gesture state.
     * Called when pointer is released or gesture is cancelled.
     * Ensures no memory leaks and proper state management.
     */
    const handleContainerPointerUp = () => {
        window.removeEventListener("pointermove", handleContainerPointerMove)
        window.removeEventListener("pointerup", handleContainerPointerUp)
        window.removeEventListener("pointercancel", handleContainerPointerUp)
        gestureStartRef.current = null                 // Reset gesture state
    }

    /**
     * POINTER DOWN GESTURE INITIALIZER
     * Initiates mobile drag-to-close gesture when user touches the scroll container.
     * Only activates when:
     * - Device is mobile (not desktop)
     * - Primary button (left mouse/touch) is pressed
     * - Scroll container is at the top (scrollTop === 0)
     * This prevents gesture conflicts with scrolling through messages.
     *
     * @param event - React pointer event from the scroll container
     */
    const handleContainerPointerDown = (event: React.PointerEvent) => {
        // Only handle primary button on mobile devices
        if (!isMobileView || event.button !== 0) return

        // Only initiate gesture if scrolled to top (prevents scroll conflict)
        if (
            scrollContainerRef.current &&
            scrollContainerRef.current.scrollTop === 0
        ) {
            // Initialize gesture state
            gestureStartRef.current = { y: event.clientY, isDragging: false }

            // Set up event listeners for gesture tracking
            window.addEventListener("pointermove", handleContainerPointerMove)
            window.addEventListener("pointerup", handleContainerPointerUp)
            window.addEventListener("pointercancel", handleContainerPointerUp)
        }
    }

    /**
     * GESTURE HANDLER CLEANUP EFFECT
     * Ensures gesture event listeners are cleaned up when component unmounts.
     * Prevents memory leaks and stale event listeners in React's cleanup phase.
     */
    useEffect(() => {
        return () => {
            handleContainerPointerUp()
        }
    }, [])

    // =========================================================================
    // MAIN COMPONENT RENDER - EXPANDED VIEW
    // =========================================================================

    /**
     * EXPANDED CHAT INTERFACE RENDER
     * The full-screen chat experience when the overlay is expanded.
     * Features mobile backdrop, gesture-based drag-to-close, message history,
     * streaming responses, AI suggestions, and rich input area.
     */
    if (expanded) {
        return (
            <Fragment>
                {/* MOBILE BACKDROP - Only shown on mobile for modal-like experience */}
                {isMobileView && (
                    <motion.div
                        data-layer="mobile-backdrop"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: expanded ? 1 : 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.25, ease: "easeOut" }}
                        style={{
                            position: "fixed",
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            background: "rgba(0, 0, 0, 0.7)", // Semi-transparent dark overlay
                            zIndex: 999,                       // Below overlay but above page content
                        }}
                        onClick={handleCollapse}               // Clicking backdrop closes overlay
                    />
                )}
                {/* MAIN EXPANDED OVERLAY CONTAINER */}
                <motion.div
                    ref={expandedOverlayRef}
                    data-layer="expanded-chat-overlay-root"
                    variants={overlayVariants}
                    initial="closed"
                    animate={expanded ? "open" : "closed"}
                    drag="y"
                    dragControls={dragControls}
                    dragListener={false}
                    dragConstraints={{
                        top: 0,
                        bottom: DRAG_CLOSE_THRESHOLD_Y + 100,
                    }}
                    onDragEnd={(event, info) => {
                        if (
                            info.offset.y > DRAG_CLOSE_THRESHOLD_Y ||
                            info.velocity.y > 300
                        ) {
                            handleCollapse()
                        }
                    }}
                    style={{
                        ...finalPosStylesToApply,
                        position: "fixed",
                        zIndex: 1000,
                        display: "flex",
                        flexDirection: "column",
                        background: chatAreaBackground,
                        backdropFilter: `blur(${backdropBlurValue})`,
                        WebkitBackdropFilter: `blur(${backdropBlurValue})`,
                        boxShadow: shadow
                            ? "0px 8px 24px rgba(0, 0, 0, 0.1)"
                            : "none",
                        overflow: "hidden",
                        maxWidth: "100vw",
                    }}
                >
                    {/* DRAG INDICATOR BAR - Mobile gesture handle */}
                    <div
                        data-layer="drag-indicator-bar"
                        style={dragIndicatorBarStyle}
                        onPointerDown={(event: React.PointerEvent) => {
                            dragControls.start(event)                    // Start drag gesture
                            ;(event.currentTarget as HTMLElement).style.cursor =
                                "grabbing"                             // Visual feedback
                        }}
                        onPointerUp={(event: React.PointerEvent) => {
                            ;(event.currentTarget as HTMLElement).style.cursor =
                                "grab"                                 // Reset cursor
                        }}
                        onClick={() => {
                            if (expanded) {
                                handleCollapse()                         // Clicking also closes
                            }
                        }}
                    >
                        {/* SVG DRAG INDICATOR - Three dots visual cue */}
                        <svg
                            width="32"
                            height="5"
                            viewBox="0 0 32 5"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                        >
                            <rect
                                width="32"
                                height="5"
                                rx={Math.min(universalBorderRadius, 4)} // Rounded corners, max 4px
                                fill={props.iconColor}
                                style={{ opacity: 0.65 }}             // Subtle appearance
                            />
                        </svg>
                    </div>

                    {/* MESSAGES SCROLL CONTAINER - Main chat area */}
                    <div
                        ref={scrollContainerRef}
                        onPointerDown={handleContainerPointerDown}     // Mobile drag gesture handler
                        data-layer="messages-scroll-container"
                        style={messagesScrollContainerStyle}
                    >
                        {/* ERROR MESSAGE DISPLAY */}
                        {error && (
                            <div
                                style={{
                                    ...errorFontStyle,                       // Specialized error styling
                                    padding: 12,
                                    background: "rgba(255,0,0,0.1)",         // Subtle red background
                                    color: "rgb(180,0,0)",                   // Dark red text
                                    borderRadius: "8px",
                                    wordWrap: "break-word",                  // Break long error messages
                                    textAlign: "left",
                                }}
                            >
                                {error}
                            </div>
                        )}
                        {/* MESSAGE HISTORY RENDERING */}
                        {messages
                            .filter((m) => m.role !== "system")      // Exclude system messages from display
                            .map((message, msgIndex) => {
                                const isUser = message.role === "user"
                                const isAssistant = message.role === "assistant"

                                // USER MESSAGE RENDERING
                                if (isUser) {
                                    // Normalize content to handle both simple strings and complex multimodal content
                                    const userContentParts = Array.isArray(
                                        message.content
                                    )
                                        ? message.content                    // Already in parts format
                                        : [
                                              {
                                                  type: "text",
                                                  text: message.content as string, // Convert simple string to parts format
                                              },
                                          ]
                                    // Extract image and text content from multimodal message parts
                                    const userImageURL = (
                                        userContentParts.find(
                                            (item) => item.type === "image_url"
                                        ) as
                                            | {
                                                  type: "image_url"
                                                  image_url: { url: string }
                                              }
                                            | undefined
                                    )?.image_url.url                              // Get image URL if present

                                    const userTextContent =
                                        (
                                            userContentParts.find(
                                                (item) => item.type === "text"
                                            ) as
                                                | { type: "text"; text: string }
                                                | undefined
                                        )?.text || ""                            // Get text content, default to empty string

                                    return (
                                        <div
                                            key={`user-${msgIndex}`}
                                            data-layer="user-input-message"
                                            style={{
                                                alignSelf: "flex-end",             // Right-align user messages
                                                display: "flex",
                                                flexDirection: "column",           // Stack image above text
                                                alignItems: "flex-end",            // Right-align content
                                                gap: 4,                            // Small gap between elements
                                                maxWidth: "90%",                   // Prevent overly wide messages
                                            }}
                                        >
                                            {/* USER IMAGE DISPLAY - If message contains image */}
                                            {userImageURL && (
                                                <img
                                                    data-layer="user-sent-image"
                                                    style={{
                                                        width: 76,                          // Fixed width for consistency
                                                        maxHeight: 96,                      // Max height with aspect ratio
                                                        objectFit: "contain",               // Maintain aspect ratio
                                                        background:
                                                            props.chatAreaBackground,       // Match chat background
                                                        borderRadius: 13.33,                // Rounded corners
                                                        border: `0.67px solid ${props.iconColor ? props.iconColor.replace(/rgba?\((\d+,\s*\d+,\s*\d+)(?:,\s*[\d.]+)?\)/, "rgba($1, 0.20)") : "rgba(0,0,0,0.20)"}`,
                                                                    // Subtle border with opacity
                                                    }}
                                                    src={userImageURL}
                                                    alt="User upload"
                                                />
                                            )}
                                            {/* USER TEXT BUBBLE - If message has text content */}
                                            {userTextContent && (
                                                <div
                                                    data-layer="user-message-bubble"
                                                    style={{
                                                        maxWidth: 336,                        // Max width for readability
                                                        paddingLeft: 12,
                                                        paddingRight: 12,
                                                        paddingTop: 8,
                                                        paddingBottom: 8,
                                                        background:
                                                            props.userMessageBackgroundColor, // User-configurable background
                                                        borderRadius: `${universalBorderRadius}px`, // Configurable corner radius
                                                        display: "inline-flex",              // Shrink to content
                                                    }}
                                                >
                                                    <div
                                                        data-layer="user-message-text"
                                                        style={{
                                                            ...globalFontStyles,               // Inherit font settings
                                                            color: props.textColor,            // User-configurable text color
                                                            wordWrap:
                                                                "break-word",                 // Break long words
                                                            whiteSpace:
                                                                "pre-wrap",                   // Preserve line breaks
                                                        }}
                                                    >
                                                        {userTextContent}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )
                                // ASSISTANT MESSAGE RENDERING
                                } else if (isAssistant) {
                                    return (
                                        <div
                                            key={`assistant-${msgIndex}`}
                                            data-layer="assistant-message"
                                            style={{
                                                alignSelf: "stretch",               // Full width for assistant messages
                                                display: "flex",
                                                flexDirection: "column",            // Stack content vertically
                                                alignItems: "flex-start",           // Left-align content
                                                gap: 12,                            // Gap between text and action buttons
                                            }}
                                        >
                                            {/* ASSISTANT MESSAGE TEXT - Rich markdown rendering */}
                                            <div
                                                data-layer="assistant-message-text"
                                                style={{
                                                    alignSelf: "stretch",              // Full width container
                                                    maxWidth: "100%",                 // Responsive to container
                                                }}
                                            >
                                                {/* RENDER MARKDOWN - Convert Gemini response to styled React elements */}
                                                {renderSimpleMarkdown(
                                                    message.content as string,       // Gemini response text
                                                    markdownBaseTextStyle,           // Base text styling
                                                    markdownLinkStyle               // Link-specific styling
                                                )}
                                            </div>
                                            {/* ACTION BUTTONS CONTAINER - Copy and TTS controls */}
                                            <div
                                                data-layer="assistant-action-icons"
                                                style={{
                                                    display:
                                                        typeof welcomeMessage === "string" &&
                                                        welcomeMessage.trim() !== "" &&
                                                        (message.content as string) === welcomeMessage
                                                            ? "none"
                                                            : "flex",
                                                    justifyContent:
                                                        "flex-start",                 // Left-align buttons
                                                    alignItems: "center",
                                                    gap: 16,                         // Spacing between buttons
                                                }}
                                            >
                                                {/* COPY TO CLIPBOARD BUTTON */}
                                                <button
                                                    aria-label="Copy message"
                                                    onClick={(
                                                        e: React.MouseEvent<HTMLButtonElement>
                                                    ) => {
                                                        // COPY TO CLIPBOARD - Modern Clipboard API with fallback
                                                        if (
                                                            typeof navigator !==
                                                                "undefined" &&
                                                            navigator.clipboard
                                                        ) {
                                                            navigator.clipboard.writeText(
                                                                message.content as string
                                                            )
                                                            // VISUAL FEEDBACK - Temporary opacity change
                                                            const btn =
                                                                e.currentTarget
                                                            btn.style.opacity =
                                                                "0.65"              // Dim button
                                                            setTimeout(
                                                                () =>
                                                                    (btn.style.opacity =
                                                                        "1"),       // Restore opacity
                                                                500                  // 500ms feedback duration
                                                            )
                                                        }
                                                    }}
                                                    style={{
                                                        background: "none",                // Transparent background
                                                        border: "none",                    // Remove default border
                                                        padding: 0,                        // Remove default padding
                                                        cursor: "pointer",                 // Pointer cursor for interactivity
                                                    }}
                                                >
                                                    <svg
                                                        width="14"
                                                        height="14"
                                                        viewBox="0 0 14 14"
                                                        fill="none"
                                                        xmlns="http://www.w3.org/2000/svg"
                                                    >
                                                        <path
                                                            fillRule="evenodd"
                                                            clipRule="evenodd"
                                                            d="M5.6 0C4.44021 0 3.5 0.940205 3.5 2.1V3.5H2.1C0.940205 3.5 0 4.44021 0 5.6V11.9C0 13.0598 0.940205 14 2.1 14H8.4C9.55983 14 10.5 13.0598 10.5 11.9V10.5H11.9C13.0598 10.5 14 9.55983 14 8.4V2.1C14 0.940205 13.0598 0 11.9 0H5.6ZM10.5 5.6C10.5 4.44021 9.55983 3.5 8.4 3.5H4.9V2.1C4.9 1.7134 5.2134 1.4 5.6 1.4H11.9C12.2866 1.4 12.6 1.7134 12.6 2.1V8.4C12.6 8.78661 12.2866 9.1 11.9 9.1H10.5V5.6ZM1.4 5.6C1.4 5.2134 1.7134 4.9 2.1 4.9H8.4C8.78661 4.9 9.1 5.2134 9.1 5.6V11.9C9.1 12.2866 8.78661 12.6 8.4 12.6H2.1C1.7134 12.6 1.4 12.2866 1.4 11.9V5.6Z"
                                                            fill={
                                                                props.iconColor
                                                                    ? props.iconColor.replace(
                                                                          /rgba?\((\d+,\s*\d+,\s*\d+)(?:,\s*[\d.]+)?\)/,
                                                                          "rgba($1, 0.45)"
                                                                      )
                                                                    : "rgba(0,0,0,0.45)"
                                                            }
                                                        />
                                                    </svg>
                                                </button>
                                                {/* CONDITIONAL TTS BUTTON - Play or Stop based on current speaking state */}
                                                {speakingMessageIndex ===
                                                msgIndex ? (
                                                    <button
                                                        aria-label="Stop speaking"
                                                        onClick={handleStopTTS}              // Stop speech synthesis
                                                        style={{
                                                            background: "none",                // Transparent background
                                                            border: "none",                    // Remove default border
                                                            padding: 0,                        // Remove default padding
                                                            cursor: "pointer",                 // Pointer cursor
                                                        }}
                                                    >
                                                        <svg
                                                            width="15"
                                                            height="14"
                                                            viewBox="0 0 15 14"
                                                            fill="none"
                                                            xmlns="http://www.w3.org/2000/svg"
                                                        >
                                                            <path
                                                                fillRule="evenodd"
                                                                clipRule="evenodd"
                                                                d="M0.0390625 7C0.0390625 3.13401 3.17307 0 7.03906 0C10.905 0 14.0391 3.13401 14.0391 7C14.0391 10.866 10.905 14 7.03906 14C3.17307 14 0.0390625 10.866 0.0390625 7ZM5.28906 4.55C4.90247 4.55 4.58906 4.8634 4.58906 5.25V8.75C4.58906 9.13661 4.90247 9.45 5.28906 9.45H8.78906C9.17567 9.45 9.48906 9.13661 9.48906 8.75V5.25C9.48906 4.8634 9.17567 4.55 8.78906 4.55H5.28906Z"
                                                                fill={
                                                                    props.iconColor
                                                                        ? props.iconColor.replace(
                                                                              /rgba?\((\d+,\s*\d+,\s*\d+)(?:,\s*[\d.]+)?\)/,
                                                                              "rgba($1, 0.45)"
                                                                          )
                                                                        : "rgba(0,0,0,0.45)"
                                                                }
                                                            />
                                                        </svg>
                                                    </button>
                                                ) : (
                                                    <button
                                                        aria-label="Read message aloud"
                                                        onClick={() =>
                                                            handlePlayTTS(
                                                                message.content as string,  // Message text to speak
                                                                msgIndex                     // Message index for state tracking
                                                            )
                                                        }
                                                        style={{
                                                            background: "none",
                                                            border: "none",
                                                            padding: 0,
                                                            cursor: "pointer",
                                                        }}
                                                    >
                                                        <svg
                                                            width="19"
                                                            height="14"
                                                            viewBox="0 0 19 14"
                                                            fill="none"
                                                            xmlns="http://www.w3.org/2000/svg"
                                                        >
                                                            <path
                                                                fillRule="evenodd"
                                                                clipRule="evenodd"
                                                                d="M16.0922 2.88291C16.4463 2.69066 16.8892 2.82185 17.0814 3.17595C18.3474 5.50765 18.364 8.39664 17.125 10.7426C16.9369 11.0989 16.4956 11.2352 16.1393 11.0471C15.783 10.8589 15.6467 10.4176 15.8348 10.0612C16.8479 8.143 16.8343 5.7787 15.7992 3.87214C15.6069 3.51805 15.7381 3.07516 16.0922 2.88291ZM12.7967 4.0092C13.1189 3.76722 13.5763 3.83221 13.8182 4.15436C15.0035 5.73237 15.0741 7.94783 13.9925 9.59741C13.7716 9.93431 13.3194 10.0283 12.9824 9.80744C12.6455 9.58654 12.5515 9.13422 12.7724 8.79732C13.5207 7.65618 13.4716 6.1222 12.6516 5.03066C12.4096 4.70851 12.4746 4.25118 12.7967 4.0092Z"
                                                                fill={
                                                                    props.iconColor
                                                                        ? props.iconColor.replace(
                                                                              /rgba?\((\d+,\s*\d+,\s*\d+)(?:,\s*[\d.]+)?\)/,
                                                                              "rgba($1, 0.45)"
                                                                          )
                                                                        : "rgba(0,0,0,0.45)"
                                                                }
                                                            />
                                                            <path
                                                                fillRule="evenodd"
                                                                clipRule="evenodd"
                                                                d="M7.69821 0.482986C8.86803 -0.589342 10.7545 0.240502 10.7545 1.82745V12.1725C10.7545 13.7595 8.86803 14.5894 7.69821 13.517L5.36392 11.3772H2.5C1.11929 11.3772 0 10.2579 0 8.87719V5.12275C0 3.74204 1.11929 2.62275 2.5 2.62275H5.36392L7.69821 0.482986ZM8.68411 1.55855C8.91808 1.34408 9.29539 1.51006 9.29539 1.82745V12.1725C9.29539 12.4899 8.91808 12.6559 8.68411 12.4414L6.14066 10.1099C6.00611 9.98654 5.83022 9.91811 5.6477 9.91811H2.45908C1.90679 9.91811 1.45908 9.4704 1.45908 8.91811V5.08183C1.45908 4.52955 1.90679 4.08183 2.45908 4.08183H5.6477C5.83022 4.08183 6.00611 4.01341 6.14066 3.89007L8.68411 1.55855Z"
                                                                fill={
                                                                    props.iconColor
                                                                        ? props.iconColor.replace(
                                                                              /rgba?\((\d+,\s*\d+,\s*\d+)(?:,\s*[\d.]+)?\)/,
                                                                              "rgba($1, 0.45)"
                                                                          )
                                                                        : "rgba(0,0,0,0.45)"
                                                                }
                                                            />
                                                        </svg>
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    )
                                }
                                return null
                            })}
                        {(isLoading || streamed) && (
                            <div
                                data-layer="streaming-assistant-response"
                                style={{
                                    alignSelf: "stretch",
                                    display: "flex",
                                    flexDirection: "column",
                                    alignItems: "flex-start",
                                    gap: 12,
                                }}
                            >
                                {isLoading && !streamed && (
                                    <div
                                        data-svg-wrapper
                                        data-layer="pre-streaming-loading-indicator"
                                        style={{
                                            animation: isLoading
                                                ? "pulseStar 1.5s infinite ease-in-out"
                                                : "none",
                                        }}
                                    >
                                        {safeLoadingIconUrl ? (
                                            <img
                                                src={safeLoadingIconUrl}
                                                alt="Loading..."
                                                style={{
                                                    width: 20,
                                                    height: 20,
                                                }}
                                            />
                                        ) : (
                                            <svg
                                                width="20"
                                                height="20"
                                                viewBox="0 0 20 20"
                                                fill="none"
                                                xmlns="http://www.w3.org/2000/svg"
                                            >
                                                <g clipPath="url(#clipLoadAnimExpandedFull)">
                                                    <path
                                                        d="M9.291 1.32935C9.59351 0.762163 10.4065 0.762164 10.709 1.32935L13.4207 6.41384C13.4582 6.48418 13.5158 6.54176 13.5861 6.57927L18.6706 9.29099C19.2378 9.59349 19.2378 10.4065 18.6706 10.709L13.5861 13.4207C13.5158 13.4582 13.4582 13.5158 13.4207 13.5862L10.709 18.6706C10.4065 19.2378 9.59351 19.2378 9.291 18.6706L6.57927 13.5862C6.54176 13.5158 6.48417 13.4582 6.41384 13.4207L1.32934 10.709C0.762155 10.4065 0.762157 9.59349 1.32935 9.29099L6.41384 6.57927C6.48417 6.54176 6.54176 6.48418 6.57927 6.41384L9.291 1.32935Z"
                                                        fill={props.iconColor}
                                                    />
                                                </g>
                                                <defs>
                                                    <clipPath id="clipLoadAnimExpandedFull">
                                                        <rect
                                                            width="20"
                                                            height="20"
                                                            fill="white"
                                                        />
                                                    </clipPath>
                                                </defs>
                                            </svg>
                                        )}
                                    </div>
                                )}
                                {streamed && (
                                    <div
                                        data-layer="streamed-text"
                                        style={{
                                            alignSelf: "stretch",
                                            maxWidth: "100%",
                                        }}
                                    >
                                        {renderSimpleMarkdown(
                                            streamed,
                                            markdownBaseTextStyle,
                                            markdownLinkStyle
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                        <div ref={messagesEndRef} style={{ height: 1 }} />
                    </div>

                    {showSuggestionsArea && (
                        <div
                            data-layer="suggested-replies-container"
                            style={suggestionsContainerStyle}
                        >
                            {displayedSuggestions.map((reply, index) => (
                                <button
                                    key={`suggested-reply-${index}`}
                                    style={suggestedReplyButtonStyle}
                                    onClick={() => handleSuggestionClick(reply)}
                                    title={reply}
                                >
                                    {reply}
                                </button>
                            ))}
                        </div>
                    )}

                    <div
                        data-layer="input-area-frame"
                        style={inputAreaFrameStyle}
                    >
                        <div
                            data-layer="input-box-content"
                            style={{
                                alignSelf: "stretch",
                                maxHeight: 196,
                                padding: 12,
                                background: expandedInputAreaBackground,
                                boxShadow: "0px -4px 48px rgba(0, 0, 0, 0.06)",
                                overflow: "hidden",
                                borderTopLeftRadius: `${universalBorderRadius}px`,
                                borderTopRightRadius: `${universalBorderRadius}px`,
                                backdropFilter: "blur(4px)",
                                WebkitBackdropFilter: "blur(4px)",
                                display: "flex",
                                flexDirection: "column",
                                gap: 12,
                            }}
                        >
                            <div
                                data-layer="text-image-input-area"
                                style={{
                                    alignSelf: "stretch",
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: 8,
                                    overflowY: "auto",
                                    flexGrow: 1,
                                }}
                            >
                                {imageFile && imagePreviewUrl && (
                                    <div
                                        data-layer="image-preview-expanded-input"
                                        style={{
                                            alignSelf: "flex-start",
                                            position: "relative",
                                            width: 48,
                                            height: 48,
                                            flexShrink: 0,
                                        }}
                                    >
                                        <img
                                            src={imagePreviewUrl}
                                            alt="Selected preview"
                                            style={{
                                                width: "100%",
                                                height: "100%",
                                                objectFit: "contain",
                                                borderRadius: 12,
                                                outline:
                                                    "1px solid rgba(0,0,0,0.2)",
                                            }}
                                        />
                                        <div
                                            data-layer="remove-image-button"
                                            onClick={handleRemoveImage}
                                            style={{
                                                position: "absolute",
                                                right: -8,
                                                top: -8,
                                                width: 22,
                                                height: 22,
                                                borderRadius: `${universalBorderRadius}px`,
                                                background: "black",
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                                cursor: "pointer",
                                                border: "2px solid white",
                                            }}
                                        >
                                            <svg
                                                width="10"
                                                height="10"
                                                viewBox="0 0 10 10"
                                                fill="none"
                                                xmlns="http://www.w3.org/2000/svg"
                                            >
                                                <path
                                                    d="M1 1L9 9M9 1L1 9"
                                                    stroke="white"
                                                    strokeWidth="1.5"
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                />
                                            </svg>
                                        </div>
                                    </div>
                                )}
                                <textarea
                                    ref={inputRef}
                                    value={input}
                                    onChange={handleInput}
                                    onKeyDown={handleExpandedViewKeyDown}
                                    placeholder={placeholder}
                                    style={{
                                        ...globalFontStyles,
                                        color: props.textColor,
                                        alignSelf: "stretch",
                                        minHeight:
                                            globalFontStyles.lineHeight &&
                                            globalFontStyles.fontSize
                                                ? `calc(${typeof globalFontStyles.lineHeight === "number" ? globalFontStyles.lineHeight : parseFloat(globalFontStyles.lineHeight as string)} * ${parseFloat(globalFontStyles.fontSize as string)}px)`
                                                : "24px",
                                        flexGrow: 1,
                                        resize: "none",
                                        border: "none",
                                        outline: "none",
                                        background: "transparent",
                                        padding: "0px",
                                        wordWrap: "break-word",
                                    }}
                                    rows={1}
                                />
                            </div>
                            <div
                                data-layer="input-action-buttons"
                                style={{
                                    alignSelf: "stretch",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                    display: "flex",
                                    flexShrink: 0,
                                }}
                            >
                                <button
                                    aria-label="Attach image"
                                    onClick={() =>
                                        fileInputRef.current?.click()
                                    }
                                    disabled={isLoading}
                                    style={{
                                        background:
                                            props.userMessageBackgroundColor,
                                        border: "none",
                                        borderRadius: `${universalBorderRadius}px`,
                                        width: 36,
                                        height: 36,
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        cursor: "pointer",
                                        padding: 0,
                                    }}
                                >
                                    <input
                                        ref={fileInputRef}
                                        type="file"
                                        accept="image/*"
                                        style={{ display: "none" }}
                                        onChange={handleImageChange}
                                        disabled={isLoading}
                                    />
                                    <svg
                                        width="36"
                                        height="36"
                                        viewBox="0 0 36 36"
                                        fill="none"
                                        xmlns="http://www.w3.org/2000/svg"
                                    >
                                        <rect
                                            width="36"
                                            height="36"
                                            rx={universalBorderRadius}
                                            fill={
                                                props.userMessageBackgroundColor
                                            }
                                        />
                                        <path
                                            d="M16.8403 13.1597V16.8403H13.1597C12.5192 16.8403 12 17.3595 12 18C12 18.6405 12.5192 19.1597 13.1597 19.1597H16.8403V22.8403C16.8403 23.4808 17.3595 24 18 24C18.6405 24 19.1597 23.4808 19.1597 22.8403V19.1597H22.8403C23.4808 19.1597 24 18.6405 24 18C24 17.3595 23.4808 16.8403 22.8403 16.8403H19.1597V13.1597C19.1597 12.5192 18.6405 12 18 12C17.3595 12 16.8403 12.5192 16.8403 13.1597Z"
                                            fill={
                                                props.iconColor
                                                    ? props.iconColor.replace(
                                                          /rgba?\((\d+,\s*\d+,\s*\d+)(?:,\s*[\d.]+)?\)/,
                                                          "rgba($1, 0.65)"
                                                      )
                                                    : "rgba(0,0,0,0.65)"
                                            }
                                        />
                                    </svg>
                                </button>
                                {isLoading ? (
                                    <button
                                        aria-label="Stop generation"
                                        onClick={handleStopGeneration}
                                        style={{
                                            background: props.sendBgColor,
                                            border: "none",
                                            borderRadius: `${universalBorderRadius}px`,
                                            width: 36,
                                            height: 36,
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            cursor: "pointer",
                                            padding: 0,
                                        }}
                                    >
                                        {safeLoadingIconUrl ? (
                                            <img
                                                src={safeLoadingIconUrl}
                                                alt="Stop"
                                                style={{
                                                    width: 18,
                                                    height: 18,
                                                }}
                                            />
                                        ) : (
                                            <svg
                                                width="10"
                                                height="10"
                                                viewBox="0 0 10 10"
                                                fill="none"
                                                xmlns="http://www.w3.org/2000/svg"
                                            >
                                                <rect
                                                    width="10"
                                                    height="10"
                                                    rx={Math.min(
                                                        universalBorderRadius,
                                                        1.5
                                                    )}
                                                    fill={props.sendIconColor}
                                                    style={{
                                                        fillOpacity: 0.95,
                                                    }}
                                                />
                                            </svg>
                                        )}
                                    </button>
                                ) : (
                                    <button
                                        aria-label="Send message"
                                        onClick={handleExpandedViewSendClick}
                                        disabled={!input.trim() && !imageFile}
                                        style={{
                                            background: props.sendBgColor,
                                            opacity:
                                                input.trim() || imageFile
                                                    ? 1
                                                    : 0.5,
                                            border: "none",
                                            borderRadius: `${universalBorderRadius}px`,
                                            width: 36,
                                            height: 36,
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            cursor:
                                                input.trim() || imageFile
                                                    ? "pointer"
                                                    : "default",
                                            padding: 0,
                                        }}
                                    >
                                        {safeSendIconUrl ? (
                                            <img
                                                src={safeSendIconUrl}
                                                alt="Send"
                                                style={{
                                                    width: 18,
                                                    height: 18,
                                                }}
                                            />
                                        ) : (
                                            <svg
                                                width="36"
                                                height="36"
                                                viewBox="0 0 36 36"
                                                fill="none"
                                                xmlns="http://www.w3.org/2000/svg"
                                            >
                                                <rect
                                                    width="36"
                                                    height="36"
                                                    rx={universalBorderRadius}
                                                    fill={props.sendBgColor}
                                                />
                                                <path
                                                    fillRule="evenodd"
                                                    clipRule="evenodd"
                                                    d="M14.5592 18.1299L16.869 15.8202V23.3716C16.869 23.9948 17.3742 24.5 17.9974 24.5C18.6206 24.5 19.1259 23.9948 19.1259 23.3716V15.8202L21.4356 18.1299C21.8762 18.5706 22.5907 18.5706 23.0314 18.1299C23.4721 17.6893 23.4721 16.9748 23.0314 16.5341L17.9974 11.5L12.9633 16.5341C12.5226 16.9748 12.5226 17.6893 12.9633 18.1299C13.404 18.5706 14.1185 18.5706 14.5592 18.1299Z"
                                                    fill={props.sendIconColor}
                                                />
                                            </svg>
                                        )}
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                    <style>{`
                      @keyframes pulseStar { 0% { opacity: 0.5; transform: scale(0.85); } 50% { opacity: 1; transform: scale(1.0); } 100% { opacity: 0.5; transform: scale(0.85); } }
                      [data-layer="suggested-replies-container"]::-webkit-scrollbar { display: none; }
                      [data-layer="text-image-input-area"]::-webkit-scrollbar { width: 4px; }
                      [data-layer="text-image-input-area"]::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.2); border-radius: 2px; }
                  `}</style>
                </motion.div>
            </Fragment>
        )
    }

    return (
        <Fragment>
            <style>{placeholderStyleTagContent}</style>
            <div
                role="button"
                tabIndex={0}
                aria-label={
                    input.trim()
                        ? `Continue chat: ${input.substring(0, 30)}...`
                        : placeholder || "Open chat to ask anything"
                }
                data-layer="overlay prompt input box"
                className="OverlayPromptInputBox"
                style={{
                    width: "100%",
                    height: "100%",
                    position: "relative",
                    paddingTop: 7,
                    paddingBottom: 6,
                    paddingLeft: 12,
                    paddingRight: 6,
                    background: inputBarBackground,
                    boxShadow: shadow
                        ? "0px -4px 24px rgba(0, 0, 0, 0.08)"
                        : "none",
                    overflow: "hidden",
                    borderRadius: `${universalBorderRadius}px`,
                    backdropFilter: "blur(12px)",
                    WebkitBackdropFilter: "blur(12px)",
                    display: "inline-flex",
                    alignItems: "flex-end",
                    justifyContent: "flex-start",
                    gap: 10,
                    cursor: "pointer",
                    pointerEvents: expanded ? "none" : "auto",
                    opacity: expanded
                        ? 0
                        : scrollRevealStyle && enableScrollReveal
                            ? (scrollRevealStyle.opacity as number)
                            : 1,
                    // When scroll reveal is enabled, drive transform via local style
                    // so the element rises and scales in as the page scrolls.
                    transform:
                        !expanded && scrollRevealStyle && enableScrollReveal
                            ? (scrollRevealStyle.transform as string)
                            : undefined,
                    willChange: enableScrollReveal ? "transform, opacity" : undefined,
                    // Slightly longer duration to avoid harsh motion on reveal
                    transition: enableScrollReveal
                        ? "transform 0.25s ease-out, opacity 0.25s ease-out"
                        : "opacity 0.25s ease-out",
                    ...style,
                }}
                onClick={(e) => {
                    const target = e.target as HTMLElement
                    if (
                        target.closest(
                            '[data-layer="send-button-collapsed-wrapper"]'
                        )
                    ) {
                        return
                    }
                    if (!isLoading && !expanded) {
                        handleExpand()
                    }
                }}
                onKeyDown={(e) => {
                    if (
                        typeof document !== "undefined" &&
                        document.activeElement !== collapsedInputRef.current &&
                        (e.key === "Enter" || e.key === " ")
                    ) {
                        e.preventDefault()
                        if (!isLoading && !expanded) {
                            if (hasContent) {
                                sendMessage()
                                handleExpand()
                            } else {
                                handleExpand()
                            }
                        }
                    }
                }}
                ref={inputBarRef}
            >
                <div
                    className="Flexbox"
                    style={{
                        flex: "1 1 0",
                        alignSelf: "stretch",
                        paddingTop: 4,
                        flexDirection: "column",
                        justifyContent: "flex-start",
                        alignItems: "flex-start",
                        display: "inline-flex",
                        overflow: "hidden",
                        position: "relative",
                    }}
                >
                    <input
                        ref={collapsedInputRef}
                        className="chat-overlay-collapsed-input"
                        type="text"
                        value={input}
                        onChange={handleInput}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                e.preventDefault()
                                if (!isLoading) {
                                    if (hasContent) {
                                        sendMessage()
                                        handleExpand()
                                    } else if (!expanded) {
                                        handleExpand()
                                    }
                                }
                            }
                        }}
                        placeholder={placeholder}
                        style={{
                            ...globalFontStyles,
                            color: textColor,
                            width: "100%",
                            border: "none",
                            background: "transparent",
                            outline: "none",
                            padding: "0",
                            boxSizing: "border-box",
                            cursor: "pointer",
                        }}
                    />
                </div>

                <div
                    data-layer="send-button-collapsed-wrapper"
                    style={{ flexShrink: 0 }}
                >
                    <button
                        aria-label={
                            isLoading
                                ? "Processing..."
                                : hasContent
                                  ? "Send message and expand"
                                  : "Expand chat"
                        }
                        onClick={(e) => {
                            e.stopPropagation()
                            if (isLoading) return
                            if (hasContent) {
                                if (!expanded) {
                                    sendMessage()
                                    handleExpand()
                                }
                            } else if (!expanded) {
                                handleExpand()
                            }
                        }}
                        disabled={
                            isCollapsedSendDisabled && !hasContent && !expanded
                        }
                        style={{
                            background: "transparent",
                            border: "none",
                            width: 36,
                            height: 36,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            padding: 0,
                            cursor:
                                isCollapsedSendDisabled &&
                                !hasContent &&
                                !expanded
                                    ? "default"
                                    : "pointer",
                        }}
                    >
                        <svg
                            width="36"
                            height="36"
                            viewBox="0 0 36 36"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                        >
                            <g opacity={sendButtonEffectiveOpacity}>
                                <rect
                                    width="36"
                                    height="36"
                                    rx={universalBorderRadius}
                                    fill={sendBgColor}
                                />
                                {isLoading ? (
                                    safeLoadingIconUrl ? (
                                        <image
                                            href={safeLoadingIconUrl}
                                            x="9"
                                            y="9"
                                            height="18"
                                            width="18"
                                        />
                                    ) : (
                                        <rect
                                            x="13"
                                            y="13"
                                            width="10"
                                            height="10"
                                            rx={Math.min(
                                                universalBorderRadius,
                                                1.5
                                            )}
                                            fill={sendIconColor}
                                        />
                                    )
                                ) : safeSendIconUrl ? (
                                    <image
                                        href={safeSendIconUrl}
                                        x="9"
                                        y="9"
                                        height="18"
                                        width="18"
                                    />
                                ) : (
                                    <path
                                        fillRule="evenodd"
                                        clipRule="evenodd"
                                        d="M14.5592 18.1299L16.869 15.8202V23.3716C16.869 23.9948 17.3742 24.5 17.9974 24.5C18.6206 24.5 19.1259 23.9948 19.1259 23.3716V15.8202L21.4356 18.1299C21.8762 18.5706 22.5907 18.5706 23.0314 18.1299C23.4721 17.6893 23.4721 16.9748 23.0314 16.5341L17.9974 11.5L12.9633 16.5341C12.5226 16.9748 12.5226 17.6893 12.9633 18.1299C13.404 18.5706 14.1185 18.5706 14.5592 18.1299Z"
                                        fill={sendIconColor}
                                    />
                                )}
                            </g>
                        </svg>
                    </button>
                </div>
            </div>
        </Fragment>
    )
}

// =========================================================================
// Framer Property Controls Configuration
// =========================================================================

/**
 * FRAMER PROPERTY CONTROLS CONFIGURATION
 * Defines the customizable properties available in Framer's design panel.
 * These controls allow designers to customize the chat overlay without code changes.
 * Each control maps to a component prop and provides a user-friendly interface
 * for configuration with validation, defaults, and helpful descriptions.
 */
addPropertyControls(ChatOverlay, {
    // =========================================================================
    // API & Model Configuration
    // =========================================================================

    /**
     * GEMINI API KEY CONTROL
     * Secure input for Google's Gemini API authentication.
     * Uses obscured text to protect sensitive credentials.
     * Required for the component to communicate with Gemini services.
     */
    geminiApiKey: {
        type: ControlType.String,
        title: "Gemini API Key",
        defaultValue: "",
        placeholder: "Paste API key",
        obscured: true,                                 // Hides the actual key for security
        description: "Create a free API key on Google AI Studio",
    },
    /**
     * UNIVERSAL BORDER RADIUS CONTROL
     * Controls corner roundness for all rounded elements in the component.
     * Provides consistent visual design with granular control from 0-50px.
     * Affects buttons, input fields, overlay corners, and message bubbles.
     */
    universalBorderRadius: {
        type: ControlType.Number,
        title: "Corner Radius",
        defaultValue: 24,
        min: 0,
        max: 50,
        unit: "px",
        step: 1,
        displayStepper: true,                           // Shows +/- stepper buttons
        description:
            "Universal corner radius for most elements (0-50px). Default: 24px.",
    },

    // =========================================================================
    // Content & Behavior Configuration
    // =========================================================================

    /**
     * SYSTEM PROMPT CONTROL
     * Defines the AI assistant's personality, behavior, and task context.
     * Uses textarea for longer prompts with better formatting support.
     * This is sent to Gemini as the system instruction for each conversation.
     */
    systemPrompt: {
        type: ControlType.String,
        title: "Instructions",
        displayTextArea: true,                         // Shows larger textarea input
        defaultValue: "You are a helpful assistant.",
        description: "System prompt to define the bot's personality and task.",
    },

    /**
     * WELCOME MESSAGE CONTROL
     * Optional initial greeting displayed when the chat loads.
     * Leave empty to start with no initial message from the assistant.
     * Useful for providing context or personality from the first interaction.
     */
    welcomeMessage: {
        type: ControlType.String,
        title: "Welcome Message",
        defaultValue: "Hi, how can I help?",
        description:
            "(Optional) An initial message from the assistant",
    },

    /**
     * AI MODEL SELECTION CONTROL
     * Specifies which Gemini model to use for generating responses.
     * Currently optimized for gemini-2.5-flash-lite for speed and accuracy.
     * Allows future extensibility to other Gemini models.
     */
    model: {
        type: ControlType.String,
        title: "AI Model",
        defaultValue: "gemini-2.5-flash-lite",
        placeholder: "model-id",
        description:
            "Ideal: gemini-2.5-flash-lite for best speed and high accuracy.",
    },

    /**
     * INPUT PLACEHOLDER CONTROL
     * Text shown in the input field when empty.
     * Guides users on what type of input is expected.
     * Supports localization and brand voice customization.
     */
    placeholder: {
        type: ControlType.String,
        title: "Placeholder Text",
        defaultValue: "Ask anything",
        description: "Input placeholder.",
    },
    textFont: {
        type: ControlType.Font,
        title: "Font",
        controls: "extended",
        defaultFontType: "sans-serif",
        defaultValue: {
            fontSize: 16,
            fontWeight: 400,
            fontStyle: "normal",
            letterSpacing: 0,
            lineHeight: "1.5em",
            textAlign: "left",
            variant: "Regular",
        },
        description: "Font size, weight, and style",
    },
    enableAiSuggestions: {
        type: ControlType.Boolean,
        title: "Reply Suggestions",
        defaultValue: true,
        description: "Generate AI contextual follow-up replies.",
    },
    suggestedReply1: {
        type: ControlType.String,
        title: "Reply 1",
        defaultValue: "Quick facts",
        placeholder: "Enter suggestion text",
        description: "(Optional) First static suggested reply.",
    },
    suggestedReply2: {
        type: ControlType.String,
        title: "Reply 2",
        defaultValue: "Proven metrics",
        placeholder: "Enter suggestion text",
        description: "(Optional) Second static suggested reply.",
    },
    suggestedReply3: {
        type: ControlType.String,
        title: "Reply 3",
        defaultValue: "Contact",
        placeholder: "Enter suggestion text",
        description: "(Optional) Third static suggested reply.",
    },
    reasoningEffort: {
        type: ControlType.Enum,
        title: "Thinking",
        options: ["none", "low", "medium", "high"],
        optionTitles: ["None (Default)", "Low", "Medium", "High"],
        defaultValue: "none",
        description: "Makes Gemini's slower but smarter.",
    },
    enableScrollReveal: {
        type: ControlType.Boolean,
        title: "Scroll Reveal",
        defaultValue: true,
        description:
            "Scale in from bottom on scroll.",
    },
    shadow: {
        type: ControlType.Boolean,
        title: "Shadow",
        defaultValue: true,
        description: "Toggles shadow around text input area.",
    },
    textColor: {
        type: ControlType.Color,
        title: "Text Input/Message Color",
        defaultValue: "rgba(0, 0, 0, 0.95)",
        description: "Customize font color of input/messages.",
    },
    placeholderTextColor: {
        type: ControlType.Color,
        title: "Text Placeholder Color",
        defaultValue: "rgba(0,0,0,0.45)",
        description: "Customize font color of placeholder.",
    },
    linkColor: {
        type: ControlType.Color,
        title: "Link Color",
        defaultValue: "#007AFF",
        description: "Color for hyperlinks in chat.",
    },
    iconColor: {
        type: ControlType.Color,
        title: "Icon Color (General)",
        defaultValue: "rgba(0, 0, 0, 0.65)",
        description:
            "For copy/speak icon, loading icon, suggestion borders, and suggestion text.",
    },
    userMessageBackgroundColor: {
        type: ControlType.Color,
        title: "BG Bubble Messages",
        defaultValue: "rgba(0, 20, 41, 0.08)",
        description: "Background for user's message bubbles & attach button.",
    },
    chatAreaBackground: {
        type: ControlType.Color,
        title: "BG Chat",
        defaultValue: "#F5F5F5",
        description: "Background for the main message area in expanded state.",
    },
    inputBarBackground: {
        type: ControlType.Color,
        title: "BG Collapsed Input",
        defaultValue: "rgba(255, 255, 255, 0.70)",
        description: "Background for the collapsed text input area.",
    },
    expandedInputAreaBackground: {
        type: ControlType.Color,
        title: "BG Expanded Input",
        defaultValue: DEFAULT_EXPANDED_INPUT_BG,
        description: "Background for the expanded text input area.",
    },
    sendBgColor: {
        type: ControlType.Color,
        title: "BG Send Button",
        defaultValue: "rgba(0, 0, 0, 0.95)",
        description: "Color for the send button's background.",
    },
    sendIconColor: {
        type: ControlType.Color,
        title: "Send Arrow/Stop Color",
        defaultValue: "#FFFFFF",
        description: "Color for the send button's arrow/stop icons.",
    },
    sendIconOverrideUrl: {
        type: ControlType.ResponsiveImage,
        title: "Send Icon Override",
        description:
            "Replaces send button's arrow/stop icons. Ideal: transparent BG, square. Approx 18x18px.",
    },
    loadingIconOverrideUrl: {
        type: ControlType.ResponsiveImage,
        title: "Loading Icon Override",
        description:
            "Replaces default loading icon. Ideal: transparent BG, square. Approx 18x18px.",
    },
})
