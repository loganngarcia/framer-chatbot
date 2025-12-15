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
    useMemo,
} from "react"
import { flushSync } from "react-dom"
import { addPropertyControls, ControlType, RenderTarget } from "framer"
import {
    motion,
    useDragControls,
    useScroll,
    useMotionValueEvent,
    AnimatePresence,
} from "framer-motion"

// -----------------------------------------------------------------------------
// Type Definitions
// -----------------------------------------------------------------------------

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
    welcomeMessage?: string
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
    rotateSuggestions?: boolean
    defaultSuggestions: string[]
    suggestionRotateInterval: number
    enableAiSuggestions?: boolean
    universalBorderRadius: number
    enableScrollReveal?: boolean
    enableGeminiLive?: boolean
    interruptionThreshold?: number
}

interface Message {
    role: "user" | "assistant" | "system"
    content:
        | string
        | Array<
              | { type: "text"; text: string }
              | { type: "image_url"; image_url: { url: string } }
              | {
                    type: "inline_data"
                    inline_data: { mimeType: string; data: string }
                }
              | {
                    type: "file"
                    file: {
                        uri: string
                        mimeType?: string
                        name?: string
                        thumbnailDataUrl?: string
                    }
                }
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
const INLINE_MAX_BYTES = 20 * 1024 * 1024 // 20MB

// Gemini Native Audio Output Rate
const MODEL_OUTPUT_SAMPLE_RATE = 24000
// We will downsample input to this rate for robustness
const INPUT_TARGET_SAMPLE_RATE = 16000

// -----------------------------------------------------------------------------
// Audio Processing Helpers for Live API
// -----------------------------------------------------------------------------

/**
 * High-pass filter to remove low-frequency noise (rumble, hum)
 */
function highPassFilter(audioData: Float32Array, sampleRate: number, cutoffFreq: number = 80): Float32Array {
    const RC = 1.0 / (cutoffFreq * 2 * Math.PI)
    const dt = 1.0 / sampleRate
    const alpha = RC / (RC + dt)
    
    const filtered = new Float32Array(audioData.length)
    filtered[0] = audioData[0]
    
    for (let i = 1; i < audioData.length; i++) {
        filtered[i] = alpha * (filtered[i - 1] + audioData[i] - audioData[i - 1])
    }
    
    return filtered
}

/**
 * Dynamic range compression / normalization to handle varying speech volumes
 */
function normalizeAudio(audioData: Float32Array): Float32Array {
    let maxAmp = 0
    for (let i = 0; i < audioData.length; i++) {
        const amp = Math.abs(audioData[i])
        if (amp > maxAmp) maxAmp = amp
    }
    
    if (maxAmp === 0) return audioData
    
    // Normalize to 0.7 to leave headroom and avoid clipping
    const normalized = new Float32Array(audioData.length)
    const targetLevel = 0.7
    const gain = targetLevel / maxAmp
    
    for (let i = 0; i < audioData.length; i++) {
        normalized[i] = audioData[i] * gain
    }
    
    return normalized
}

/**
 * Improved Voice Activity Detection using RMS energy and zero-crossing rate
 */
function detectVoiceActivity(audioData: Float32Array, threshold: number): boolean {
    // Calculate RMS energy
    let sumSquares = 0
    let zeroCrossings = 0
    
    for (let i = 0; i < audioData.length; i++) {
        sumSquares += audioData[i] * audioData[i]
        
        // Count zero crossings
        if (i > 0 && audioData[i] * audioData[i - 1] < 0) {
            zeroCrossings++
        }
    }
    
    const rms = Math.sqrt(sumSquares / audioData.length)
    const zcr = zeroCrossings / audioData.length
    
    // Voice typically has RMS above threshold and moderate zero-crossing rate
    // ZCR helps distinguish voice from pure noise
    return rms > threshold && zcr > 0.01 && zcr < 0.5
}

function base64ToFloat32Array(base64: string): Float32Array {
    const binaryString = atob(base64)
    const len = binaryString.length
    const bytes = new Uint8Array(len)
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i)
    }
    const int16 = new Int16Array(bytes.buffer)
    const float32 = new Float32Array(int16.length)
    for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / 32768
    }
    return float32
}

function float32ToBase64(float32: Float32Array): string {
    const int16 = new Int16Array(float32.length)
    for (let i = 0; i < float32.length; i++) {
        const s = Math.max(-1, Math.min(1, float32[i]))
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
    }
    const bytes = new Uint8Array(int16.buffer)
    let binary = ""
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i])
    }
    return btoa(binary)
}

/**
 * High-quality downsampler with anti-aliasing to prevent frequency artifacts
 * Uses linear interpolation and averaging for better audio quality
 */
function downsampleBuffer(
    buffer: Float32Array,
    inputRate: number,
    outputRate: number
): Float32Array {
    if (outputRate === inputRate) return buffer
    
    const sampleRateRatio = inputRate / outputRate
    const newLength = Math.round(buffer.length / sampleRateRatio)
    const result = new Float32Array(newLength)
    
    // Downsample with linear interpolation and averaging to prevent aliasing
    for (let i = 0; i < newLength; i++) {
        const srcIndex = i * sampleRateRatio
        const srcIndexInt = Math.floor(srcIndex)
        const fraction = srcIndex - srcIndexInt
        
        // Average multiple source samples for anti-aliasing (low-pass filter)
        let sum = 0
        let count = 0
        const windowSize = Math.ceil(sampleRateRatio)
        
        for (let j = 0; j < windowSize && srcIndexInt + j < buffer.length; j++) {
            sum += buffer[srcIndexInt + j]
            count++
        }
        
        const averaged = count > 0 ? sum / count : 0
        
        // Linear interpolation for smoothness
        if (srcIndexInt + 1 < buffer.length && fraction > 0) {
            result[i] = averaged * (1 - fraction * 0.5) + buffer[srcIndexInt + 1] * (fraction * 0.5)
        } else {
            result[i] = averaged
        }
    }
    
    return result
}

// -----------------------------------------------------------------------------
// Helper Functions
// -----------------------------------------------------------------------------

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

function stripMarkdownForTTS(markdownText: string): string {
    if (!markdownText) return ""
    return markdownText
        .replace(/^#{1,6}\s+/gm, "")
        .replace(/(\*\*|__)(.*?)\1/g, "$2")
        .replace(/<(?:strong|b)>(.*?)<\/(?:strong|b)>/g, "$1")
        .replace(/(\*|_)(.*?)\1/g, "$2")
        .replace(/<(?:em|i)>(.*?)<\/(?:em|i)>/g, "$1")
        .replace(/~~(.*?)~~/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1")
        .replace(/<a\s+(?:[^>]*?\s+)?href="[^"]*"[^>]*>(.*?)<\/a>/g, "$1")
        .replace(/!\[([^\]]*)\]\([^\)]+\)/g, "$1")
        .replace(/^\s*[-*+]\s+/gm, "")
        .replace(/^\s*\d+\.\s+/gm, "")
        .replace(/\n+/g, " ")
        .trim()
}

// -----------------------------------------------------------------------------
// Markdown Parsing & Rendering
// -----------------------------------------------------------------------------

const applyInlineFormatting = (
    textSegment: string,
    keyPrefix: string,
    linkStyle: CSSProperties
): (string | JSX.Element)[] => {
    if (!textSegment) return []
    const parts: (string | JSX.Element)[] = []
    let lastIndex = 0

    // Improved regex with better URL detection
    // Order matters: specific patterns (markdown links, HTML) before auto-detection
    const combinedRegex =
        /(\*\*(.*?)\*\*|__(.*?)__|<strong>(.*?)<\/strong>|<b>(.*?)<\/b>|\`([^`]+)\`|~~(.*?)~~|(\*|_)(.*?)\8|<em>(.*?)<\/em>|<i>(.*?)<\/i>|\[([^\]]+?)\]\(([^)]+?)\)|<a\s+(?:[^>]*?\s+)?href="([^"]*)"[^>]*>(.*?)<\/a>|([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,63})|(https?:\/\/[^\s<>"{}|\\^`\[\]]+[^\s<>"{}|\\^`\[\].,;:!?)])|([a-zA-Z0-9][-a-zA-Z0-9]*\.)+[a-zA-Z]{2,}(?::\d+)?(?:\/[^\s<>"{}|\\^`\[\]]*)?(?=[.,;:!?)]*(?:\s|$)))/gi

    let match
    while ((match = combinedRegex.exec(textSegment)) !== null) {
        if (match.index > lastIndex) {
            parts.push(textSegment.substring(lastIndex, match.index))
        }

        const [
            fullMatch,
            matchText,
            boldInner,
            boldInner2,
            strongInner,
            bInner,
            codeInner,
            strikeInner,
            italicDelim,
            italicInner,
            emInner,
            iInner,
            linkText,
            linkUrl,
            htmlLinkUrl,
            htmlLinkText,
            email,
            httpUrl,
            plainUrl,
        ] = match

        if (
            boldInner !== undefined ||
            boldInner2 !== undefined ||
            strongInner !== undefined ||
            bInner !== undefined
        ) {
            parts.push(
                <strong key={`${keyPrefix}-${match.index}-b`}>
                    {boldInner || boldInner2 || strongInner || bInner}
                </strong>
            )
        } else if (codeInner !== undefined) {
            parts.push(
                <span
                    key={`${keyPrefix}-${match.index}-code`}
                    className="chat-markdown-inline-code"
                >
                    {codeInner}
                </span>
            )
        } else if (strikeInner !== undefined) {
            parts.push(
                <del key={`${keyPrefix}-${match.index}-del`}>{strikeInner}</del>
            )
        } else if (
            italicInner !== undefined ||
            emInner !== undefined ||
            iInner !== undefined
        ) {
            parts.push(
                <em key={`${keyPrefix}-${match.index}-em`}>
                    {italicInner || emInner || iInner}
                </em>
            )
        } else if (linkText !== undefined && linkUrl !== undefined) {
            parts.push(
                <a
                    key={`${keyPrefix}-${match.index}-a`}
                    href={ensureProtocol(linkUrl)}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={linkStyle}
                >
                    {linkText}
                </a>
            )
        } else if (htmlLinkText !== undefined && htmlLinkUrl !== undefined) {
            parts.push(
                <a
                    key={`${keyPrefix}-${match.index}-html-a`}
                    href={ensureProtocol(htmlLinkUrl)}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={linkStyle}
                >
                    {htmlLinkText}
                </a>
            )
        } else if (email !== undefined) {
            parts.push(
                <a
                    key={`${keyPrefix}-${match.index}-mail`}
                    href={`mailto:${email}`}
                    style={linkStyle}
                >
                    {email}
                </a>
            )
        } else if (httpUrl !== undefined) {
            parts.push(
                <a
                    key={`${keyPrefix}-${match.index}-http`}
                    href={httpUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={linkStyle}
                >
                    {httpUrl}
                </a>
            )
        } else if (plainUrl !== undefined) {
            parts.push(
                <a
                    key={`${keyPrefix}-${match.index}-url`}
                    href={ensureProtocol(plainUrl)}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={linkStyle}
                >
                    {plainUrl}
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

const renderTable = (
    block: string,
    key: string,
    baseStyle: CSSProperties,
    linkStyle: CSSProperties
) => {
    const lines = block.trim().split("\n")
    if (lines.length < 2) return null

    const headerLine = lines[0]
    const separatorLine = lines[1]
    const bodyLines = lines.slice(2)

    if (!separatorLine.includes("-") || !separatorLine.includes("|"))
        return null

    const headers = headerLine
        .split("|")
        .filter((h) => h.trim().length > 0)
        .map((h) => h.trim())
    const rows = bodyLines.map((line) =>
        line
            .split("|")
            .filter((c) => c.trim().length > 0)
            .map((c) => c.trim())
    )

    return (
        <div key={key} style={{ overflowX: "auto", width: "100%" }}>
            <table className="chat-markdown-table">
                <thead>
                    <tr>
                        {headers.map((h, i) => (
                            <th key={`th-${i}`}>
                                {applyInlineFormatting(
                                    h,
                                    `${key}-th-${i}`,
                                    linkStyle
                                )}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row, i) => (
                        <tr key={`tr-${i}`}>
                            {row.map((cell, j) => (
                                <td key={`td-${i}-${j}`}>
                                    {applyInlineFormatting(
                                        cell,
                                        `${key}-td-${i}-${j}`,
                                        linkStyle
                                    )}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}

const renderSimpleMarkdown = (
    markdownText: string,
    baseTextStyle: CSSProperties,
    linkStyle: CSSProperties
): JSX.Element => {
    if (!markdownText) return <Fragment />

    const codeBlockRegex = /(```[\s\S]*?```)/g
    const segments = markdownText.split(codeBlockRegex)

    const renderedSegments = segments.map((segment, segIndex) => {
        if (segment.startsWith("```")) {
            const content = segment.replace(/^```\w*\n?/, "").replace(/```$/, "")
            return (
                <div
                    key={`codeblock-${segIndex}`}
                    className="chat-markdown-code-block"
                >
                    {content}
                </div>
            )
        }

        const blocks = segment.split(/\n{2,}/)

        return blocks.map((block, blockIndex) => {
            const key = `seg-${segIndex}-blk-${blockIndex}`
            const trimmed = block.trim()
            if (!trimmed) return null

            if (
                trimmed.includes("|") &&
                trimmed.includes("\n") &&
                trimmed.split("\n")[1].includes("---")
            ) {
                const table = renderTable(trimmed, key, baseTextStyle, linkStyle)
                if (table) return table
            }

            if (/^---+$|^\*\*\*+$/.test(trimmed)) {
                return <hr key={key} className="chat-markdown-hr" />
            }

            const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)/)
            if (headingMatch) {
                const level = headingMatch[1].length
                const content = headingMatch[2]
                const sizes = [24, 20, 18, 16, 14, 12]
                return (
                    <div
                        key={key}
                        style={{
                            ...baseTextStyle,
                            fontSize: `${Math.max(sizes[level - 1], 14)}px`,
                            fontWeight: "bold",
                            margin: "0.5em 0",
                        }}
                    >
                        {applyInlineFormatting(content, `${key}-h`, linkStyle)}
                    </div>
                )
            }

            if (trimmed.startsWith(">")) {
                const content = trimmed.replace(/^>\s?/gm, "").trim()
                return (
                    <blockquote key={key} className="chat-markdown-blockquote">
                        {applyInlineFormatting(content, `${key}-qt`, linkStyle)}
                    </blockquote>
                )
            }

            if (/^[-*]\s/.test(trimmed)) {
                const items = trimmed
                    .split("\n")
                    .map((l) => l.replace(/^[-*]\s+/, ""))
                return (
                    <ul
                        key={key}
                        style={{
                            paddingLeft: 20,
                            margin: "0.5em 0",
                            listStyleType: "disc",
                        }}
                    >
                        {items.map((item, i) => (
                            <li key={`${key}-li-${i}`} style={baseTextStyle}>
                                {applyInlineFormatting(
                                    item,
                                    `${key}-li-${i}`,
                                    linkStyle
                                )}
                            </li>
                        ))}
                    </ul>
                )
            }

            if (/^\d+\.\s/.test(trimmed)) {
                const items = trimmed
                    .split("\n")
                    .map((l) => l.replace(/^\d+\.\s+/, ""))
                return (
                    <ol
                        key={key}
                        style={{
                            paddingLeft: 20,
                            margin: "0.5em 0",
                            listStyleType: "decimal",
                        }}
                    >
                        {items.map((item, i) => (
                            <li key={`${key}-li-${i}`} style={baseTextStyle}>
                                {applyInlineFormatting(
                                    item,
                                    `${key}-li-${i}`,
                                    linkStyle
                                )}
                            </li>
                        ))}
                    </ol>
                )
            }

            return (
                <div key={key} style={{ ...baseTextStyle, margin: "0.5em 0" }}>
                    {applyInlineFormatting(trimmed, `${key}-p`, linkStyle)}
                </div>
            )
        })
    })

    return <Fragment>{renderedSegments}</Fragment>
}

// -----------------------------------------------------------------------------
// Main ChatOverlay Component
// -----------------------------------------------------------------------------
export default function ChatOverlay(props: ChatOverlayProps) {
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
        rotateSuggestions = true,
        defaultSuggestions = [],
        suggestionRotateInterval = 3,
        enableAiSuggestions = true,
        universalBorderRadius = 24,
        enableScrollReveal = true,
        enableGeminiLive = true,
        interruptionThreshold = 0.01,
    } = props

    const baseFontSize =
        typeof textFont.fontSize === "number"
            ? textFont.fontSize
            : parseFloat(textFont.fontSize) || 16
    const tableFontSize = Math.max(10, baseFontSize - 1) + "px"

    const markdownStyles = `
        .chat-markdown-table {
            width: 100%;
            border-collapse: collapse;
            margin: 1em 0;
            font-size: ${tableFontSize};
        }
        .chat-markdown-table th,
        .chat-markdown-table td {
            border-bottom: 1px solid ${props.iconColor ? props.iconColor.replace(")", ", 0.1)").replace("rgb", "rgba") : "rgba(0,0,0,0.1)"};
            padding: 8px 12px;
            text-align: left;
            color: ${props.textColor};
        }
        .chat-markdown-table th {
            font-weight: 600;
        }
        .chat-markdown-code-block {
            background: rgba(0,0,0,0.03);
            border: 1px solid rgba(0,0,0,0.06);
            color: ${props.textColor};
            padding: 12px;
            border-radius: 8px;
            overflow-x: auto;
            font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
            font-size: 0.85em;
            margin: 1em 0;
            white-space: pre;
        }
        .chat-markdown-inline-code {
            background: rgba(0,0,0,0.05);
            padding: 2px 4px;
            border-radius: 4px;
            font-family: 'Menlo', 'Monaco', 'Courier New', monospace;
            font-size: 0.9em;
            color: ${props.linkColor};
        }
        .chat-markdown-blockquote {
            border-left: 4px solid ${props.iconColor || "rgba(0,0,0,0.2)"};
            padding-left: 16px;
            margin: 1em 0;
            opacity: 0.8;
            font-style: italic;
        }
        .chat-markdown-hr {
            border: 0;
            height: 1px;
            background: ${props.iconColor ? props.iconColor.replace(")", ", 0.1)").replace("rgb", "rgba") : "rgba(0,0,0,0.1)"};
            margin: 1.5em 0;
        }
        .chat-overlay-collapsed-input::placeholder { color: transparent; opacity: 0; }
        .chat-overlay-collapsed-input::-webkit-input-placeholder { color: transparent; opacity: 0; }
        .chat-overlay-collapsed-input::-moz-placeholder { color: transparent; opacity: 0; }
    `

    const placeholderStyleTagContent = `
      .chat-overlay-collapsed-input::placeholder {
          color: transparent;
          opacity: 0;
      }
      .chat-overlay-collapsed-input::-webkit-input-placeholder {
          color: transparent;
          opacity: 0;
      }
      .chat-overlay-collapsed-input::-moz-placeholder {
          color: transparent;
          opacity: 0;
      }
      .chat-overlay-collapsed-input:-ms-input-placeholder {
          color: transparent;
          opacity: 0;
      }
      .chat-overlay-collapsed-input::-ms-input-placeholder {
          color: transparent;
          opacity: 0;
      }
      
      /* --- VIEW TRANSITIONS API STYLES --- */
      
      /* 1. The Container Geometry (Position/Size) */
      ::view-transition-group(chat-overlay-morph) {
        /* Faster duration for snappier collapse */
        animation-duration: 0.2s;
        animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
        overflow: hidden;
        border-radius: ${universalBorderRadius}px;
      }

      /* 2. The Content Snapshots (Pill vs Card) */
      ::view-transition-old(chat-overlay-morph),
      ::view-transition-new(chat-overlay-morph) {
        /* 'cover' prevents the stretching/bending */
        height: 100%;
        width: 100%;
        object-fit: cover; 
        object-position: center; /* Keeps content centered while scaling */
        overflow: clip;
      }
      
      /* 3. Animation Timing - Overlap them to prevent "empty/clipped" look */
      
      /* Old content (Disappearing) */
      ::view-transition-old(chat-overlay-morph) {
        /* Fade out faster to match total duration */
        animation: 0.1s ease-out both fade-out;
      }

      /* New content (Appearing) */
      ::view-transition-new(chat-overlay-morph) {
        /* Start fading in IMMEDIATELY (no delay) to fill the void */
        animation: 0.2s ease-out both fade-in;
      }
      
      /* --- Mobile Backdrop Transition --- */
      ::view-transition-group(mobile-backdrop) {
        animation-duration: 0.2s;
        animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
      }
      
      ::view-transition-new(mobile-backdrop) {
        animation: 0.2s ease-out both fade-in;
      }
      
      ::view-transition-old(mobile-backdrop) {
        animation: 0.2s ease-out both fade-out;
      }

      /* --- Send/Call Button Morph --- */
      ::view-transition-group(send-button-morph) {
        animation-duration: 0.2s;
        animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
      }

      ::view-transition-new(send-button-morph),
      ::view-transition-old(send-button-morph) {
        animation: none;
      }

      @keyframes fade-out { 
        0% { opacity: 1; }
        100% { opacity: 0; } 
      }
      @keyframes fade-in { 
        0% { opacity: 0; }
        100% { opacity: 1; } 
      }
  `

    const isCanvas = RenderTarget.current() === RenderTarget.canvas

    const [copiedMessageIndex, setCopiedMessageIndex] = useState<number | null>(
        null
    )
    const copyTimeoutRef = useRef<any>(null)

    useEffect(() => {
        return () => {
            if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current)
        }
    }, [])

    const handleCopy = useCallback((text: string, index: number) => {
        if (typeof navigator !== "undefined" && navigator.clipboard) {
            navigator.clipboard.writeText(text)
            if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current)
            setCopiedMessageIndex(index)
            copyTimeoutRef.current = setTimeout(() => {
                setCopiedMessageIndex(null)
            }, 2000)
        }
    }, [])

    async function uploadFileToGemini(
        file: File
    ): Promise<{ uri: string; name?: string; mimeType?: string } | null> {
        try {
            const endpoint = `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${geminiApiKey}&uploadType=media`
            const res = await fetch(endpoint, {
                method: "POST",
                headers: {
                    "Content-Type": file.type || "application/octet-stream",
                },
                body: file,
            })
            if (!res.ok) return null
            const data = await res.json()
            const uri = data?.file?.uri || data?.uri || data?.name || ""
            if (!uri) return null
            return {
                uri,
                name: data?.file?.displayName || file.name,
                mimeType: data?.file?.mimeType || file.type,
            }
        } catch (e) {
            return null
        }
    }

    const dragControls = useDragControls()
    const { scrollY } = useScroll()

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

    const [input, setInput] = useState<string>("")
    const [expanded, setExpanded] = useState<boolean>(false)
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
    const [isLoading, setIsLoading] = useState<boolean>(false)
    
    // Rotating suggestions logic for collapsed placeholder
    const [currentSuggestionIndex, setCurrentSuggestionIndex] = useState(0)
    
    const allDefaultSuggestions = defaultSuggestions.filter(
        (s) => s && s.trim() !== ""
    )
    
    // Create rotation cycle: placeholder first, then suggestions
    const rotationCycle = rotateSuggestions && allDefaultSuggestions.length > 0
        ? [placeholder, ...allDefaultSuggestions]
        : [placeholder]

    // Cycle through placeholder + suggestions in collapsed view
    useEffect(() => {
        if (isCanvas || expanded || !rotateSuggestions || rotationCycle.length <= 1) return
        
        // Reset index when suggestions change
        setCurrentSuggestionIndex(0)
        
        const intervalId = setInterval(
            () => {
                setCurrentSuggestionIndex(
                    (prev) => (prev + 1) % rotationCycle.length
                )
            },
            Math.max(1, suggestionRotateInterval) * 1000
        )
        return () => clearInterval(intervalId)
    }, [rotationCycle.length, suggestionRotateInterval, isCanvas, rotateSuggestions, expanded])
    
    // Determine active placeholder text for collapsed view
    const activePlaceholder = rotateSuggestions && rotationCycle.length > 1
        ? rotationCycle[currentSuggestionIndex]
        : placeholder
    const [error, setError] = useState<string>("")
    const [streamed, setStreamed] = useState<string>("")
    const [imageFile, setImageFile] = useState<File | null>(null)
    const [imagePreviewUrl, setImagePreviewUrl] = useState<string>("")
    const [attachmentPreview, setAttachmentPreview] = useState<{
        name: string
        type: string
    } | null>(null)
    const [attachmentFile, setAttachmentFile] = useState<File | null>(null)
    const [isRecording, setIsRecording] = useState<boolean>(false)
    const [recordedAudioUrl, setRecordedAudioUrl] = useState<string>("")
    const mediaRecorderRef = useRef<MediaRecorder | null>(null)
    const audioChunksRef = useRef<Blob[]>([])
    const [speakingMessageIndex, setSpeakingMessageIndex] = useState<
        number | null
    >(null)

    const [isMobileView, setIsMobileView] = useState<boolean>(
        typeof window !== "undefined"
            ? window.innerWidth < DESKTOP_BREAKPOINT
            : false
    )
    const [selectedVoice, setSelectedVoice] =
        useState<SpeechSynthesisVoice | null>(null)

    const [expandedViewBottomOffset, setExpandedViewBottomOffset] =
        useState<number>(DEFAULT_EXPANDED_BOTTOM_OFFSET)

    const [aiGeneratedSuggestions, setAiGeneratedSuggestions] = useState<
        string[]
    >([])

    const abortControllerRef = useRef<AbortController | null>(null)
    const inputBarRef = useRef<HTMLDivElement | null>(null)
    const collapsedInputRef = useRef<HTMLInputElement | null>(null)
    const inputRef = useRef<HTMLTextAreaElement | null>(null)
    const fileInputRef = useRef<HTMLInputElement | null>(null)
    const messagesEndRef = useRef<HTMLDivElement | null>(null)
    const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null)
    const recordedAudioBlobRef = useRef<Blob | null>(null)
    const expandedOverlayRef = useRef<HTMLDivElement | null>(null)
    const initialFocusPendingRef = useRef(true)
    const scrollContainerRef = useRef<HTMLDivElement | null>(null)
    const gestureStartRef = useRef<{ y: number; isDragging: boolean } | null>(
        null
    )
    const prevIsLoadingRef = useRef<boolean>(isLoading)
    const prevExpandedRef = useRef<boolean>(expanded)
    const prevScrollY = useRef(
        typeof window !== "undefined" ? window.scrollY : 0
    )

    // -------------------------------------------------------------------------
    // -------------------------------------------------------------------------
    // Gemini Live API with Built-in Interruption Support
    // -------------------------------------------------------------------------
    // How interruption works:
    // 1. We continuously stream user audio to the API (even while AI is talking)
    // 2. The API has built-in VAD that automatically detects when user speaks
    // 3. When the API detects interruption, it sends: { serverContent: { interrupted: true } }
    // 4. We immediately stop all audio playback and discard the audio buffer
    // 5. We continue streaming user audio so the API can process the new input
    // 6. No manual signaling needed - the API handles everything!
    // -------------------------------------------------------------------------
    const [isLiveMode, setIsLiveMode] = useState(false)
    const [isLiveGenerating, setIsLiveGenerating] = useState(false)
    const [userIsSpeaking, setUserIsSpeaking] = useState(false)
    const liveClientRef = useRef<WebSocket | null>(null)
    const liveAudioContextRef = useRef<AudioContext | null>(null)
    const liveInputStreamRef = useRef<MediaStream | null>(null)
    const liveProcessorRef = useRef<ScriptProcessorNode | null>(null)
    const liveSourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
    const liveNextPlayTimeRef = useRef(0)
    const activeAudioSourcesRef = useRef<AudioBufferSourceNode[]>([])
    const lastUserSpeechTimeRef = useRef(0)
    const lastTranscriptionTimeRef = useRef(0)
    const transcriptionTimeoutRef = useRef<any>(null)
    const suggestionsGeneratedForTurnRef = useRef(false)
    const isUserMessageInProgressRef = useRef(false)
    
    // Use refs for real-time checks inside audio processor (avoid stale closure)
    const isLiveGeneratingRef = useRef(false)
    const userIsSpeakingRef = useRef(false)

    // Stop all currently playing AI audio sources
    // Called when the server sends interrupted: true
    const stopAllAudio = useCallback(() => {
        activeAudioSourcesRef.current.forEach(source => {
            try {
                source.stop()
                source.disconnect()
            } catch (e) {
                // Source may already be stopped
            }
        })
        activeAudioSourcesRef.current = []
        
        // Reset the play time so new audio starts immediately after interruption
        if (liveAudioContextRef.current) {
            liveNextPlayTimeRef.current = liveAudioContextRef.current.currentTime
        }
    }, [])

    const stopLiveSession = useCallback(() => {
        stopAllAudio()
        if (liveClientRef.current) {
            liveClientRef.current.close()
            liveClientRef.current = null
        }
        if (liveProcessorRef.current) {
            liveProcessorRef.current.disconnect()
            liveProcessorRef.current = null
        }
        if (liveSourceRef.current) {
            liveSourceRef.current.disconnect()
            liveSourceRef.current = null
        }
        if (liveInputStreamRef.current) {
            liveInputStreamRef.current
                .getTracks()
                .forEach((track) => track.stop())
            liveInputStreamRef.current = null
        }
        if (liveAudioContextRef.current) {
            liveAudioContextRef.current.close()
            liveAudioContextRef.current = null
        }
        if (transcriptionTimeoutRef.current) {
            clearTimeout(transcriptionTimeoutRef.current)
            transcriptionTimeoutRef.current = null
        }
        setIsLiveMode(false)
        isLiveGeneratingRef.current = false
        setIsLiveGenerating(false)
        userIsSpeakingRef.current = false
        setUserIsSpeaking(false)
        suggestionsGeneratedForTurnRef.current = false
        isUserMessageInProgressRef.current = false
    }, [stopAllAudio])

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
                        setAiGeneratedSuggestions([])
                    }
                } else {
                    setAiGeneratedSuggestions([])
                }
            } catch (e) {
                setAiGeneratedSuggestions([])
            }
        },
        [geminiApiKey, enableAiSuggestions]
    )

    const startLiveSession = useCallback(async () => {
        if (!geminiApiKey) return

        // UPDATED: Use the latest native audio preview model for genuine live experience
        const liveModel = "models/gemini-2.5-flash-native-audio-preview-12-2025"

        try {
            const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${geminiApiKey}`
            const ws = new WebSocket(url)
            liveClientRef.current = ws

            ws.onopen = async () => {
                ws.send(
                    JSON.stringify({
                        setup: {
                            model: liveModel,
                            generationConfig: {
                                responseModalities: ["AUDIO"],
                                speechConfig: {
                                    voiceConfig: {
                                        prebuiltVoiceConfig: {
                                            voiceName: "Puck"
                                        }
                                    }
                                }
                            },
                            systemInstruction: {
                                parts: [{ text: systemPrompt }],
                            },
                            // Enable transcription - this uses Gemini's server-side native audio transcription
                            // NOT on-device dictation. The gemini-2.5-flash-native-audio model has
                            // significantly better transcription quality than older models
                            inputAudioTranscription: {
                                // Enable transcription of user input
                            },
                            outputAudioTranscription: {
                                // Enable transcription of AI responses
                            },
                        },
                    })
                )

                // Safari Audio Context: do not force sampleRate
                const AudioContextClass =
                    window.AudioContext || window.webkitAudioContext
                const audioCtx = new AudioContextClass()

                // FIX: Resume audio context if suspended (common browser behavior especially Safari)
                if (audioCtx.state === "suspended") {
                    await audioCtx.resume()
                }

                liveAudioContextRef.current = audioCtx
                liveNextPlayTimeRef.current = audioCtx.currentTime + 0.1

                try {
                    // Capture with optimized settings for speech recognition
                    const stream = await navigator.mediaDevices.getUserMedia({
                        audio: {
                            sampleRate: 16000, // Request 16kHz directly if possible
                            channelCount: 1,
                            echoCancellation: true,
                            noiseSuppression: true, 
                            autoGainControl: true,
                            // Advanced constraints for better dictation quality
                            latency: 0.01, // Low latency for real-time
                        },
                    })
                    liveInputStreamRef.current = stream
                    const source = audioCtx.createMediaStreamSource(stream)
                    liveSourceRef.current = source

                    // Use larger buffer for better audio quality (8192 samples ~= 170ms at 48kHz)
                    const processor = audioCtx.createScriptProcessor(8192, 1, 1)
                    liveProcessorRef.current = processor

                    // Optional: Keep simple local VAD for UI feedback only (not for interruption control)
                    let consecutiveSpeechFrames = 0
                    const SPEECH_FRAMES_THRESHOLD = 2 // Reduced for faster response

                    processor.onaudioprocess = (e) => {
                        if (!liveClientRef.current) return
                        let inputData = e.inputBuffer.getChannelData(0)

                        // Send raw audio data - let Gemini handle noise/normalization
                        // Browser constraints already handle basic echo cancellation and noise suppression

                        // Voice Activity Detection for UI feedback only
                        // We rely on Gemini's Server-Side VAD for actual interruption handling
                        const isSpeaking = detectVoiceActivity(inputData, interruptionThreshold)
                        
                        if (isSpeaking) {
                            consecutiveSpeechFrames++
                            lastUserSpeechTimeRef.current = Date.now()
                            
                            // Update UI state to show "User is speaking"
                            if (consecutiveSpeechFrames >= SPEECH_FRAMES_THRESHOLD && !userIsSpeakingRef.current) {
                                userIsSpeakingRef.current = true
                                setUserIsSpeaking(true)
                            }
                        } else {
                            consecutiveSpeechFrames = 0
                            // User stopped speaking after 500ms of silence
                            if (userIsSpeakingRef.current && Date.now() - lastUserSpeechTimeRef.current > 500) {
                                userIsSpeakingRef.current = false
                                setUserIsSpeaking(false)
                            }
                        }

                        // CRITICAL: Always stream audio to the API, even while AI is talking
                        // This allows the API's built-in VAD to detect interruptions automatically
                        // High-quality downsample to 16kHz for Gemini Input
                        const downsampledData = downsampleBuffer(
                            inputData,
                            audioCtx.sampleRate,
                            INPUT_TARGET_SAMPLE_RATE
                        )

                        const b64 = float32ToBase64(downsampledData)

                        // Always send audio chunks - API needs continuous stream for interruption detection
                        if (ws.readyState === WebSocket.OPEN && b64.length > 0) {
                            ws.send(
                                JSON.stringify({
                                    realtimeInput: {
                                        mediaChunks: [
                                            {
                                                mimeType: `audio/pcm;rate=${INPUT_TARGET_SAMPLE_RATE}`,
                                                data: b64,
                                            },
                                        ],
                                    },
                                })
                            )
                        }
                    }

                    source.connect(processor)
                    processor.connect(audioCtx.destination)
                } catch (err) {
                    console.error("Audio capture failed", err)
                    stopLiveSession()
                }
            }

            ws.onmessage = async (event) => {
                try {
                    let data
                    if (event.data instanceof Blob) {
                        data = JSON.parse(await event.data.text())
                    } else {
                        data = JSON.parse(event.data)
                    }

                    if (data.serverContent?.interrupted) {
                        console.log("🤖 Gemini Interrupted by Server")
                        stopAllAudio()
                        setIsLiveGenerating(false)
                        // Clear any queued messages/audio that might be processing
                        return
                    }

                    if (data.serverContent?.modelTurn?.parts) {
                        isLiveGeneratingRef.current = true
                        setIsLiveGenerating(true) // AI is actively generating content
                        
                        // Reset flags for this new AI turn
                        suggestionsGeneratedForTurnRef.current = false
                        isUserMessageInProgressRef.current = false // Ready for next user message
                        
                        const parts = data.serverContent.modelTurn.parts
                        for (const part of parts) {
                            if (part.inlineData) {
                                if (
                                    liveAudioContextRef.current &&
                                    part.inlineData.data &&
                                    !data.serverContent?.turnComplete // Don't play if turn is complete (sometimes sent at end)
                                ) {
                                    const audioCtx = liveAudioContextRef.current
                                    const float32 = base64ToFloat32Array(
                                        part.inlineData.data
                                    )
                                    // Gemini 2.5 Native Audio is 24kHz
                                    const buffer = audioCtx.createBuffer(
                                        1,
                                        float32.length,
                                        MODEL_OUTPUT_SAMPLE_RATE
                                    )
                                    buffer.copyToChannel(float32, 0)

                                    const source = audioCtx.createBufferSource()
                                    source.buffer = buffer
                                    source.connect(audioCtx.destination)

                                    const now = audioCtx.currentTime
                                    const playTime = Math.max(
                                        now,
                                        liveNextPlayTimeRef.current
                                    )
                                    source.start(playTime)
                                    liveNextPlayTimeRef.current =
                                        playTime + buffer.duration
                                    
                                    // Track this source so we can stop it on interruption
                                    activeAudioSourcesRef.current.push(source)
                                    
                                    // Clean up when done
                                    source.onended = () => {
                                        activeAudioSourcesRef.current = activeAudioSourcesRef.current.filter(s => s !== source)
                                    }
                                }
                            }
                        }
                    }

                    if (data.serverContent?.turnComplete) {
                        isLiveGeneratingRef.current = false
                        setIsLiveGenerating(false) // Turn is complete
                        
                        // Clear transcription timeout since turn is officially complete
                        if (transcriptionTimeoutRef.current) {
                            clearTimeout(transcriptionTimeoutRef.current)
                            transcriptionTimeoutRef.current = null
                        }
                        
                        // Generate suggestions only if we haven't already from transcription timeout
                        if (enableAiSuggestions && !suggestionsGeneratedForTurnRef.current) {
                            setMessages((prev) => {
                                const lastAssistantMsg = [...prev]
                                    .reverse()
                                    .find((m) => m.role === "assistant")
                                
                                if (lastAssistantMsg && typeof lastAssistantMsg.content === "string" && lastAssistantMsg.content.trim()) {
                                    fetchAiSuggestions(lastAssistantMsg.content.trim())
                                }
                                return prev
                            })
                        }
                    }

                    if (data.serverContent?.outputTranscription?.text) {
                        const text = data.serverContent.outputTranscription.text
                        
                        // Track when transcription text arrives
                        lastTranscriptionTimeRef.current = Date.now()
                        
                        // Clear existing timeout
                        if (transcriptionTimeoutRef.current) {
                            clearTimeout(transcriptionTimeoutRef.current)
                        }
                        
                        // Set timeout to detect when transcription stops (800ms of no new text)
                        transcriptionTimeoutRef.current = setTimeout(() => {
                            // Transcription appears to be complete - generate suggestions now
                            if (enableAiSuggestions && !suggestionsGeneratedForTurnRef.current) {
                                setMessages((prev) => {
                                    const lastAssistantMsg = [...prev]
                                        .reverse()
                                        .find((m) => m.role === "assistant")
                                    
                                    if (lastAssistantMsg && typeof lastAssistantMsg.content === "string" && lastAssistantMsg.content.trim()) {
                                        fetchAiSuggestions(lastAssistantMsg.content.trim())
                                        suggestionsGeneratedForTurnRef.current = true
                                    }
                                    return prev
                                })
                            }
                        }, 800) // Wait 800ms after last text chunk to consider transcription complete
                        
                        startTransition(() => {
                            setMessages((prev) => {
                                const last = prev[prev.length - 1]
                                if (last && last.role === "assistant") {
                                    return [
                                        ...prev.slice(0, -1),
                                        {
                                            ...last,
                                            content:
                                                (last.content as string) + text,
                                        },
                                    ]
                                }
                                return [
                                    ...prev,
                                    { role: "assistant", content: text },
                                ]
                            })
                        })
                    }

                    if (data.serverContent?.inputTranscription?.text) {
                        const text = data.serverContent.inputTranscription.text
                        
                        startTransition(() => {
                            setMessages((prev) => {
                                const last = prev[prev.length - 1]
                                const isAppendingToExisting = last && last.role === "user" && typeof last.content === "string"
                                
                                // Clear suggestions when user starts NEW message (not appending)
                                if (!isAppendingToExisting && !isUserMessageInProgressRef.current) {
                                    setAiGeneratedSuggestions([])
                                    isUserMessageInProgressRef.current = true
                                }
                                
                                if (isAppendingToExisting) {
                                    return [
                                        ...prev.slice(0, -1),
                                        { ...last, content: last.content + text },
                                    ]
                                }
                                return [...prev, { role: "user", content: text }]
                            })
                        })
                    }
                } catch (e) {
                    console.error("WS Parse Error", e)
                }
            }

            ws.onclose = (ev) => {
                console.log("WebSocket Closed", ev.code, ev.reason)
                stopLiveSession()
            }

            ws.onerror = (e) => {
                console.error("WebSocket Error", e)
                stopLiveSession()
            }

            setIsLiveMode(true)
            if (!expanded) {
                startTransition(() => setExpanded(true))
            }
        } catch (e) {
            console.error("Live Init Error", e)
            stopLiveSession()
        }
    }, [geminiApiKey, model, expanded, stopLiveSession, systemPrompt, interruptionThreshold, isLiveGenerating, userIsSpeaking, stopAllAudio, fetchAiSuggestions, enableAiSuggestions])

    const handleToggleLive = (e: React.MouseEvent) => {
        e.stopPropagation()
        if (!enableGeminiLive) return
        if (isLiveMode) {
            stopLiveSession()
        } else {
            startLiveSession()
        }
    }

    const [scrollRevealStyle, setScrollRevealStyle] =
        useState<CSSProperties | null>(() => {
            const isStaticEnv =
                RenderTarget.current() === RenderTarget.canvas ||
                RenderTarget.current() === RenderTarget.thumbnail
            if (!enableScrollReveal || expanded || isStaticEnv) return null
            if (typeof window === "undefined") {
                return {
                    opacity: 0.5,
                    transform: "translateY(400px) scale(0.3)",
                }
            }
            const initialVisible = window.scrollY >= 10
            return {
                opacity: initialVisible ? 1 : 0.5,
                transform: initialVisible
                    ? "translateY(0px) scale(1)"
                    : "translateY(400px) scale(0.3)",
            }
        })

    const hasContent = !!(input.trim() || imageFile || attachmentFile)
    const isCollapsedSendDisabled = isLoading || !hasContent
    const sendButtonEffectiveOpacity = isCollapsedSendDisabled ? 0.5 : 1

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

        const previous = prevScrollY.current
        const direction = latest > previous ? "down" : "up"
        prevScrollY.current = latest

        const shouldShow = latest >= 10 && direction === "down"

        setScrollRevealStyle({
            opacity: shouldShow ? 1 : 0.5,
            transform: shouldShow
                ? "translateY(0px) scale(1)"
                : "translateY(400px) scale(0.3)",
        })
    })

    useEffect(() => {
        if (
            typeof document === "undefined" ||
            typeof document.body === "undefined" ||
            typeof window === "undefined"
        ) {
            return
        }

        if (expanded && isMobileView) {
            // Capture current scroll position before locking
            const scrollY = window.scrollY
            const originalBodyOverflow = document.body.style.overflow
            const originalBodyPosition = document.body.style.position
            const originalBodyTop = document.body.style.top
            const originalBodyWidth = document.body.style.width
            const originalBodyTouchAction = document.body.style.touchAction
            const originalBodyPaddingRight = document.body.style.paddingRight

            const scrollbarWidth =
                window.innerWidth - document.documentElement.clientWidth

            // Lock body scroll by fixing position and offsetting by scroll amount
            document.body.style.position = "fixed"
            document.body.style.top = `-${scrollY}px`
            document.body.style.width = "100%"
            document.body.style.overflow = "hidden"
            document.body.style.touchAction = "none"
            if (scrollbarWidth > 0) {
                document.body.style.paddingRight = `${scrollbarWidth}px`
            }

            return () => {
                // Restore original styles
                document.body.style.position = originalBodyPosition
                document.body.style.top = originalBodyTop
                document.body.style.width = originalBodyWidth
                document.body.style.overflow = originalBodyOverflow
                document.body.style.touchAction = originalBodyTouchAction
                if (scrollbarWidth > 0) {
                    document.body.style.paddingRight = originalBodyPaddingRight
                }
                
                // Restore scroll position
                window.scrollTo(0, scrollY)
            }
        }
    }, [expanded, isMobileView])

    const handleStopGeneration = useCallback(() => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort()
        }
    }, [])

    const handleCollapse = useCallback(() => {
        const doCollapse = () => {
            setExpanded(false)
            setSpeakingMessageIndex(null)
            if (typeof window !== "undefined" && window.speechSynthesis) {
                window.speechSynthesis.cancel()
            }
            if (utteranceRef.current) utteranceRef.current = null
            handleStopGeneration()
            initialFocusPendingRef.current = true
        }

        // Check for browser support
        if (
            typeof document !== "undefined" &&
            "startViewTransition" in document
        ) {
            ;(document as any).startViewTransition(() => {
                // FORCE synchronous update so browser captures the new state immediately
                flushSync(() => {
                    doCollapse()
                })
            })
        } else {
            // Fallback for browsers without support
            startTransition(() => doCollapse())
        }
    }, [handleStopGeneration])

    const handleExpand = useCallback(() => {
        // Calculate offset logic...
        if (inputBarRef.current && typeof window !== "undefined") {
            const rect = inputBarRef.current.getBoundingClientRect()
            const distanceFromViewportBottom = window.innerHeight - rect.bottom
            setExpandedViewBottomOffset(
                Math.max(distanceFromViewportBottom, 16)
            )
        } else {
            setExpandedViewBottomOffset(DEFAULT_EXPANDED_BOTTOM_OFFSET)
        }

        if (
            typeof document !== "undefined" &&
            "startViewTransition" in document
        ) {
            ;(document as any).startViewTransition(() => {
                flushSync(() => {
                    setExpanded(true)
                })
            })
        } else {
            startTransition(() => setExpanded(true))
        }
    }, [handleStopGeneration])

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

    useEffect(() => {
        if (
            imageFile &&
            typeof window !== "undefined" &&
            imageFile.type &&
            imageFile.type.startsWith("image/")
        ) {
            const objectUrl = URL.createObjectURL(imageFile)
            setImagePreviewUrl(objectUrl)
            return () => URL.revokeObjectURL(objectUrl)
        } else {
            const isVideoSelected = !!(
                attachmentFile && attachmentFile.type.startsWith("video/")
            )
            if (!isVideoSelected) setImagePreviewUrl("")
        }
    }, [imageFile, attachmentFile])

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

    useEffect(() => {
        if (expanded && messagesEndRef.current) {
            setTimeout(() => {
                messagesEndRef.current?.scrollIntoView({ behavior: "auto" })
            }, 0)
        }
    }, [expanded])

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

    // Cleanup transcription timeout on unmount
    useEffect(() => {
        return () => {
            if (transcriptionTimeoutRef.current) {
                clearTimeout(transcriptionTimeoutRef.current)
            }
        }
    }, [])

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

    async function sendMessage(overrideText?: string) {
        if (isLoading) return
        setAiGeneratedSuggestions([])

        const textToSend = overrideText || input
        const imageFileToSend = overrideText ? null : imageFile
        const attachmentFileToSend = overrideText ? null : attachmentFile
        const recordedAudioBlobToSend = overrideText
            ? null
            : recordedAudioBlobRef.current

        if (
            (!textToSend.trim() &&
                !imageFileToSend &&
                !attachmentFileToSend &&
                !recordedAudioBlobToSend) ||
            !geminiApiKey
        ) {
            if (!geminiApiKey) setError("Gemini API key is required.")
            return
        }

        if (abortControllerRef.current) {
            abortControllerRef.current.abort()
        }

        abortControllerRef.current = new AbortController()
        const signal = abortControllerRef.current.signal

        setIsLoading(true)
        setError("")
        setStreamed("")

        let userContentForState: Message["content"]

        if (overrideText) {
            userContentForState = overrideText
        } else if (imageFileToSend) {
            try {
                const base64 = await new Promise<string>((resolve, reject) => {
                    if (typeof window !== "undefined" && window.FileReader) {
                        const reader = new window.FileReader()
                        reader.onload = () => {
                            const result = reader.result as string
                            if (typeof result === "string") {
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

                const parts: Array<
                    | { type: "text"; text: string }
                    | { type: "image_url"; image_url: { url: string } }
                > = []

                if (textToSend.trim())
                    parts.push({ type: "text", text: textToSend })

                parts.push({
                    type: "image_url",
                    image_url: {
                        url: `data:${imageFileToSend.type};base64,${base64}`,
                    },
                })
                userContentForState = parts
            } catch (e: any) {
                setError("Failed to process image. " + e.message)
                setIsLoading(false)
                abortControllerRef.current = null
                return
            }
        } else if (attachmentFileToSend) {
            const parts: any[] = []
            if (textToSend.trim())
                parts.push({ type: "text", text: textToSend })
            parts.push({
                type: "file",
                file: {
                    uri: "local:attachment",
                    name: attachmentFileToSend.name,
                    mimeType: attachmentFileToSend.type,
                },
            })
            userContentForState = parts
        } else if (recordedAudioBlobToSend) {
            const parts: any[] = []
            if (textToSend.trim())
                parts.push({ type: "text", text: textToSend })
            parts.push({
                type: "file",
                file: {
                    uri: "local:recording",
                    mimeType: "audio/webm",
                    name: "recording.webm",
                },
            })
            userContentForState = parts
        } else {
            userContentForState = textToSend
        }

        const newUserMessage: Message = {
            role: "user",
            content: userContentForState,
        }

        const currentMessagesSnapshot = messages

        startTransition(() => {
            setMessages((prev) => [...prev, newUserMessage])
            setInput("")

            if (
                overrideText ||
                imageFileToSend ||
                attachmentFileToSend ||
                recordedAudioBlobToSend
            ) {
                setImageFile(null)
                setAttachmentFile(null)
                if (recordedAudioUrl) {
                    try {
                        URL.revokeObjectURL(recordedAudioUrl)
                    } catch {}
                    setRecordedAudioUrl("")
                    recordedAudioBlobRef.current = null
                }
                if (fileInputRef.current) fileInputRef.current.value = ""
            }

            setTimeout(() => {
                if (expanded && messagesEndRef.current)
                    messagesEndRef.current.scrollIntoView({
                        behavior: "smooth",
                    })
            }, 0)
        })

        const systemInstructionMessage = currentMessagesSnapshot.find(
            (msg) => msg.role === "system"
        )

        const chatHistoryForApi = [
            ...currentMessagesSnapshot.filter(
                (m) => m.role === "user" || m.role === "assistant"
            ),
            newUserMessage,
        ]

        const geminiContents = await Promise.all(
            chatHistoryForApi.map(async (msg) => {
                const role = msg.role === "assistant" ? "model" : "user"
                let parts: any[] = []

                if (Array.isArray(msg.content)) {
                    const transformed = await Promise.all(
                        msg.content.map(async (part) => {
                            if (part.type === "text") {
                                return { text: part.text }
                            }
                            if (
                                part.type === "image_url" &&
                                part.image_url?.url
                            ) {
                                const [header, base64Data] =
                                    part.image_url.url.split(",")
                                if (!base64Data) {
                                    return null
                                }
                                const mimeTypeMatch =
                                    header.match(/data:(.*);base64/)
                                const mimeType = mimeTypeMatch
                                    ? mimeTypeMatch[1]
                                    : "image/jpeg"
                                return {
                                    inlineData: { mimeType, data: base64Data },
                                }
                            }
                            if (part.type === "file" && part.file?.uri) {
                                const mimeType =
                                    part.file.mimeType ||
                                    "application/octet-stream"
                                if (
                                    part.file.uri === "local:attachment" &&
                                    attachmentFileToSend
                                ) {
                                    try {
                                        if (
                                            attachmentFileToSend.size <=
                                            INLINE_MAX_BYTES
                                        ) {
                                            const b64 =
                                                await new Promise<string>(
                                                    (resolve, reject) => {
                                                        const fr =
                                                            new FileReader()
                                                        fr.onload = () => {
                                                            const res =
                                                                fr.result as string
                                                            resolve(
                                                                res.substring(
                                                                    res.indexOf(
                                                                        ","
                                                                    ) + 1
                                                                )
                                                            )
                                                        }
                                                        fr.onerror = reject
                                                        fr.readAsDataURL(
                                                            attachmentFileToSend
                                                        )
                                                    }
                                                )
                                            return {
                                                inlineData: {
                                                    mimeType:
                                                        attachmentFileToSend.type ||
                                                        mimeType,
                                                    data: b64,
                                                },
                                            }
                                        } else {
                                            const uploaded =
                                                await uploadFileToGemini(
                                                    attachmentFileToSend
                                                )
                                            if (uploaded?.uri) {
                                                return {
                                                    fileData: {
                                                        fileUri: uploaded.uri,
                                                        mimeType:
                                                            uploaded.mimeType ||
                                                            mimeType,
                                                    },
                                                }
                                            }
                                        }
                                    } catch (e) {
                                        console.error(
                                            "Attachment transform failed",
                                            e
                                        )
                                    }
                                    return null
                                }
                                if (
                                    part.file.uri === "local:recording" &&
                                    recordedAudioBlobToSend
                                ) {
                                    try {
                                        if (
                                            recordedAudioBlobToSend.size <=
                                            INLINE_MAX_BYTES
                                        ) {
                                            const arrayBuf =
                                                await recordedAudioBlobToSend.arrayBuffer()
                                            const b64 = btoa(
                                                String.fromCharCode(
                                                    ...new Uint8Array(arrayBuf)
                                                )
                                            )
                                            return {
                                                inlineData: {
                                                    mimeType: "audio/webm",
                                                    data: b64,
                                                },
                                            }
                                        } else {
                                            const f = new File(
                                                [recordedAudioBlobToSend],
                                                "recording.webm",
                                                { type: "audio/webm" }
                                            )
                                            const uploaded =
                                                await uploadFileToGemini(f)
                                            if (uploaded?.uri) {
                                                return {
                                                    fileData: {
                                                        fileUri: uploaded.uri,
                                                        mimeType: "audio/webm",
                                                    },
                                                }
                                            }
                                        }
                                    } catch (e) {
                                        console.error(
                                            "Recording transform failed",
                                            e
                                        )
                                    }
                                    return null
                                }
                                if (part.file.uri.startsWith("blob:")) {
                                    try {
                                        const resp = await fetch(part.file.uri)
                                        const buf = await resp.arrayBuffer()
                                        const b64 = btoa(
                                            String.fromCharCode(
                                                ...new Uint8Array(buf)
                                            )
                                        )
                                        return {
                                            inlineData: { mimeType, data: b64 },
                                        }
                                    } catch (e) {
                                        console.error(
                                            "Blob inline transform failed",
                                            e
                                        )
                                    }
                                    return null
                                }
                                return {
                                    fileData: {
                                        fileUri: part.file.uri,
                                        mimeType,
                                    },
                                }
                            }
                            return null
                        })
                    )
                    parts = transformed.filter(Boolean)
                } else if (typeof msg.content === "string") {
                    parts = [{ text: msg.content }]
                }

                if (
                    parts.length === 0 &&
                    (role === "user" || role === "model")
                ) {
                    parts.push({ text: "" })
                }
                return { role, parts }
            })
        )

        const geminiPayload: any = {
            contents: geminiContents,
        }

        if (
            systemInstructionMessage &&
            typeof systemInstructionMessage.content === "string" &&
            systemInstructionMessage.content.trim() !== ""
        ) {
            geminiPayload.systemInstruction = {
                parts: [{ text: systemInstructionMessage.content }],
            }
        }

        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${geminiApiKey}&alt=sse`

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
                                // ignore
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

    const handleInput = (
        e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
    ) => {
        setInput(e.target.value)
    }

    const handleExpandedViewKeyDown = (
        e: React.KeyboardEvent<HTMLTextAreaElement>
    ) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault()
            if (!isLoading && (input.trim() || imageFile)) sendMessage()
        }
    }

    const handleExpandedViewSendClick = () => {
        if (
            !isLoading &&
            (input.trim() || imageFile || attachmentFile || recordedAudioUrl)
        )
            sendMessage()
    }

    const handleSuggestionClick = (suggestionText: string) => {
        if (!isLoading && suggestionText.trim()) {
            sendMessage(suggestionText)
        }
    }

    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files && e.target.files[0]
        if (!file) {
            setImageFile(null)
            setAttachmentFile(null)
            setAttachmentPreview(null)
            return
        }
        if (file.type.startsWith("image/")) {
            setImageFile(file)
            setAttachmentFile(null)
            setAttachmentPreview(null)
        } else if (file.type.startsWith("video/")) {
            try {
                const url = URL.createObjectURL(file)
                const video = document.createElement("video")
                video.src = url
                video.muted = true
                video.playsInline = true as any
                video.currentTime = 0
                const capture = () => {
                    const canvas = document.createElement("canvas")
                    const w = 320
                    const h = Math.max(
                        1,
                        Math.round((video.videoHeight / video.videoWidth) * w)
                    )
                    canvas.width = w
                    canvas.height = h
                    const ctx = canvas.getContext("2d")
                    if (ctx) {
                        ctx.drawImage(video, 0, 0, w, h)
                        const dataUrl = canvas.toDataURL("image/jpeg", 0.8)
                        setImagePreviewUrl((prev) => {
                            if (prev)
                                try {
                                    URL.revokeObjectURL(prev)
                                } catch {}
                            return dataUrl
                        })
                        setImageFile(file)
                        setAttachmentFile(null)
                        setAttachmentPreview(null)
                        try {
                            URL.revokeObjectURL(url)
                        } catch {}
                    }
                }
                video.onloadeddata = () => capture()
                video.onerror = () => {
                    setAttachmentFile(file)
                    setAttachmentPreview({ name: file.name, type: file.type })
                    try {
                        URL.revokeObjectURL(url)
                    } catch {}
                }
            } catch {
                setAttachmentFile(file)
                setAttachmentPreview({ name: file.name, type: file.type })
            }
        } else {
            setAttachmentFile(file)
            setAttachmentPreview({ name: file.name, type: file.type })
            setImageFile(null)
            setImagePreviewUrl("")
        }
        setAiGeneratedSuggestions([])
        if (!expanded && file) handleExpand()
    }

    const handleAttachmentChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files && e.target.files[0]
        setAttachmentFile(file || null)
        if (!expanded && file) handleExpand()
    }

    const toggleRecording = async () => {
        if (typeof window === "undefined") return
        try {
            if (!isRecording) {
                if (
                    !navigator.mediaDevices ||
                    !navigator.mediaDevices.getUserMedia
                )
                    return
                const stream = await navigator.mediaDevices.getUserMedia({
                    audio: true,
                })
                const mr = new MediaRecorder(stream)
                audioChunksRef.current = []
                mr.ondataavailable = (evt) => {
                    if (evt.data && evt.data.size > 0)
                        audioChunksRef.current.push(evt.data)
                }
                mr.onstop = () => {
                    const blob = new Blob(audioChunksRef.current, {
                        type: "audio/webm",
                    })
                    recordedAudioBlobRef.current = blob
                    const url = URL.createObjectURL(blob)
                    setRecordedAudioUrl((prev) => {
                        if (prev) URL.revokeObjectURL(prev)
                        return url
                    })
                }
                mr.start()
                mediaRecorderRef.current = mr
                setIsRecording(true)
            } else {
                mediaRecorderRef.current?.stop()
                mediaRecorderRef.current = null
                setIsRecording(false)
            }
        } catch (err) {
            console.error("Recording error:", err)
        }
    }

    const handleRemoveImage = (e: React.MouseEvent<HTMLDivElement>) => {
        e.stopPropagation()
        setImageFile(null)
        setAttachmentFile(null)
        setAttachmentPreview(null)
        if (fileInputRef.current) fileInputRef.current.value = ""
    }

    const handlePlayTTS = (text: string, index: number) => {
        if (
            typeof window !== "undefined" &&
            window.speechSynthesis &&
            selectedVoice
        ) {
            if (window.speechSynthesis.speaking) {
                window.speechSynthesis.cancel()
                if (speakingMessageIndex === index) {
                    setSpeakingMessageIndex(null)
                    utteranceRef.current = null
                    return
                }
            }

            const cleanedText = stripMarkdownForTTS(text)

            utteranceRef.current = new SpeechSynthesisUtterance(cleanedText)
            utteranceRef.current.voice = selectedVoice
            utteranceRef.current.rate = 1.1
            utteranceRef.current.pitch = 1.0
            utteranceRef.current.volume = 1.0

            utteranceRef.current.onend = () => {
                setSpeakingMessageIndex(null)
                utteranceRef.current = null
            }

            utteranceRef.current.onerror = (event) => {
                console.error("SpeechSynthesisUtterance.onerror:", event)
                setSpeakingMessageIndex(null)
                utteranceRef.current = null
            }

            window.speechSynthesis.speak(utteranceRef.current)
            setSpeakingMessageIndex(index)
        } else if (!selectedVoice && typeof window !== "undefined") {
            console.error("TTS voice not available.")
        }
    }

    const handleStopTTS = () => {
        if (typeof window !== "undefined" && window.speechSynthesis) {
            window.speechSynthesis.cancel()
        }
        setSpeakingMessageIndex(null)
        utteranceRef.current = null
    }

    const finalDesktopPosStyle: CSSProperties = {
        width: 760,
        height: 540,
        bottom: `${expandedViewBottomOffset}px`,
        left: "50%",
        borderRadius: `${universalBorderRadius}px`,
    }

    const finalMobilePosStyle: CSSProperties = {
        width: "100vw",
        height: "95dvh",
        bottom: "0",
        left: "0",
        borderRadius: `${universalBorderRadius}px ${universalBorderRadius}px 0px 0px`,
    }

    const finalPosStylesToApply = isMobileView
        ? finalMobilePosStyle
        : finalDesktopPosStyle

    const alpha = getAlphaFromColorString(chatAreaBackground)
    let backdropBlurValue = "8px"
    if (alpha <= 0.7) backdropBlurValue = "32px"
    else if (alpha <= 0.84) backdropBlurValue = "24px"
    else if (alpha <= 0.94) backdropBlurValue = "16px"

    const supportsViewTransitions =
        typeof document !== "undefined" && "startViewTransition" in document

    const overlayVariants = {
        open: {
            opacity: 1,
            y: 0,
            x:
                finalPosStylesToApply.left === "50%" && !isMobileView
                    ? "-50%"
                    : "0%",
            transition: supportsViewTransitions
                ? { duration: 0 }
                : { type: "spring", stiffness: 350, damping: 30 },
        },
        closed: {
            opacity: supportsViewTransitions ? 1 : 0,
            y: isMobileView ? (supportsViewTransitions ? 0 : "100%") : supportsViewTransitions ? 0 : 60,
            x:
                finalPosStylesToApply.left === "50%" && !isMobileView
                    ? "-50%"
                    : "0%",
            transition: supportsViewTransitions
                ? { duration: 0 }
                : { type: "spring", stiffness: 350, damping: 35 },
        },
    }

    const safeSendIconUrl = sendIconOverrideUrl?.src
    const safeLoadingIconUrl = loadingIconOverrideUrl?.src

    const markdownBaseTextStyle: CSSProperties = {
        ...globalFontStyles,
        color: props.textColor,
        wordWrap: "break-word",
    }

    const markdownLinkStyle: CSSProperties = {
        color: props.linkColor,
        textDecoration: "underline",
    }

    const errorFontStyle: CSSProperties = {
        ...globalFontStyles,
        fontSize:
            typeof globalFontStyles.fontSize === "string"
                ? `${Math.max(parseFloat(globalFontStyles.fontSize) * 0.875, 12)}px`
                : "14px",
    }

    // Determine which suggestions to show in expanded view
    const commonSuggestionDisplayConditions =
        expanded && !isLoading && !imageFile

    const showAiSuggestions =
        enableAiSuggestions &&
        aiGeneratedSuggestions.length > 0 &&
        commonSuggestionDisplayConditions

    const showPropSuggestions =
        !showAiSuggestions &&
        allDefaultSuggestions.length > 0 &&
        messages.filter((m) => m.role === "user").length === 0 &&
        commonSuggestionDisplayConditions

    let displayedSuggestions: string[] = []
    if (showAiSuggestions) {
        displayedSuggestions = aiGeneratedSuggestions
    } else if (showPropSuggestions) {
        // Mobile: show all suggestions (up to 10)
        // Desktop: show only first 3 to reduce visual clutter
        displayedSuggestions = isMobileView 
            ? allDefaultSuggestions 
            : allDefaultSuggestions.slice(0, 3)
    }

    const showSuggestionsArea = displayedSuggestions.length > 0

    const suggestedReplyButtonStyle: CSSProperties = {
        ...globalFontStyles,
        fontSize:
            typeof globalFontStyles.fontSize === "string"
                ? `${Math.max(parseFloat(globalFontStyles.fontSize as string) * 0.9, 13)}px`
                : "13px",
        lineHeight: globalFontStyles.lineHeight || "1.4em",
        color: iconColor,
        backgroundColor: "transparent",
        padding: "8px 12px",
        borderRadius: `${universalBorderRadius}px`,
        border: `1px solid ${iconColor ? iconColor.replace(/rgba?\((\d+,\s*\d+,\s*\d+)(?:,\s*[\d.]+)?\)/, "rgba($1, 0.25)") : "rgba(0,0,0,0.25)"}`,
        cursor: "pointer",
        textAlign: "center",
        whiteSpace: "normal",
        maxWidth: "180px",
        minWidth: "max-content",
        minHeight: "39px",
        wordBreak: "break-word",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        transition: "background-color 0.2s ease, border-color 0.2s ease",
    }

    const suggestionsContainerStyle: CSSProperties = {
        display: "flex",
        flexWrap: "nowrap",
        gap: "8px",
        padding: "8px 12px 12px 12px",
        justifyContent: "flex-start",
        alignItems: "stretch",
        overflowX: "auto",
        scrollbarWidth: "none",
        WebkitOverflowScrolling: "touch",
        flexShrink: 0,
        position: "relative",
    }

    const messagesScrollContainerStyle: CSSProperties = {
        flexGrow: 1,
        overflowY: "auto",
        paddingTop: 12,
        paddingLeft: 12,
        paddingRight: 12,
        paddingBottom: 8,
        display: "flex",
        flexDirection: "column",
        gap: 24,
        overscrollBehavior: "contain",
        position: "relative",
    }

    const inputAreaFrameStyle: CSSProperties = {
        width: "100%",
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
        position: "relative",
    }

    const dragIndicatorBarStyle: CSSProperties = {
        width: "100%",
        height: 16,
        paddingTop: 5,
        paddingBottom: 5,
        position: "relative",
        flexShrink: 0,
        cursor: "grab",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        touchAction: "none",
    }

    const handleContainerPointerMove = (event: PointerEvent) => {
        if (!gestureStartRef.current || gestureStartRef.current.isDragging)
            return

        const startY = gestureStartRef.current.y
        const currentY = event.clientY
        const deltaY = currentY - startY

        if (deltaY > 5) {
            gestureStartRef.current.isDragging = true
            dragControls.start(event)
            handleContainerPointerUp()
        }
    }

    const handleContainerPointerUp = () => {
        window.removeEventListener("pointermove", handleContainerPointerMove)
        window.removeEventListener("pointerup", handleContainerPointerUp)
        window.removeEventListener("pointercancel", handleContainerPointerUp)
        gestureStartRef.current = null
    }

    const handleContainerPointerDown = (event: React.PointerEvent) => {
        if (!isMobileView || event.button !== 0) return

        if (
            scrollContainerRef.current &&
            scrollContainerRef.current.scrollTop === 0
        ) {
            gestureStartRef.current = { y: event.clientY, isDragging: false }

            window.addEventListener("pointermove", handleContainerPointerMove)
            window.addEventListener("pointerup", handleContainerPointerUp)
            window.addEventListener("pointercancel", handleContainerPointerUp)
        }
    }

    useEffect(() => {
        return () => {
            handleContainerPointerUp()
        }
    }, [])

    if (expanded) {
        return (
            <Fragment>
                <style>{markdownStyles}</style>
                {isMobileView && (
                    <motion.div
                        data-layer="mobile-backdrop"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: expanded ? 1 : 0 }}
                        exit={{ opacity: 0 }}
                        transition={
                            supportsViewTransitions
                                ? { duration: 0.2, ease: [0.4, 0.0, 0.2, 1] }
                                : { duration: 0.25, ease: "easeOut" }
                        }
                        style={{
                            position: "fixed",
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            background: "rgba(0, 0, 0, 0.7)",
                            zIndex: 999,
                            viewTransitionName: "mobile-backdrop",
                        } as CSSProperties & { viewTransitionName?: string }}
                        onClick={handleCollapse}
                    />
                )}
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
                        viewTransitionName: "chat-overlay-morph",
                    } as CSSProperties & { viewTransitionName?: string }}
                >
                    <div
                        data-layer="drag-indicator-bar"
                        style={dragIndicatorBarStyle}
                        onPointerDown={(event: React.PointerEvent) => {
                            dragControls.start(event)
                            ;(event.currentTarget as HTMLElement).style.cursor =
                                "grabbing"
                        }}
                        onPointerUp={(event: React.PointerEvent) => {
                            ;(event.currentTarget as HTMLElement).style.cursor =
                                "grab"
                        }}
                        onClick={() => {
                            if (expanded) {
                                handleCollapse()
                            }
                        }}
                    >
                        <svg
                            width="32"
                            height="5"
                            viewBox="0 0 32 5"
                            fill="none"
                            xmlns="[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)"
                        >
                            <rect
                                width="32"
                                height="5"
                                rx={Math.min(universalBorderRadius, 4)}
                                fill={props.iconColor}
                                style={{ opacity: 0.65 }}
                            />
                        </svg>
                    </div>

                    <div
                        ref={scrollContainerRef}
                        onPointerDown={handleContainerPointerDown}
                        data-layer="messages-scroll-container"
                        style={messagesScrollContainerStyle}
                    >
                        {error && (
                            <div
                                style={{
                                    ...errorFontStyle,
                                    padding: 12,
                                    background: "rgba(255,0,0,0.1)",
                                    color: "rgb(180,0,0)",
                                    borderRadius: "8px",
                                    wordWrap: "break-word",
                                    textAlign: "left",
                                }}
                            >
                                {error}
                            </div>
                        )}
                        {messages
                            .filter((m) => m.role !== "system")
                            .map((message, msgIndex) => {
                                const isUser = message.role === "user"
                                const isAssistant = message.role === "assistant"

                                if (isUser) {
                                    const userContentParts = Array.isArray(
                                        message.content
                                    )
                                        ? message.content
                                        : [
                                              {
                                                  type: "text",
                                                  text: message.content as string,
                                              },
                                          ]

                                    const userImageURL = (
                                        userContentParts.find(
                                            (item) => item.type === "image_url"
                                        ) as
                                            | {
                                                  type: "image_url"
                                                  image_url: { url: string }
                                              }
                                            | undefined
                                    )?.image_url.url

                                    const userTextContent =
                                        (
                                            userContentParts.find(
                                                (item) => item.type === "text"
                                            ) as
                                                | { type: "text"; text: string }
                                                | undefined
                                        )?.text || ""

                                    return (
                                        <div
                                            key={`user-${msgIndex}`}
                                            data-layer="user-input-message"
                                            style={{
                                                alignSelf: "flex-end",
                                                display: "flex",
                                                flexDirection: "column",
                                                alignItems: "flex-end",
                                                gap: 4,
                                                maxWidth: "90%",
                                            }}
                                        >
                                            {userImageURL && (
                                                <img
                                                    data-layer="user-sent-image"
                                                    style={{
                                                        width: 76,
                                                        maxHeight: 96,
                                                        objectFit: "contain",
                                                        background:
                                                            props.chatAreaBackground,
                                                        borderRadius: 13.33,
                                                        border: `0.67px solid ${props.iconColor ? props.iconColor.replace(/rgba?\((\d+,\s*\d+,\s*\d+)(?:,\s*[\d.]+)?\)/, "rgba($1, 0.20)") : "rgba(0,0,0,0.20)"}`,
                                                    }}
                                                    src={userImageURL}
                                                    alt="User upload"
                                                />
                                            )}
                                            {userTextContent && (
                                                <div
                                                    data-layer="user-message-bubble"
                                                    style={{
                                                        maxWidth: 336,
                                                        paddingLeft: 12,
                                                        paddingRight: 12,
                                                        paddingTop: 8,
                                                        paddingBottom: 8,
                                                        background:
                                                            props.userMessageBackgroundColor,
                                                        borderRadius: `${universalBorderRadius}px`,
                                                        display: "inline-flex",
                                                    }}
                                                >
                                                    <div
                                                        data-layer="user-message-text"
                                                        style={{
                                                            ...globalFontStyles,
                                                            color: props.textColor,
                                                            wordWrap:
                                                                "break-word",
                                                            whiteSpace:
                                                                "pre-wrap",
                                                        }}
                                                    >
                                                        {userTextContent}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )
                                } else if (isAssistant) {
                                    // Check if this is the last message
                                    const isLastMessage =
                                        msgIndex === messages.length - 1
                                    // Hide actions if it is the last message AND (we are loading standard chat OR live generation is active)
                                    // Also hide if it's the welcome message
                                    const hideActions =
                                        (isLastMessage &&
                                            (isLoading || isLiveGenerating)) ||
                                        (typeof welcomeMessage === "string" &&
                                            welcomeMessage.trim() !== "" &&
                                            (message.content as string) ===
                                                welcomeMessage)

                                    return (
                                        <div
                                            key={`assistant-${msgIndex}`}
                                            data-layer="assistant-message"
                                            style={{
                                                alignSelf: "stretch",
                                                display: "flex",
                                                flexDirection: "column",
                                                alignItems: "flex-start",
                                                gap: 12,
                                            }}
                                        >
                                            <div
                                                data-layer="assistant-message-text"
                                                style={{
                                                    alignSelf: "stretch",
                                                    maxWidth: "100%",
                                                }}
                                            >
                                                {renderSimpleMarkdown(
                                                    message.content as string,
                                                    markdownBaseTextStyle,
                                                    markdownLinkStyle
                                                )}
                                            </div>
                                            <div
                                                data-layer="assistant-action-icons"
                                                style={{
                                                    display: hideActions
                                                        ? "none"
                                                        : "flex",
                                                    justifyContent:
                                                        "flex-start",
                                                    alignItems: "center",
                                                    gap: 16,
                                                }}
                                            >
                                                <button
                                                    aria-label={
                                                        copiedMessageIndex ===
                                                        msgIndex
                                                            ? "Copied"
                                                            : "Copy message"
                                                    }
                                                    onClick={() =>
                                                        handleCopy(
                                                            message.content as string,
                                                            msgIndex
                                                        )
                                                    }
                                                    style={{
                                                        background: "none",
                                                        border: "none",
                                                        padding: 0,
                                                        cursor: "pointer",
                                                        width: 16,
                                                        height: 16,
                                                        display: "flex",
                                                        alignItems: "center",
                                                        justifyContent:
                                                            "center",
                                                        transition:
                                                            "opacity 0.2s ease",
                                                    }}
                                                >
                                                    {copiedMessageIndex ===
                                                    msgIndex ? (
                                                        <svg
                                                            width="17"
                                                            height="17"
                                                            viewBox="0 0 14 14"
                                                            fill="none"
                                                            xmlns="[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)"
                                                        >
                                                            <path
                                                                d="M11.6666 3.5L5.24992 9.91667L2.33325 7"
                                                                stroke={
                                                                    props.iconColor
                                                                        ? props.iconColor.replace(
                                                                              /rgba?\((\d+,\s*\d+,\s*\d+)(?:,\s*[\d.]+)?\)/,
                                                                              "rgba($1, 0.45)"
                                                                          )
                                                                        : "rgba(0,0,0,0.45)"
                                                                }
                                                                strokeWidth="1.5"
                                                                strokeLinecap="round"
                                                                strokeLinejoin="round"
                                                            />
                                                        </svg>
                                                    ) : (
                                                        <svg
                                                            width="14"
                                                            height="14"
                                                            viewBox="0 0 14 14"
                                                            fill="none"
                                                            xmlns="[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)"
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
                                                    )}
                                                </button>
                                                {speakingMessageIndex ===
                                                msgIndex ? (
                                                    <button
                                                        aria-label="Stop speaking"
                                                        onClick={handleStopTTS}
                                                        style={{
                                                            background: "none",
                                                            border: "none",
                                                            padding: 0,
                                                            cursor: "pointer",
                                                        }}
                                                    >
                                                        <svg
                                                            width="15"
                                                            height="14"
                                                            viewBox="0 0 15 14"
                                                            fill="none"
                                                            xmlns="[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)"
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
                                                                message.content as string,
                                                                msgIndex
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
                                                            xmlns="[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)"
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
                                                xmlns="[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)"
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
                                                borderRadius: 11,
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
                                                xmlns="[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)"
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
                                {!imageFile && attachmentPreview && (
                                    <div
                                        data-layer="files"
                                        className="Files"
                                        style={{
                                            height: 48,
                                            paddingTop: 7,
                                            paddingBottom: 7,
                                            paddingRight: 12,
                                            position: "relative",
                                            background: "#EEF0F2",
                                            borderRadius: 14,
                                            justifyContent: "flex-start",
                                            alignItems: "center",
                                            gap: 8,
                                            display: "inline-flex",
                                        }}
                                    >
                                        <div
                                            onClick={handleRemoveImage}
                                            style={{
                                                position: "absolute",
                                                right: -8,
                                                top: -8,
                                                width: 22,
                                                height: 22,
                                                borderRadius: 11,
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
                                                xmlns="[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)"
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
                                        <div
                                            data-svg-wrapper
                                            data-layer="Frame 47412"
                                            className="Frame47412"
                                            style={{ position: "relative" }}
                                        >
                                            <svg
                                                width="49"
                                                height="49"
                                                viewBox="0 0 49 49"
                                                fill="none"
                                                xmlns="[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)"
                                            >
                                                <path
                                                    d="M0.8125 14.6777C0.8125 6.94575 7.08051 0.677734 14.8125 0.677734H48.8125V48.6777H14.8125C7.08051 48.6777 0.8125 42.4097 0.8125 34.6777V14.6777Z"
                                                    fill="#6AA4FB"
                                                />
                                                <path
                                                    d="M15.8125 17.6777C15.8125 17.1254 16.2602 16.6777 16.8125 16.6777H32.8125C33.3648 16.6777 33.8125 17.1254 33.8125 17.6777C33.8125 18.23 33.3648 18.6777 32.8125 18.6777H16.8125C16.2602 18.6777 15.8125 18.23 15.8125 17.6777ZM15.8125 24.6777C15.8125 24.1254 16.2602 23.6777 16.8125 23.6777H32.8125C33.3648 23.6777 33.8125 24.1254 33.8125 24.6777C33.8125 25.23 33.3648 25.6777 32.8125 25.6777H16.8125C16.2602 25.6777 15.8125 25.23 15.8125 24.6777ZM15.8125 31.6777C15.8125 31.1255 16.2602 30.6777 16.8125 30.6777H23.8125C24.3648 30.6777 24.8125 31.1255 24.8125 31.6777C24.8125 32.23 24.3648 32.6777 23.8125 32.6777H16.8125C16.2602 32.6777 15.8125 32.23 15.8125 31.6777Z"
                                                    fill="white"
                                                    fillOpacity="0.95"
                                                />
                                                <path
                                                    d="M23.8125 30.5127C33.4559 23.5127 33.9775 24.0343 33.9775 24.6777C33.9775 25.3211 33.4559 25.8428 32.8125 25.8428H16.8125C16.1691 25.8428 15.6475 25.3211 15.6475 24.6777C15.6475 24.0343 16.1691 23.5127 16.8125 23.5127H32.8125ZM32.8125 23.5127C33.4559 23.5127 33.9775 24.0343 33.9775 24.6777C33.9775 25.3211 33.4559 25.8428 32.8125 25.8428H16.8125C16.1691 25.8428 15.6475 25.3211 15.6475 24.6777C15.6475 24.0343 16.1691 23.5127 16.8125 23.5127H32.8125ZM32.8125 16.5127C33.4559 16.5127 33.9775 17.0343 33.9775 17.6777C33.9775 18.3211 33.4559 18.8428 32.8125 18.8428H16.8125C16.1691 18.8428 15.6475 18.3211 15.6475 17.6777C15.6475 17.0343 16.1691 16.5127 16.8125 16.5127H32.8125Z"
                                                    stroke="white"
                                                    strokeOpacity="0.95"
                                                    strokeWidth="0.33"
                                                />
                                            </svg>
                                        </div>
                                        <div
                                            data-layer="Frame 47417"
                                            className="Frame47417"
                                            style={{
                                                flexDirection: "column",
                                                justifyContent: "flex-start",
                                                alignItems: "flex-start",
                                                display: "inline-flex",
                                            }}
                                        >
                                            <div
                                                data-layer="fileName"
                                                className="Filename"
                                                style={{
                                                    justifyContent: "center",
                                                    display: "flex",
                                                    flexDirection: "column",
                                                    color: "rgba(0, 0, 0, 0.95)",
                                                    fontSize: 14,
                                                    fontFamily: "Inter",
                                                    fontWeight: "400",
                                                    lineHeight: 21,
                                                    wordWrap: "break-word",
                                                }}
                                            >
                                                {attachmentPreview.name}
                                            </div>
                                            <div
                                                data-layer="fileType"
                                                className="Filetype"
                                                style={{
                                                    justifyContent: "center",
                                                    display: "flex",
                                                    flexDirection: "column",
                                                    color: "rgba(0, 0, 0, 0.45)",
                                                    fontSize: 14,
                                                    fontFamily: "Inter",
                                                    fontWeight: "400",
                                                    lineHeight: 21,
                                                    wordWrap: "break-word",
                                                }}
                                            >
                                                {(
                                                    attachmentPreview.type ||
                                                    "FILE"
                                                )
                                                    .split("/")[1]
                                                    ?.toUpperCase() || "FILE"}
                                            </div>
                                        </div>
                                        <div
                                            data-svg-wrapper
                                            data-layer="Frame 47418"
                                            className="Frame47418"
                                            style={{
                                                left: 145,
                                                top: -6,
                                                position: "absolute",
                                            }}
                                        >
                                            <svg
                                                width="23"
                                                height="23"
                                                viewBox="0 0 23 23"
                                                fill="none"
                                                xmlns="[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)"
                                            >
                                                <rect
                                                    x="2.3125"
                                                    y="2.17773"
                                                    width="19"
                                                    height="19"
                                                    rx="9.5"
                                                    fill="black"
                                                />
                                                <rect
                                                    x="2.3125"
                                                    y="2.17773"
                                                    width="19"
                                                    height="19"
                                                    rx="9.5"
                                                    stroke="white"
                                                    strokeWidth="3"
                                                />
                                                <path
                                                    d="M10.9556 11.7253C10.9819 11.699 10.9819 11.6564 10.9556 11.6301L8.9801 9.65459C8.75663 9.43112 8.75663 9.06881 8.9801 8.84534C9.20357 8.62187 9.56589 8.62187 9.78936 8.84534L11.7649 10.8209C11.7912 10.8472 11.8338 10.8472 11.8601 10.8209L13.8356 8.84534C14.0591 8.62187 14.4214 8.62187 14.6449 8.84534C14.8684 9.06881 14.8684 9.43112 14.6449 9.65459L12.6694 11.6301C12.6431 11.6564 12.6431 11.699 12.6694 11.7253L14.6449 13.7009C14.8684 13.9243 14.8684 14.2867 14.6449 14.5101C14.4214 14.7336 14.0591 14.7336 13.8356 14.5101L11.8601 12.5346C11.8338 12.5083 11.7912 12.5083 11.7649 12.5346L9.78936 14.5101C9.56589 14.7336 9.20357 14.7336 8.9801 14.5101C8.75663 14.2867 8.75663 13.9243 8.9801 13.7009L10.9556 11.7253Z"
                                                    fill="white"
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
                                    aria-label="Add photos & files"
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
                                        accept="image/*,audio/*,video/*,.pdf,.txt,.md,.doc,.docx,.ppt,.pptx,.csv,.json,.xml,application/*"
                                        style={{ display: "none" }}
                                        onChange={handleImageChange}
                                        disabled={isLoading}
                                    />
                                    <svg
                                        width="36"
                                        height="36"
                                        viewBox="0 0 36 36"
                                        fill="none"
                                        xmlns="[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)"
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
                                            viewTransitionName: "send-button-morph",
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
                                                xmlns="[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)"
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
                                        aria-label={
                                            input.trim() || imageFile
                                                ? "Send message"
                                                : isLiveMode
                                                  ? "End Call"
                                                  : "Start Call"
                                        }
                                        onClick={(e) => {
                                            if (
                                                !input.trim() &&
                                                !imageFile &&
                                                !attachmentFile
                                            ) {
                                                handleToggleLive(e)
                                            } else {
                                                handleExpandedViewSendClick()
                                            }
                                        }}
                                        style={{
                                            viewTransitionName: "send-button-morph",
                                            background:
                                                !input.trim() &&
                                                !imageFile &&
                                                isLiveMode
                                                    ? "#FF3B30"
                                                    : props.sendBgColor,
                                            opacity: !input.trim() &&
                                                !imageFile &&
                                                !attachmentFile &&
                                                !enableGeminiLive ? 0.5 : 1,
                                            border: "none",
                                            borderRadius: `${universalBorderRadius}px`,
                                            width: 36,
                                            height: 36,
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            cursor: !input.trim() &&
                                                !imageFile &&
                                                !attachmentFile &&
                                                !enableGeminiLive ? "not-allowed" : "pointer",
                                            padding: 0,
                                            transition: "background 0.2s ease",
                                        }}
                                    >
                                        {input.trim() ||
                                        imageFile ||
                                        attachmentFile ||
                                        !enableGeminiLive ? (
                                            safeSendIconUrl ? (
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
                                                    xmlns="[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)"
                                                >
                                                    <rect
                                                        width="36"
                                                        height="36"
                                                        rx={
                                                            universalBorderRadius
                                                        }
                                                        fill={props.sendBgColor}
                                                    />
                                                    <path
                                                        fillRule="evenodd"
                                                        clipRule="evenodd"
                                                        d="M14.5592 18.1299L16.869 15.8202V23.3716C16.869 23.9948 17.3742 24.5 17.9974 24.5C18.6206 24.5 19.1259 23.9948 19.1259 23.3716V15.8202L21.4356 18.1299C21.8762 18.5706 22.5907 18.5706 23.0314 18.1299C23.4721 17.6893 23.4721 16.9748 23.0314 16.5341L17.9974 11.5L12.9633 16.5341C12.5226 16.9748 12.5226 17.6893 12.9633 18.1299C13.404 18.5706 14.1185 18.5706 14.5592 18.1299Z"
                                                        fill={
                                                            props.sendIconColor
                                                        }
                                                    />
                                                </svg>
                                            )
                                        ) : isLiveMode ? (
                                            // Red Hangup Button (Expanded)
                                            <div
                                                data-svg-wrapper
                                                data-layer="Vector"
                                                className="Vector"
                                                style={{
                                                    display: "flex",
                                                    justifyContent: "center",
                                                    alignItems: "center",
                                                    width: "100%",
                                                    height: "100%",
                                                }}
                                            >
                                                <svg
                                                    width="17"
                                                    height="6"
                                                    viewBox="0 0 17 6"
                                                    fill="none"
                                                    xmlns="[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)"
                                                >
                                                    <path
                                                        d="M8.26514 0C5.53748 0 2.43384 0.509839 0.923414 2.06572C0.347446 2.64882 0 3.37491 0 4.28728C0 4.89816 0.188972 5.74968 0.796291 5.90709C1.02282 6.03478 1.27756 6.01119 1.63127 5.95298L3.67811 5.61044C4.38284 5.49373 4.73813 5.22516 4.92389 4.53789L5.25979 3.29924C5.32663 3.05597 5.40452 2.96384 5.67778 2.86308C6.25446 2.66086 7.14424 2.55568 8.26514 2.55126C9.3932 2.54906 10.283 2.66086 10.8597 2.86308C11.1329 2.96384 11.2109 3.05597 11.2728 3.29924L11.6136 4.53789C11.7972 5.22516 12.1546 5.49373 12.8593 5.61044L14.9062 5.95298C15.255 6.01119 15.5098 6.03478 15.7363 5.90709C16.3485 5.74968 16.5375 4.89816 16.5375 4.28728C16.5375 3.37491 16.19 2.64882 15.614 2.06572C14.1036 0.509839 11 0 8.26514 0Z"
                                                        fill="white"
                                                    />
                                                </svg>
                                            </div>
                                        ) : (
                                            // Call Button (Expanded)
                                            <div
                                                data-svg-wrapper
                                                data-layer="Vector"
                                                className="Vector"
                                                style={{
                                                    display: "flex",
                                                    justifyContent: "center",
                                                    alignItems: "center",
                                                    width: "100%",
                                                    height: "100%",
                                                }}
                                            >
                                                <svg
                                                    width="13"
                                                    height="13"
                                                    viewBox="0 0 13 13"
                                                    fill="none"
                                                    xmlns="[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)"
                                                >
                                                    <path
                                                        d="M3.57064 9.3837C5.61989 11.4399 8.07817 13 10.0516 13C10.9769 13 11.784 12.6291 12.3163 12.038C12.8228 11.4683 13 11.0451 13 10.6648C13 10.374 12.8157 10.1 12.3587 9.78075L10.6552 8.56335C10.2316 8.26319 10.0423 8.20655 9.79145 8.20655C9.57605 8.20655 9.38954 8.24687 9.03184 8.44297L7.91947 9.05518C7.78915 9.13089 7.73028 9.14286 7.63321 9.14286C7.50064 9.14286 7.40851 9.10964 7.2782 9.05518C6.74596 8.80731 6.00274 8.2278 5.34019 7.56163C4.67765 6.89978 4.16839 6.23477 3.89458 5.69703C3.85913 5.6284 3.81879 5.51728 3.81879 5.40397C3.81879 5.31629 3.86622 5.23619 3.92294 5.14144L4.57619 4.02537C4.75833 3.72255 4.80576 3.55477 4.80576 3.31617C4.80576 3.04437 4.7136 2.75351 4.45567 2.38474L3.28436 0.749498C2.95064 0.283779 2.6998 0 2.32135 0C1.85293 0 1.28964 0.356794 0.88722 0.74461C0.307556 1.30459 0 2.08241 0 2.95938C0 4.94484 1.52849 7.34863 3.57064 9.3837Z"
                                                        fill={
                                                            props.sendIconColor
                                                        }
                                                    />
                                                </svg>
                                            </div>
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
                        : activePlaceholder || "Open chat to ask anything"
                }
                data-layer="overlay prompt input box"
                className="OverlayPromptInputBox"
                style={{
                    width: "100%",
                    height: "100%",
                    position: "relative",
                    paddingTop: 11,
                    paddingBottom: 10,
                    paddingLeft: 16,
                    paddingRight: 10,
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
                    transform:
                        !expanded && scrollRevealStyle && enableScrollReveal
                            ? (scrollRevealStyle.transform as string)
                            : undefined,
                    willChange: enableScrollReveal
                        ? "transform, opacity"
                        : undefined,
                    transition: enableScrollReveal
                        ? supportsViewTransitions
                            ? "transform 0.5s cubic-bezier(0.4, 0.0, 0.2, 1), opacity 0.5s cubic-bezier(0.4, 0.0, 0.2, 1)"
                            : "transform 0.25s ease-out, opacity 0.25s ease-out"
                        : supportsViewTransitions
                          ? "opacity 0.5s cubic-bezier(0.4, 0.0, 0.2, 1)"
                          : "opacity 0.25s ease-out",
                    viewTransitionName: expanded
                        ? "none"
                        : "chat-overlay-morph",
                    ...style,
                } as CSSProperties & { viewTransitionName?: string }}
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
                    {/* Animated Placeholder Overlay */}
                    <div
                        style={{
                            position: "absolute",
                            top: 4,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            pointerEvents: "none", // Allow clicks to pass through to input
                            overflow: "hidden",
                        }}
                    >
                        <AnimatePresence mode="popLayout" initial={false}>
                            {!input &&
                                !expanded &&
                                (isCanvas ? (
                                    <span
                                        style={{
                                            ...globalFontStyles,
                                            color: placeholderTextColor,
                                            position: "absolute",
                                            top: 0,
                                            left: 0,
                                            width: "100%",
                                            whiteSpace: "nowrap",
                                            textOverflow: "ellipsis",
                                            overflow: "hidden",
                                        }}
                                    >
                                        {activePlaceholder}
                                    </span>
                                ) : (
                                    <motion.span
                                        key={activePlaceholder}
                                        initial={{ y: 20, opacity: 0 }}
                                        animate={{ y: 0, opacity: 1 }}
                                        exit={{ y: -20, opacity: 0 }}
                                        transition={{
                                            y: {
                                                type: "spring",
                                                stiffness: 100,
                                                damping: 20,
                                            },
                                            opacity: { duration: 0.2 },
                                        }}
                                        style={{
                                            ...globalFontStyles,
                                            color: placeholderTextColor,
                                            position: "absolute",
                                            top: 0,
                                            left: 0,
                                            width: "100%",
                                            whiteSpace: "nowrap",
                                            textOverflow: "ellipsis",
                                            overflow: "hidden",
                                        }}
                                    >
                                        {activePlaceholder}
                                    </motion.span>
                                ))}
                        </AnimatePresence>
                    </div>

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
                        placeholder="" // Disabled native placeholder to use custom animation
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
                            position: "relative", // Ensure it sits above/below correctly if needed
                            zIndex: 1,
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
                                  : isLiveMode
                                    ? "End Call"
                                    : "Start Call"
                        }
                        onClick={(e) => {
                            e.stopPropagation()
                            if (isLoading) return
                            if (hasContent) {
                                if (!expanded) {
                                    sendMessage()
                                    handleExpand()
                                }
                            } else if (expanded) {
                                // Do nothing or focus input
                            } else {
                                // If collapsed and no content, toggle Live or just expand?
                                // If we want the button to trigger Live even in collapsed, we do:
                                handleToggleLive(e)
                            }
                        }}
                        style={{
                            background:
                                !input.trim() &&
                                !imageFile &&
                                isLiveMode
                                    ? "#FF3B30"
                                    : "transparent",
                            border: "none",
                            width: 36,
                            height: 36,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            padding: 0,
                            cursor: !enableGeminiLive && !hasContent ? "not-allowed" : "pointer",
                            borderRadius: `${universalBorderRadius}px`,
                            opacity: !enableGeminiLive && !hasContent ? 0.5 : 1,
                            viewTransitionName: "send-button-morph",
                        }}
                    >
                        {isLoading ? (
                            <svg
                                width="36"
                                height="36"
                                viewBox="0 0 36 36"
                                fill="none"
                                xmlns="[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)"
                            >
                                <rect
                                    width="36"
                                    height="36"
                                    rx={universalBorderRadius}
                                    fill={sendBgColor}
                                />
                                {safeLoadingIconUrl ? (
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
                                )}
                            </svg>
                        ) : hasContent || !enableGeminiLive ? (
                            // Standard Send Icon Logic (for content OR when Gemini Live is disabled)
                            <svg
                                width="36"
                                height="36"
                                viewBox="0 0 36 36"
                                fill="none"
                                xmlns="[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)"
                            >
                                <rect
                                    width="36"
                                    height="36"
                                    rx={universalBorderRadius}
                                    fill={sendBgColor}
                                />
                                {safeSendIconUrl ? (
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
                            </svg>
                        ) : isLiveMode ? (
                            // Red Hangup Button (Collapsed)
                            <div
                                data-svg-wrapper
                                data-layer="Vector"
                                className="Vector"
                                style={{
                                    display: "flex",
                                    justifyContent: "center",
                                    alignItems: "center",
                                    width: 36,
                                    height: 36,
                                    borderRadius: `${universalBorderRadius}px`,
                                    background: "#FF3B30",
                                }}
                            >
                                <svg
                                    width="17"
                                    height="6"
                                    viewBox="0 0 17 6"
                                    fill="none"
                                    xmlns="[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)"
                                >
                                    <path
                                        d="M8.26514 0C5.53748 0 2.43384 0.509839 0.923414 2.06572C0.347446 2.64882 0 3.37491 0 4.28728C0 4.89816 0.188972 5.74968 0.796291 5.90709C1.02282 6.03478 1.27756 6.01119 1.63127 5.95298L3.67811 5.61044C4.38284 5.49373 4.73813 5.22516 4.92389 4.53789L5.25979 3.29924C5.32663 3.05597 5.40452 2.96384 5.67778 2.86308C6.25446 2.66086 7.14424 2.55568 8.26514 2.55126C9.3932 2.54906 10.283 2.66086 10.8597 2.86308C11.1329 2.96384 11.2109 3.05597 11.2728 3.29924L11.6136 4.53789C11.7972 5.22516 12.1546 5.49373 12.8593 5.61044L14.9062 5.95298C15.255 6.01119 15.5098 6.03478 15.7363 5.90709C16.3485 5.74968 16.5375 4.89816 16.5375 4.28728C16.5375 3.37491 16.19 2.64882 15.614 2.06572C14.1036 0.509839 11 0 8.26514 0Z"
                                        fill="white"
                                    />
                                </svg>
                            </div>
                        ) : (
                            // Call Button (Collapsed)
                            <div
                                style={{
                                    display: "flex",
                                    justifyContent: "center",
                                    alignItems: "center",
                                    width: 36,
                                    height: 36,
                                    borderRadius: `${universalBorderRadius}px`,
                                    background: sendBgColor,
                                }}
                            >
                                <svg
                                    width="13"
                                    height="13"
                                    viewBox="0 0 13 13"
                                    fill="none"
                                    xmlns="[http://www.w3.org/2000/svg](http://www.w3.org/2000/svg)"
                                >
                                    <path
                                        d="M3.57064 9.3837C5.61989 11.4399 8.07817 13 10.0516 13C10.9769 13 11.784 12.6291 12.3163 12.038C12.8228 11.4683 13 11.0451 13 10.6648C13 10.374 12.8157 10.1 12.3587 9.78075L10.6552 8.56335C10.2316 8.26319 10.0423 8.20655 9.79145 8.20655C9.57605 8.20655 9.38954 8.24687 9.03184 8.44297L7.91947 9.05518C7.78915 9.13089 7.73028 9.14286 7.63321 9.14286C7.50064 9.14286 7.40851 9.10964 7.2782 9.05518C6.74596 8.80731 6.00274 8.2278 5.34019 7.56163C4.67765 6.89978 4.16839 6.23477 3.89458 5.69703C3.85913 5.6284 3.81879 5.51728 3.81879 5.40397C3.81879 5.31629 3.86622 5.23619 3.92294 5.14144L4.57619 4.02537C4.75833 3.72255 4.80576 3.55477 4.80576 3.31617C4.80576 3.04437 4.7136 2.75351 4.45567 2.38474L3.28436 0.749498C2.95064 0.283779 2.6998 0 2.32135 0C1.85293 0 1.28964 0.356794 0.88722 0.74461C0.307556 1.30459 0 2.08241 0 2.95938C0 4.94484 1.52849 7.34863 3.57064 9.3837Z"
                                        fill={props.sendIconColor}
                                    />
                                </svg>
                            </div>
                        )}
                    </button>
                </div>
            </div>
        </Fragment>
    )
}

// =========================================================================
// Framer Property Controls Configuration
// =========================================================================

addPropertyControls(ChatOverlay, {
    enableGeminiLive: {
        type: ControlType.Boolean,
        title: "Enable Gemini Live",
        defaultValue: true,
        description: "Enable Gemini Live voice calling. When off, call button is grayed out.",
    },
    interruptionThreshold: {
        type: ControlType.Number,
        title: "Interruption Sensitivity",
        defaultValue: 0.01,
        min: 0.001,
        max: 0.1,
        step: 0.001,
        displayStepper: true,
        description: "Voice detection threshold for interrupting AI. Lower = more sensitive. Default: 0.01",
        hidden: (props) => !props.enableGeminiLive,
    },
    geminiApiKey: {
        type: ControlType.String,
        title: "Gemini API Key",
        defaultValue: "",
        placeholder: "Paste API key",
        obscured: true,
        description: "Create a free API key on Google AI Studio",
    },
    universalBorderRadius: {
        type: ControlType.Number,
        title: "Corner Radius",
        defaultValue: 24,
        min: 0,
        max: 50,
        unit: "px",
        step: 1,
        displayStepper: true,
        description:
            "Universal corner radius for most elements (0-50px). Default: 24px.",
    },
    systemPrompt: {
        type: ControlType.String,
        title: "Instructions",
        displayTextArea: true,
        defaultValue: "You are a helpful assistant.",
        description: "System prompt to define the bot's personality and task.",
    },
    welcomeMessage: {
        type: ControlType.String,
        title: "Welcome Message",
        defaultValue: "Hi, how can I help?",
        description: "(Optional) An initial message from the assistant",
    },
    model: {
        type: ControlType.String,
        title: "AI Model",
        defaultValue: "gemini-2.5-flash-lite",
        placeholder: "model-id",
        description:
            "Ideal: gemini-2.5-flash-lite for best speed and high accuracy.",
    },
    placeholder: {
        type: ControlType.String,
        title: "Placeholder",
        defaultValue: "Ask anything",
        description: "Input field placeholder text.",
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
    rotateSuggestions: {
        type: ControlType.Boolean,
        title: "Rotate Suggestions",
        defaultValue: true,
        description: "Cycle placeholder text in collapsed view through suggestions.",
    },
    defaultSuggestions: {
        type: ControlType.Array,
        title: "Default Suggestions",
        control: {
            type: ControlType.String,
            defaultValue: "New suggestion",
        },
        defaultValue: ["Quick facts", "Proven metrics", "Contact"],
        maxCount: 10,
        description: "Mobile: shows all; Desktop: shows first 3. Rotates as placeholder if enabled.",
    },
    suggestionRotateInterval: {
        type: ControlType.Number,
        title: "Rotate Speed (s)",
        defaultValue: 3,
        min: 1,
        max: 20,
        step: 0.5,
        displayStepper: true,
        description: "Seconds between placeholder text rotations.",
        hidden: (props) => !props.rotateSuggestions,
    },
    enableAiSuggestions: {
        type: ControlType.Boolean,
        title: "AI Reply Suggestions",
        defaultValue: true,
        description: "Generate 3 AI contextual follow-up replies.",
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
        description: "Scale in from bottom on scroll.",
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