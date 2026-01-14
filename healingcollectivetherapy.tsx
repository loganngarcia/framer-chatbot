import React, { useState, useEffect, useRef, useCallback } from "react"
import { addPropertyControls, ControlType, useIsStaticRenderer } from "framer"
import { motion, AnimatePresence } from "framer-motion"

// --- Interfaces ---

interface SuggestionItem {
    id: string
    text: string
    prompt: string
    image: string
}

interface Message {
    id: string
    role: "user" | "model"
    text: string
    images?: string[]
    isStreaming?: boolean
    isError?: boolean
}

interface AIChatProps {
    // API
    apiKey: string
    modelName: string
    dictationModelName: string
    systemInstruction: string

    // Colors
    backgroundColor: string
    accentColorStart: string
    accentColorEnd: string
    textColor: string
    linkColor: string
    botBubbleColor: string
    userBubbleColor: string

    // Layout
    showRightSidebar: boolean

    // Style
    style?: React.CSSProperties
}

// --- Constants & Data ---

const CONTENT = {
    titleStart: "Ask",
    titleHighlight: "with AI",
    titleEnd: ". Tell me what's on your mind.",
    subtitle: "For example, I can suggest personalized practice activities.",
    inputPlaceholder: "Ask with AI...",
    botName: "Assistant",
}


const SUGGESTIONS_DATA: SuggestionItem[] = [
    {
        id: "ask-anything",
        text: "Ask anything 24/7.",
        prompt: "I'd like to know examples of things I can ask you. Can you help me find ways to manage my time and stress better?",
        image: "https://framerusercontent.com/images/aY4ndItQImuBMO8AwLwH1K7nMQ.jpg",
    },
    {
        id: "hipaa",
        text: "What is HIPAA?",
        prompt: "I'm concerned about the privacy of my medical records. Can you explain what HIPAA is and how it protects my healthcare information?",
        image: "https://framerusercontent.com/images/C4lepY8R20uGycwnumBh7zuLr4Q.jpg",
    },
    {
        id: "stress",
        text: "How do I reduce stress?",
        prompt: "I've been experiencing high levels of stress that are affecting my sleep and relationships. What are some effective techniques to reduce stress in daily life?",
        image: "https://framerusercontent.com/images/NiFYid5Hp5idcKNu1Mev6E3DQ5E.jpg",
    },
    {
        id: "sleep",
        text: "Why do I sleep bad?",
        prompt: "I've been struggling with insomnia for months now. I can't fall asleep, and when I do, I wake up multiple times. What could be causing this and how can I improve my sleep?",
        image: "https://framerusercontent.com/images/S1Jc9zsAgBjl5dPOL4zMMrFh6BM.jpg",
    },
    {
        id: "goals",
        text: "Set goals to accomplish.",
        prompt: "I want to be more intentional about setting and achieving personal goals. Can you help me develop a framework for setting meaningful goals and tracking my progress?",
        image: "https://framerusercontent.com/images/YTyWQHrnceeCjdy0l9fMgniD8.jpg",
    },
    {
        id: "business-coaching",
        text: "Get business coaching.",
        prompt: "I'm starting my own small business and feeling overwhelmed. What areas should I focus on, and how can coaching help me develop the skills I need to succeed?",
        image: "https://framerusercontent.com/images/opojWS28Oebd0VqDY1QxDv2JGk.jpg",
    },
    {
        id: "psychotherapy",
        text: "How do I get psychotherapy?",
        prompt: "I think I might benefit from talking to a therapist, but I don't know where to start. How do I find the right psychotherapist for my needs and what should I expect?",
        image: "https://framerusercontent.com/images/qyN4QvyVmcgiWUV8NlKF99M4PI.jpg",
    },
    {
        id: "anxiety",
        text: "What is anxiety?",
        prompt: "I've been experiencing racing thoughts, constant worry, and physical symptoms like rapid heartbeat. Is there science behind the calming effects of nature, and how can I incorporate more nature into my busy urban life?",
        image: "https://framerusercontent.com/images/r4hPut6o5j3uVLuBkWPx8JlEl0.jpg",
    },
    {
        id: "yoga",
        text: "Guide me through a yoga session.",
        prompt: "I'd like to try yoga for stress relief but I'm a complete beginner. Could you guide me through a simple 10-minute yoga routine that I can do at home?",
        image: "https://framerusercontent.com/images/cDnhM5zYPBK97uBX86L5ogvIE8.jpg",
    },
    {
        id: "nature",
        text: "Nature makes you calm.",
        prompt: "I've noticed I feel more peaceful when I spend time outdoors. Is there science behind the calming effects of nature, and how can I incorporate more nature into my busy urban life?",
        image: "https://framerusercontent.com/images/q7RQHrKn5AGstlHQy5MmWWdGUe8.jpg",
    },
    {
        id: "mindfulness",
        text: "Let's practice mindfulness.",
        prompt: "I keep hearing about mindfulness meditation but don't know where to start. Can you explain what mindfulness is and guide me through a basic practice I can try today?",
        image: "https://framerusercontent.com/images/YVC1AcsCBRIHD1pP9TtveQPc6E.jpg",
    },
    {
        id: "calendar",
        text: "Help me create a calendar.",
        prompt: "I'm struggling to balance work, self-care, and family time. Can you help me create a weekly schedule that includes time for all my priorities without burning out?",
        image: "https://framerusercontent.com/images/i9otDcBrFtMHcG8KwSnkmhTA6sk.jpg",
    },
    {
        id: "journal",
        text: "Help me start a journal.",
        prompt: "I want to start journaling for emotional processing and self-reflection, but I'm not sure how to begin. What are some effective journaling techniques and prompts to get started?",
        image: "https://framerusercontent.com/images/G0LYsgHF836eKKlXuUdHq3dzQ.jpg",
    },
    {
        id: "friends",
        text: "How do I make friends?",
        prompt: "Since moving to a new city, I've been feeling isolated. What are some practical ways to meet people and develop meaningful friendships as an adult?",
        image: "https://framerusercontent.com/images/02wpFkp4FUCVJ0U8lhv6zoXVIQ.jpg",
    },
    {
        id: "diet",
        text: "Can a healthy diet make me happy?",
        prompt: "I've been experiencing mood swings and low energy. Is there a connection between diet and mental health? What foods might help improve my mood and overall wellbeing?",
        image: "https://framerusercontent.com/images/ICX9371PHPrtLJZcHylC3utVrk.jpg",
    },
    {
        id: "emotional-support-animal",
        text: "How do I get an emotional support animal?",
        prompt: "I think having an emotional support animal might help with my anxiety. What's the process for getting one, and what rights do I have regarding housing and travel?",
        image: "https://framerusercontent.com/images/quzLnZNRUcN5OLa4ANuEG62r2UU.jpg",
    },
    {
        id: "trauma",
        text: "How do I heal from trauma?",
        prompt: "I experienced a traumatic event several years ago and still feel affected by it. What approaches are effective for trauma healing, and how do I know if I need professional help?",
        image: "https://framerusercontent.com/images/kASWWEU5HeDwAKPQXGpKF3d7FoE.jpg",
    },
    {
        id: "adoption",
        text: "Should I adopt a child one day?",
        prompt: "I'm considering adoption in the future but have many questions. What factors should I consider when thinking about adopting a child, and how can I prepare emotionally and practically?",
        image: "https://framerusercontent.com/images/EYbOGtdunNEg5blu9jgBAmxz2r0.jpg",
    },
    {
        id: "self-actualization",
        text: "How do I reach self-actualization?",
        prompt: "I've been thinking about Maslow's hierarchy of needs and wonder about self-actualization. What does it really mean to self-actualize, and what practical steps can I take toward personal growth?",
        image: "https://framerusercontent.com/images/sXBWqveqYpMLVTPNFOcgz66FCI.jpg",
    },
    {
        id: "salary",
        text: "How do I negotiate a salary?",
        prompt: "I have a job offer but the salary is lower than I expected. How can I negotiate effectively without risking the opportunity? What strategies and language should I use?",
        image: "https://framerusercontent.com/images/jEGylDG9aLchXubKrnvaPa5yM7o.jpg",
    },
    {
        id: "self-love",
        text: "How can I practice self-love?",
        prompt: "I tend to be very critical of myself and it's affecting my confidence and happiness. What are some practical ways to develop self-compassion and a healthier relationship with myself?",
        image: "https://framerusercontent.com/images/NCaG6wAgLOmlpyKCAFj8FLHHrM.jpg",
    },
    {
        id: "headaches",
        text: "Why do I get headaches?",
        prompt: "I've been experiencing frequent headaches that impact my daily life. What could be causing them, and what's the difference between regular headaches and migraines?",
        image: "https://framerusercontent.com/images/PlmAYqnUuHNQ2vhRZzITvnSfJg.jpg",
    },
    {
        id: "age-discrimination",
        text: "How to defy age discrimination.",
        prompt: "I'm concerned about age discrimination as I get older, especially in my workplace. What strategies can I use to combat ageism and continue to advance in my career?",
        image: "https://framerusercontent.com/images/A2mbjVAKarTa09Ni5RJWVBqHU.jpg",
    },
    {
        id: "kids-therapy",
        text: "Should my kids get therapy?",
        prompt: "My children have been through some difficult family changes. How do I know if they could benefit from therapy, and what's the best way to approach this topic with them?",
        image: "https://framerusercontent.com/images/ksWAvO5rXJc6lvdt8fMWhOMJRE.jpg",
    },
]

// --- Helper Functions ---

const isDarkMode = () => {
    if (typeof window !== "undefined" && window.matchMedia) {
        return window.matchMedia("(prefers-color-scheme: dark)").matches
    }
    return false
}

const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.readAsDataURL(file)
        reader.onload = () => {
            let encoded = reader.result as string
            encoded = encoded.replace(/^data:(.*,)?/, "")
            resolve(encoded)
        }
        reader.onerror = (error) => reject(error)
    })
}

const hexToRgba = (hex: string, alpha: number) => {
    let c: any
    // Handle Hex
    if (/^#([A-Fa-f0-9]{3}){1,2}$/.test(hex)) {
        c = hex.substring(1).split("")
        if (c.length === 3) {
            c = [c[0], c[0], c[1], c[1], c[2], c[2]]
        }
        c = parseInt("0x" + c.join(""))
        return (
            "rgba(" +
            [(c >> 16) & 255, (c >> 8) & 255, c & 255].join(",") +
            "," +
            alpha +
            ")"
        )
    }
    // Handle RGB/RGBA
    if (hex.startsWith("rgb")) {
        const match = hex.match(/(\d+(\.\d+)?)/g)
        if (match && match.length >= 3) {
            return `rgba(${match[0]}, ${match[1]}, ${match[2]}, ${alpha})`
        }
    }
    return hex
}

const shuffleArray = (array: SuggestionItem[]) => {
    const newArray = [...array]
    for (let i = newArray.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[newArray[i], newArray[j]] = [newArray[j], newArray[i]]
    }
    return newArray
}

// --- Exponential Backoff Retry Logic ---
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function fetchWithRetry(url: string, options: RequestInit, maxRetries = 3): Promise<Response> {
    let lastError: Error | null = null
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const response = await fetch(url, options)
            
            // If rate limited, retry with exponential backoff
            if (response.status === 429) {
                const retryAfter = response.headers.get('Retry-After')
                const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : Math.pow(2, attempt) * 1000
                console.warn(`Rate limited. Retrying after ${waitTime}ms...`)
                await sleep(waitTime)
                continue
            }
            
            // If server error, retry
            if (response.status >= 500) {
                const waitTime = Math.pow(2, attempt) * 1000
                console.warn(`Server error ${response.status}. Retrying after ${waitTime}ms...`)
                await sleep(waitTime)
                continue
            }
            
            return response
        } catch (error) {
            lastError = error as Error
            if (attempt < maxRetries - 1) {
                const waitTime = Math.pow(2, attempt) * 1000
                console.warn(`Request failed. Retrying after ${waitTime}ms...`, error)
                await sleep(waitTime)
            }
        }
    }
    
    throw lastError || new Error('Max retries exceeded')
}

// --- Robust Markdown Parser ---

const parseInline = (text: string, textColor: string, linkColor: string) => {
    const parts: (string | React.ReactNode)[] = []
    let lastIndex = 0
    // Matches **bold**, *italic*, [link](url), or `code`
    const regex =
        /(\*\*(.*?)\*\*)|(\*(.*?)\*)|(\[(.*?)\]\((.*?)\))|(`(.*?)`)/g
    let match

    while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            parts.push(text.substring(lastIndex, match.index))
        }

        if (match[1]) {
            // Bold
            parts.push(<strong key={match.index}>{match[2]}</strong>)
        } else if (match[3]) {
            // Italic
            parts.push(<em key={match.index}>{match[4]}</em>)
        } else if (match[5]) {
            // Link
            parts.push(
                <a
                    key={match.index}
                    href={match[7]}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                        color: linkColor,
                        textDecoration: "underline",
                        fontWeight: 600,
                    }}
                >
                    {match[6]}
                </a>
            )
        } else if (match[8]) {
            // Inline Code
            parts.push(
                <span
                    key={match.index}
                    style={{
                        backgroundColor: hexToRgba(textColor, 0.1),
                        padding: "2px 4px",
                        borderRadius: 4,
                        fontFamily: "monospace",
                        fontSize: "0.9em",
                    }}
                >
                    {match[9]}
                </span>
            )
        }
        lastIndex = regex.lastIndex
    }

    if (lastIndex < text.length) {
        parts.push(text.substring(lastIndex))
    }
    return parts
}

const MarkdownRenderer = ({
    content,
    textColor,
    linkColor,
}: {
    content: string
    textColor: string
    linkColor: string
}) => {
    const lines = content.split("\n")
    const elements: React.ReactNode[] = []
    let i = 0

    while (i < lines.length) {
        const line = lines[i]
        const trimmed = line.trim()

        // 1. Code Blocks
        if (trimmed.startsWith("```")) {
            const codeLines: string[] = []
            i++
            while (i < lines.length && !lines[i].trim().startsWith("```")) {
                codeLines.push(lines[i])
                i++
            }
            elements.push(
                <div
                    key={`code-${i}`}
                    style={{
                        backgroundColor: hexToRgba(textColor, 0.05),
                        borderRadius: 12,
                        padding: 16,
                        margin: "16px 0",
                        fontFamily: "monospace",
                        fontSize: 14,
                        overflowX: "auto",
                        whiteSpace: "pre",
                    }}
                >
                    {codeLines.join("\n")}
                </div>
            )
            i++
            continue
        }

        // 2. Tables (More robust detection)
        // Look for |---| pattern in the NEXT line or the one after
        const isTableStart =
            trimmed.startsWith("|") ||
            (i + 1 < lines.length && lines[i + 1].trim().startsWith("|") && lines[i + 1].includes("---"))
        
        if (isTableStart && lines[i].includes("|")) {
             // We have a table header potentially
             // Let's verify separator exists
             let separatorIndex = -1
             if (trimmed.includes("---")) {
                 // Current line is separator? (Rare but possible if header missing)
                 separatorIndex = i
             } else if (i + 1 < lines.length && lines[i+1].includes("---")) {
                 separatorIndex = i + 1
             }

             if (separatorIndex !== -1) {
                 const headerLine = separatorIndex === i ? "" : lines[i]
                 const separatorLine = lines[separatorIndex]
                 
                 // Process Header
                 const headers = headerLine
                    .split("|")
                    .filter(c => c.trim().length > 0)
                    .map(c => c.trim())
                 
                 // Process Rows
                 const rows: string[][] = []
                 let r = separatorIndex + 1
                 while (r < lines.length && lines[r].trim().startsWith("|")) {
                     const rowCells = lines[r]
                        .split("|")
                        // Filter empty strings caused by leading/trailing pipes
                        // But be careful not to remove empty cells in middle
                        .map(c => c.trim())
                     
                     // Clean up: usually split("|") on "| a | b |" gives ["", "a", "b", ""]
                     // We remove first and last if empty
                     if (rowCells[0] === "") rowCells.shift()
                     if (rowCells[rowCells.length - 1] === "") rowCells.pop()
                     
                     rows.push(rowCells)
                     r++
                 }

                 elements.push(
                    <div
                        key={`table-${i}`}
                        style={{
                            margin: "24px 0",
                            borderRadius: 28, // 28px Radius as requested
                            border: `1px solid ${hexToRgba(textColor, 0.1)}`,
                            overflowX: "auto",
                            overflowY: "hidden",
                            width: "100%",
                        }}
                    >
                        <table
                            style={{
                                width: "100%",
                                borderCollapse: "collapse",
                                fontSize: 15,
                                minWidth: 600, // Ensure it doesn't squash on mobile
                            }}
                        >
                            {headers.length > 0 && (
                                <thead style={{ backgroundColor: hexToRgba(textColor, 0.03) }}>
                                    <tr>
                                        {headers.map((h, hIdx) => (
                                            <th
                                                key={hIdx}
                                                style={{
                                                    padding: "16px 20px",
                                                    textAlign: "left",
                                                    borderBottom: `1px solid ${hexToRgba(textColor, 0.1)}`,
                                                    fontWeight: 600,
                                                    color: textColor,
                                                    whiteSpace: "nowrap",
                                                }}
                                            >
                                                {parseInline(h, textColor, linkColor)}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                            )}
                            <tbody>
                                {rows.map((row, rIdx) => (
                                    <tr key={rIdx}>
                                        {row.map((cell, cIdx) => (
                                            <td
                                                key={cIdx}
                                                style={{
                                                    padding: "14px 20px",
                                                    borderBottom: rIdx === rows.length - 1
                                                            ? "none"
                                                            : `1px solid ${hexToRgba(textColor, 0.05)}`,
                                                    color: textColor,
                                                    // FIRST COLUMN COLOR Logic:
                                                    backgroundColor: cIdx === 0 
                                                        ? hexToRgba(textColor, 0.12) 
                                                        : "transparent",
                                                }}
                                            >
                                                {parseInline(cell, textColor, linkColor)}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                 )
                 
                 i = r // Move index past the table
                 continue
             }
        }

        // 3. Headers
        if (line.startsWith("#")) {
            const level = line.match(/^#+/)?.[0].length || 1
            const text = line.replace(/^#+\s*/, "")
            const fontSize = level === 1 ? 28 : level === 2 ? 24 : level === 3 ? 20 : 18
            elements.push(
                <div
                    key={`h-${i}`}
                    style={{
                        fontSize,
                        fontWeight: 600,
                        margin: "24px 0 12px 0",
                        lineHeight: 1.3,
                    }}
                >
                    {parseInline(text, textColor, linkColor)}
                </div>
            )
            i++
            continue
        }

        // 4. Lists
        if (trimmed.match(/^[-*]\s/)) {
            elements.push(
                <div
                    key={`li-${i}`}
                    style={{
                        display: "flex",
                        marginLeft: 8,
                        marginBottom: 8,
                        lineHeight: 1.6,
                    }}
                >
                    <span style={{ marginRight: 12, opacity: 0.65 }}>•</span>
                    <div>{parseInline(trimmed.replace(/^[-*]\s/, ""), textColor, linkColor)}</div>
                </div>
            )
            i++
            continue
        }
        
        if (trimmed.match(/^\d+\.\s/)) {
            const number = trimmed.match(/^(\d+)\./)?.[1]
            elements.push(
                <div
                    key={`li-ord-${i}`}
                    style={{
                        display: "flex",
                        marginLeft: 8,
                        marginBottom: 8,
                        lineHeight: 1.6,
                    }}
                >
                    <span style={{ marginRight: 12, opacity: 0.65, minWidth: 20 }}>{number}.</span>
                    <div>{parseInline(trimmed.replace(/^\d+\.\s/, ""), textColor, linkColor)}</div>
                </div>
            )
            i++
            continue
        }

        // 5. Paragraphs
        if (trimmed === "") {
            elements.push(<div key={`br-${i}`} style={{ height: 16 }} />)
        } else {
            elements.push(
                <div key={`p-${i}`} style={{ marginBottom: 4, lineHeight: 1.7 }}>
                    {parseInline(trimmed, textColor, linkColor)}
                </div>
            )
        }
        i++
    }

    return <div style={{ width: "100%", overflowX: "hidden" }}>{elements}</div>
}

// --- Helper Components ---

const GoldCursor = ({ colorStart, colorEnd }: { colorStart: string; colorEnd: string }) => (
    <motion.div
        style={{
            width: 20,
            height: 20,
            borderRadius: "50%",
            background: `radial-gradient(circle at 30% 30%, ${colorStart}, ${colorEnd})`,
            boxShadow: `0 0 8px ${colorStart}60`,
            display: "inline-block",
            verticalAlign: "text-bottom",
            marginLeft: 6,
            marginBottom: 2,
        }}
        animate={{ scale: [0.85, 1] }}
        transition={{ duration: 0.8, repeat: Infinity, repeatType: "reverse", ease: "easeInOut" }}
    />
)

/**
 * AI Chat Interface (Gemini 3 Flash Preview)
 * @framerIntrinsicWidth 1000
 * @framerIntrinsicHeight 800
 * @framerSupportedLayoutWidth fixed
 * @framerSupportedLayoutHeight fixed
 */
export default function AIChat(props: AIChatProps) {
        const {
        apiKey,
        modelName = "gemini-2.5-flash-lite",
        dictationModelName = "gemini-2.5-flash-lite",
        systemInstruction = "",
        backgroundColor = "#FFFFFF",
        accentColorStart = "#FFC938",
        accentColorEnd = "#B86914",
        textColor = "#000000",
        linkColor = "#0066CC",
        botBubbleColor = "#FFFFFF",
        userBubbleColor = "#F3F4F6",
        showRightSidebar = true,
        style,
    } = props

    const isStatic = useIsStaticRenderer()

    // State
    const [view, setView] = useState<"home" | "chat">("home")
    const [messages, setMessages] = useState<Message[]>([])
    const [conversationHistory, setConversationHistory] = useState<any[]>([])
    const [inputText, setInputText] = useState("")
    const [attachedImages, setAttachedImages] = useState<string[]>([])
    const [isTyping, setIsTyping] = useState(false)
    const [isListening, setIsListening] = useState(false)
    const [wasDictated, setWasDictated] = useState(false)
    const [shuffledSuggestions, setShuffledSuggestions] = useState<SuggestionItem[]>([])
    const [currentHash, setCurrentHash] = useState<string>("")
    const [isMobile, setIsMobile] = useState(false)

    // Refs
    const scrollRef = useRef<HTMLDivElement>(null)
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const mediaRecorderRef = useRef<MediaRecorder | null>(null)
    const audioChunksRef = useRef<Blob[]>([])
    const abortControllerRef = useRef<AbortController | null>(null)

    // --- Initialization ---
    useEffect(() => {
        const others = SUGGESTIONS_DATA.filter((s) => s.id !== "ask-anything")
        const first = SUGGESTIONS_DATA.find((s) => s.id === "ask-anything")
        setShuffledSuggestions(
            first ? [first, ...shuffleArray(others)] : shuffleArray(others)
        )
    }, [])

    // --- Mobile Detection ---
    useEffect(() => {
        if (typeof window === "undefined") return
        const checkMobile = () => setIsMobile(window.innerWidth < 768)
        checkMobile()
        window.addEventListener("resize", checkMobile)
        return () => window.removeEventListener("resize", checkMobile)
    }, [])

    // --- Hash Change & Reset Logic ---
    // Poll for hash changes (fallback for environments where hashchange doesn't fire)
    useEffect(() => {
        if (typeof window === "undefined") return

        const updateHash = () => {
            const hash = window.location.hash
            setCurrentHash(hash)
        }

        // Update immediately
        updateHash()

        // Poll every 200ms to catch any hash changes
        const pollInterval = setInterval(updateHash, 200)

        // Also listen to events
        window.addEventListener("hashchange", updateHash)
        window.addEventListener("popstate", updateHash)
        
        return () => {
            clearInterval(pollInterval)
            window.removeEventListener("hashchange", updateHash)
            window.removeEventListener("popstate", updateHash)
        }
    }, [])

    // React to hash changes
    useEffect(() => {
        if (typeof window === "undefined") return
        
        const hash = currentHash.toLowerCase().trim()
        
        if (hash === "#new-chat") {
            // Abort any ongoing requests
            if (abortControllerRef.current) {
                abortControllerRef.current.abort()
                abortControllerRef.current = null
            }
            
            // Reset all state
            setView("home")
            setMessages([])
            setConversationHistory([])
            setInputText("")
            setAttachedImages([])
            setIsTyping(false)
            setWasDictated(false)
            
            // Re-shuffle suggestions
            const others = SUGGESTIONS_DATA.filter(s => s.id !== "ask-anything")
            const first = SUGGESTIONS_DATA.find(s => s.id === "ask-anything")
            setShuffledSuggestions(first ? [first, ...shuffleArray(others)] : shuffleArray(others))

            // Remove hash after state updates
            requestAnimationFrame(() => {
                window.history.replaceState(null, "", window.location.pathname + window.location.search)
                setCurrentHash("")
            })
        }
    }, [currentHash])

    // --- Auto-Scroll ---
    const scrollToLastUserMessage = () => {
        // Only scroll if we have messages
        if (messages.length === 0) return

        // Find the last user message
        const lastUserMessage = [...messages].reverse().find(m => m.role === "user")
        
        if (lastUserMessage && scrollRef.current) {
            requestAnimationFrame(() => {
                const element = document.getElementById(`msg-${lastUserMessage.id}`)
                if (element && scrollRef.current) {
                    const container = scrollRef.current
                    const elementRect = element.getBoundingClientRect()
                    const containerRect = container.getBoundingClientRect()
                    
                    // Calculate position relative to container
                    const relativeTop = elementRect.top - containerRect.top + container.scrollTop
                    
                    // Offset: 96px on mobile, 24px on desktop (for breathing room)
                    const offset = isMobile ? 128 : 48
                    
                    container.scrollTo({
                        top: Math.max(0, relativeTop - offset),
                        behavior: "smooth"
                    })
                }
            })
        }
    }

    useEffect(() => {
        // Scroll when view changes to chat or when NEW messages are added (length changes)
        // This avoids scrolling on every token update during streaming
        scrollToLastUserMessage()
    }, [messages.length, view])

    // --- Dictation (Gemini API) ---
    const transcribeAudio = async (audioBlob: Blob) => {
        if (!apiKey) {
            alert("Please provide a Gemini API Key for dictation.")
            return
        }
        
        try {
            const reader = new FileReader()
            reader.readAsDataURL(audioBlob)
            reader.onloadend = async () => {
                const base64Audio = (reader.result as string).split(",")[1]
                
                const requestBody = {
                    contents: [{
                        parts: [
                            { text: "Transcribe the following audio exactly as spoken. Do not add any commentary." },
                            {
                                inline_data: {
                                    mime_type: audioBlob.type,
                                    data: base64Audio
                                }
                            }
                        ]
                    }]
                }

                // Use the dedicated dictation model with retry logic
                const response = await fetchWithRetry(
                    `https://generativelanguage.googleapis.com/v1beta/models/${dictationModelName}:generateContent?key=${apiKey}`,
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(requestBody)
                    }
                )
                
                if (!response.ok) {
                    const errorText = await response.text()
                    throw new Error(`Gemini API Error: ${response.status} - ${errorText}`)
                }

                const data = await response.json()
                const transcript = data.candidates?.[0]?.content?.parts?.[0]?.text || ""
                
                if (transcript) {
                    setInputText(prev => {
                        const newText = prev ? prev + " " + transcript.trim() : transcript.trim()
                        return newText
                    })
                    setWasDictated(true)
                }
            }
        } catch (error) {
            console.error("Transcription error:", error)
            alert("Failed to transcribe audio. Please try again.")
        }
    }

    const toggleDictation = async () => {
        if (isListening) {
            // STOP RECORDING
            mediaRecorderRef.current?.stop()
            setIsListening(false)
        } else {
            // START RECORDING
            try {
                if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                    alert("Microphone access is not supported in this browser.")
                    return
                }

                const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
                
                // Prefer webm or mp4
                let mimeType = "audio/webm"
                if (MediaRecorder.isTypeSupported("audio/mp4")) {
                    mimeType = "audio/mp4"
                } else if (MediaRecorder.isTypeSupported("audio/aac")) {
                    mimeType = "audio/aac"
                }

                const mediaRecorder = new MediaRecorder(stream, { mimeType })
                mediaRecorderRef.current = mediaRecorder
                audioChunksRef.current = []

                mediaRecorder.ondataavailable = (event) => {
                    if (event.data.size > 0) {
                        audioChunksRef.current.push(event.data)
                    }
                }

                mediaRecorder.onstop = () => {
                    const audioBlob = new Blob(audioChunksRef.current, { type: mimeType })
                    transcribeAudio(audioBlob)
                    
                    // Cleanup tracks
                    stream.getTracks().forEach(track => track.stop())
                }

                mediaRecorder.start()
                setIsListening(true)
                setWasDictated(true)
            } catch (err) {
                console.error("Microphone access denied", err)
                alert("Could not access microphone. Please check permissions.")
            }
        }
    }

    // --- Gemini API Logic with Full Conversation History ---

    const callGemini = async (prompt: string, images: string[] = [], useDictationModel = false) => {
        if (!apiKey) {
            setMessages((prev) => [
                ...prev,
                {
                    id: Date.now().toString(),
                    role: "model",
                    text: "Please provide a valid Gemini API Key in the properties panel.",
                    isError: true,
                },
            ])
            return
        }

        // Abort any previous request
        if (abortControllerRef.current) {
            abortControllerRef.current.abort()
        }
        abortControllerRef.current = new AbortController()

        setIsTyping(true)
        const responseId = Date.now().toString() + "-model"
        const currentModel = useDictationModel ? dictationModelName : modelName

        setMessages((prev) => [...prev, { id: responseId, role: "model", text: "", isStreaming: true }])

        try {
            // Build conversation history with current prompt
            const userParts: any[] = [{ text: prompt }]
            
            // Add images if present
            if (images.length > 0) {
                images.forEach(img => {
                    userParts.push({
                        inline_data: { mime_type: "image/jpeg", data: img }
                    })
                })
            }

            // Create contents array with full conversation history
            const contents = [
                ...conversationHistory,
                {
                    role: "user",
                    parts: userParts
                }
            ]

            const requestBody: any = {
                contents: contents,
                generationConfig: {
                    temperature: 1.0,
                    topK: 40,
                    topP: 0.95,
                    maxOutputTokens: 8192,
                }
            }

            if (systemInstruction.trim()) {
                requestBody.system_instruction = { parts: [{ text: systemInstruction }] }
            }

            const response = await fetchWithRetry(
                `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:streamGenerateContent?key=${apiKey}&alt=sse`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(requestBody),
                    signal: abortControllerRef.current.signal
                },
                3 // max retries
            )

            if (!response.ok) {
                const errorText = await response.text()
                throw new Error(`API Error ${response.status}: ${errorText}`)
            }

            if (!response.body) throw new Error("No response body")

            const reader = response.body.getReader()
            const decoder = new TextDecoder()
            let accumulatedText = ""

            while (true) {
                const { done, value } = await reader.read()
                if (done) break
                
                const chunk = decoder.decode(value, { stream: true })
                const lines = chunk.split('\n')
                
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const jsonStr = line.slice(6) // Remove "data: "
                            if (jsonStr.trim() === '[DONE]') continue
                            
                            const json = JSON.parse(jsonStr)
                            const text = json.candidates?.[0]?.content?.parts?.[0]?.text
                            
                            if (text) {
                                accumulatedText += text
                                setMessages((prev) =>
                                    prev.map((msg) =>
                                        msg.id === responseId ? { ...msg, text: accumulatedText } : msg
                                    )
                                )
                            }
                        } catch (e) {
                            console.error("Error parsing SSE JSON", e)
                        }
                    }
                }
            }

            // Update conversation history with the complete exchange
            setConversationHistory(prev => [
                ...prev,
                {
                    role: "user",
                    parts: userParts
                },
                {
                    role: "model",
                    parts: [{ text: accumulatedText }]
                }
            ])

            setIsTyping(false)
            setMessages((prev) =>
                prev.map((msg) => (msg.id === responseId ? { ...msg, isStreaming: false } : msg))
            )
            
            abortControllerRef.current = null
        } catch (error: any) {
            console.error("Gemini Error:", error)
            setIsTyping(false)
            
            // Don't show error if request was aborted intentionally
            if (error.name === 'AbortError') {
                setMessages((prev) => prev.filter(msg => msg.id !== responseId))
                return
            }
            
            let errorMessage = `Error connecting to ${currentModel}.`
            
            if (error.message.includes('429')) {
                errorMessage = "Rate limit exceeded. Please wait a moment and try again."
            } else if (error.message.includes('401') || error.message.includes('403')) {
                errorMessage = "Invalid API key. Please check your API key in the properties panel."
            } else if (error.message.includes('500') || error.message.includes('503')) {
                errorMessage = "Gemini service is temporarily unavailable. Please try again."
            }
            
            setMessages((prev) =>
                prev.map((msg) =>
                    msg.id === responseId
                        ? { ...msg, text: errorMessage, isStreaming: false, isError: true }
                        : msg
                )
            )
            
            abortControllerRef.current = null
        }
    }

    const handleSend = () => {
        if (!inputText.trim() && attachedImages.length === 0) return

        const text = inputText
        const imagesToSend = [...attachedImages]
        const fromDictation = wasDictated

        setInputText("")
        setAttachedImages([])
        setWasDictated(false)

        if (view === "home") setView("chat")

        setMessages((prev) => [
            ...prev,
            { id: Date.now().toString() + "-user", role: "user", text: text, images: imagesToSend },
        ])

        callGemini(text || "Analyze this image", imagesToSend, fromDictation)
    }

    const handleSuggestionClick = (prompt: string) => {
        setView("chat")
        setMessages((prev) => [...prev, { id: Date.now().toString() + "-user", role: "user", text: prompt }])
        callGemini(prompt)
    }

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0]
            try {
                const base64 = await fileToBase64(file)
                setAttachedImages((prev) => [...prev, base64])
            } catch (err) {
                console.error("Image upload failed", err)
            }
        }
    }

    const goldGradient = `linear-gradient(135deg, ${accentColorStart}, ${accentColorEnd})`

    return (
        <div
            style={{
                ...style,
                backgroundColor,
                color: textColor,
                borderRadius: 0,
                overflow: "hidden",
                position: "relative",
                display: "flex",
                flexDirection: "column",
                fontFamily: `"Inter", sans-serif`,
            }}
        >
            <style>
                {`
                    .ai-chat-textarea::placeholder {
                        color: ${textColor} !important;
                        opacity: 0.65 !important;
                    }
                `}
            </style>

            <input
                type="file"
                ref={fileInputRef}
                style={{ display: "none" }}
                accept="image/*"
                onChange={handleFileSelect}
            />

            <div
                style={{
                    flex: 1,
                    position: "relative",
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                }}
            >
                {/* HOME VIEW */}
                {view === "home" && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        style={{
                            padding: isMobile ? "96px 16px 164px" : "96px 32px 164px",
                            height: "100%",
                            overflowY: "auto",
                            width: "100%",
                        }}
                    >
                        <div style={{ maxWidth: 1800, margin: "0 auto", width: "100%" }}>
                            <h1
                                style={{
                                    fontSize: isMobile ? 28 : 40,
                                    fontWeight: 600,
                                    marginBottom: 12,
                                    lineHeight: 1.2,
                                }}
                            >
                                {CONTENT.titleStart}{" "}
                                <span
                                    style={{
                                        background: goldGradient,
                                        WebkitBackgroundClip: "text",
                                        WebkitTextFillColor: "transparent",
                                    }}
                                >
                                    {CONTENT.titleHighlight}
                                </span>
                                {CONTENT.titleEnd}
                            </h1>
                            <p style={{ fontSize: isMobile ? 15 : 20, opacity: 0.65, marginBottom: 40, marginTop: 0 }}>
                                {CONTENT.subtitle}
                            </p>

                            <div
                                style={{
                                    display: "grid",
                                    gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(auto-fill, minmax(320px, 1fr))",
                                    gap: isMobile ? 12 : 24,
                                }}
                            >
                                {shuffledSuggestions.map((item) => (
                                    <div
                                        key={item.id}
                                        onClick={() => handleSuggestionClick(item.prompt)}
                                        style={{
                                            aspectRatio: "0.8",
                                            borderRadius: 28,
                                            overflow: "hidden",
                                            position: "relative",
                                            cursor: "pointer",
                                            backgroundColor: "#f0f0f0",
                                        }}
                                    >
                                        <img
                                            src={item.image}
                                            style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                            alt={item.text}
                                        />
                                        <div
                                            style={{
                                                position: "absolute",
                                                inset: 0,
                                                background:
                                                    "linear-gradient(to bottom, transparent 40%, rgba(0,0,0,0.8))",
                                                display: "flex",
                                                alignItems: "flex-end",
                                                padding: 24,
                                            }}
                                        >
                                            <span style={{ color: "white", fontSize: isMobile ? 15 : 21, fontWeight: 500 }}>
                                                {item.text}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </motion.div>
                )}

                {/* CHAT VIEW */}
                {view === "chat" && (
                    <div style={{ display: "flex", height: "100%", width: "100%" }}>
                        <div
                            ref={scrollRef}
                            style={{
                                flex: 1,
                                padding: isMobile ? "70px 16px 160px" : "32px 32px 160px",
                                overflowY: "auto",
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                            }}
                        >
                            {messages.map((msg) => (
                                <motion.div
                                    key={msg.id}
                                    id={`msg-${msg.id}`}
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    style={{
                                        alignSelf: "center",
                                        marginBottom: 24,
                                        width: "100%",
                                        maxWidth: "768px",
                                        display: "flex",
                                        flexDirection: "column",
                                        alignItems: msg.role === "user" ? "flex-end" : "flex-start",
                                    }}
                                >
                                    {msg.role === "user" && msg.images && msg.images.length > 0 && (
                                        <div style={{ marginBottom: 8, display: "flex", gap: 8 }}>
                                            {msg.images.map((img, index) => (
                                                <img
                                                    key={index}
                                                    src={`data:image/jpeg;base64,${img}`}
                                                    style={{
                                                        height: 120,
                                                        borderRadius: 28,
                                                        border: "1px solid rgba(0,0,0,0.1)",
                                                    }}
                                                    alt="Attached"
                                                />
                                            ))}
                                        </div>
                                    )}

                                    {msg.role === "user" ? (
                                        <div
                                            style={{
                                                padding: "16px 20px",
                                                backgroundColor: userBubbleColor,
                                                borderRadius: "28px 28px 4px 28px",
                                                fontSize: 16,
                                                lineHeight: 1.5,
                                            }}
                                        >
                                            {msg.text}
                                        </div>
                                    ) : (
                                        <div
                                            style={{
                                                width: "100%",
                                                padding: "0 4px",
                                                backgroundColor: "transparent",
                                                fontSize: 16,
                                                lineHeight: 1.6,
                                                color: msg.isError ? "#ef4444" : textColor,
                                            }}
                                        >
                                            <MarkdownRenderer content={msg.text} textColor={msg.isError ? "#ef4444" : textColor} linkColor={linkColor} />
                                            {msg.isStreaming && (
                                                <div style={{ marginTop: 8 }}>
                                                    <GoldCursor colorStart={accentColorStart} colorEnd={accentColorEnd} />
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </motion.div>
                            ))}

                            {/* Suggestions at bottom of Chat (Mobile only) */}
                            {messages.length > 0 && isMobile && (
                                <div style={{ marginTop: 40, width: "100%", maxWidth: 768 }}>
                                    <h3 style={{ fontSize: 14, fontWeight: 400, marginBottom: 16, opacity: 0.65 }}>
                                        Suggestions
                                    </h3>
                                    <div
                                        style={{
                                            display: "grid",
                                            gridTemplateColumns: "repeat(2, 1fr)",
                                            gap: 12,
                                        }}
                                    >
                                        {shuffledSuggestions.slice(0, 10).map((item) => (
                                            <div
                                                key={`chat-sugg-${item.id}`}
                                                onClick={() => handleSuggestionClick(item.prompt)}
                                                style={{
                                                    aspectRatio: "0.8",
                                                    borderRadius: 20,
                                                    overflow: "hidden",
                                                    position: "relative",
                                                    cursor: "pointer",
                                                    backgroundColor: "#f0f0f0",
                                                }}
                                            >
                                                <img
                                                    src={item.image}
                                                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                                    alt={item.text}
                                                />
                                                <div
                                                    style={{
                                                        position: "absolute",
                                                        inset: 0,
                                                        background:
                                                            "linear-gradient(to bottom, transparent 30%, rgba(0,0,0,0.7))",
                                                        display: "flex",
                                                        alignItems: "flex-end",
                                                        padding: 16,
                                                    }}
                                                >
                                                    <span style={{ color: "white", fontSize: 14, fontWeight: 500, lineHeight: 1.2 }}>
                                                        {item.text}
                                                    </span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        {showRightSidebar && !isMobile && (
                            <div
                                style={{
                                    width: 360,
                                    padding: "32px 24px",
                                    overflowY: "auto",
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: 16,
                                }}
                            >
                                <h3 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>
                                    For you
                                </h3>
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                                    {shuffledSuggestions.map((item) => (
                                        <div
                                            key={`side-${item.id}`}
                                            onClick={() => handleSuggestionClick(item.prompt)}
                                            style={{
                                                aspectRatio: "0.8",
                                                borderRadius: 28,
                                                overflow: "hidden",
                                                position: "relative",
                                                cursor: "pointer",
                                                backgroundColor: "#f0f0f0",
                                            }}
                                        >
                                            <img
                                                src={item.image}
                                                style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                                alt={item.text}
                                            />
                                            <div
                                                style={{
                                                    position: "absolute",
                                                    inset: 0,
                                                    background: "linear-gradient(to bottom, transparent 20%, rgba(0,0,0,0.7))",
                                                    display: "flex",
                                                    alignItems: "flex-end",
                                                    padding: 12,
                                                }}
                                            >
                                                <span style={{ color: "white", fontSize: 14, fontWeight: 500, lineHeight: 1.2 }}>
                                                    {item.text}
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Input Area */}
            <div
                style={{
                    position: "absolute",
                    bottom: isMobile ? 16 : 24,
                    left: 0,
                    right: showRightSidebar && view === "chat" && !isMobile ? 360 : 0,
                    display: "flex",
                    justifyContent: "center",
                    padding: isMobile ? "0 16px" : "0 24px",
                    pointerEvents: "none",
                }}
            >
                <div
                    style={{
                        width: "100%",
                        maxWidth: 768,
                        borderRadius: 28,
                        padding: 16,
                        position: "relative",
                        pointerEvents: "auto",
                        minHeight: 120,
                        display: "flex",
                        flexDirection: "column",
                        background: userBubbleColor, // Explicitly userBubbleColor
                    }}
                >
                    <div
                        style={{
                            position: "absolute",
                            inset: -2,
                            borderRadius: 30,
                            background: goldGradient,
                            zIndex: -1,
                        }}
                    />

                    <div
                        style={{
                            position: "relative",
                            zIndex: 1,
                            display: "flex",
                            flexDirection: "column",
                            height: "100%",
                        }}
                    >
                        {attachedImages.length > 0 && (
                            <div
                                style={{
                                    display: "flex",
                                    gap: 8,
                                    marginBottom: 8,
                                    overflowX: "auto",
                                    paddingBottom: 4,
                                }}
                            >
                                {attachedImages.map((img, idx) => (
                                    <div key={idx} style={{ position: "relative" }}>
                                        <img
                                            src={`data:image/jpeg;base64,${img}`}
                                            style={{
                                                height: 48,
                                                borderRadius: 8,
                                                border: "1px solid rgba(0,0,0,0.1)",
                                            }}
                                            alt="Preview"
                                        />
                                        <button
                                            onClick={() => setAttachedImages((prev) => prev.filter((_, i) => i !== idx))}
                                            style={{
                                                position: "absolute",
                                                top: -6,
                                                right: -6,
                                                background: "black",
                                                color: "white",
                                                borderRadius: "50%",
                                                width: 18,
                                                height: 18,
                                                fontSize: 12,
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                                border: "none",
                                                cursor: "pointer",
                                            }}
                                        >
                                            ×
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}

                        <textarea
                            ref={textareaRef}
                            className="ai-chat-textarea"
                            value={inputText}
                            onChange={(e) => {
                                setInputText(e.target.value)
                                if (e.target.value.length === 0) setWasDictated(false)
                            }}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault()
                                    handleSend()
                                }
                            }}
                            placeholder={isListening ? "Listening..." : CONTENT.inputPlaceholder}
                            style={{
                                width: "100%",
                                border: "none",
                                outline: "none",
                                resize: "none",
                                fontSize: 16,
                                fontFamily: "inherit",
                                background: "transparent",
                                minHeight: 40,
                                flex: 1,
                                color: textColor,
                            }}
                        />

                        <div
                            style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                marginTop: "auto",
                                paddingTop: 8,
                            }}
                        >
                            {/* Upload Button: 6% Opacity Fill, No Border */}
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                style={{
                                    width: 40,
                                    height: 40,
                                    borderRadius: "28px",
                                    border: "none",
                                    background: hexToRgba(isDarkMode() ? "#FFFFFF" : "#000000", 0.06),
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    cursor: "pointer",
                                    color: textColor,
                                    transition: "background 0.2s",
                                }}
                            >
                                <svg
                                    width="24"
                                    height="24"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                >
                                    <line x1="12" y1="5" x2="12" y2="19"></line>
                                    <line x1="5" y1="12" x2="19" y2="12"></line>
                                </svg>
                            </button>

                            {/* Mic / Send Button */}
                            <button
                                onClick={inputText || attachedImages.length > 0 ? handleSend : toggleDictation}
                                style={{
                                    width: 40,
                                    height: 40,
                                    borderRadius: "50%",
                                    background:
                                        inputText || attachedImages.length > 0
                                            ? accentColorStart
                                            : isListening
                                              ? "#fee2e2"
                                              : hexToRgba(isDarkMode() ? "#FFFFFF" : "#000000", 0.06),
                                    border: "none",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    cursor: "pointer",
                                    transition: "all 0.2s",
                                    color:
                                        inputText || attachedImages.length > 0
                                            ? "white"
                                            : isListening
                                              ? "#ef4444"
                                              : textColor,
                                }}
                            >
                                {inputText || attachedImages.length > 0 ? (
                                    <svg
                                        width="18"
                                        height="18"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="white"
                                        strokeWidth="2.5"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    >
                                        <path d="M12 19V5M5 12l7-7 7 7" />
                                    </svg>
                                ) : (
                                    <svg
                                        width="20"
                                        height="20"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    >
                                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                                        <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                                        <line x1="12" y1="19" x2="12" y2="23"></line>
                                        <line x1="8" y1="23" x2="16" y2="23"></line>
                                    </svg>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

// --- Property Controls ---

addPropertyControls(AIChat, {
    apiKey: {
        type: ControlType.String,
        title: "Gemini API Key",
        placeholder: "Paste API Key Here",
        description: "Get key from aistudio.google.com",
    },
    systemInstruction: {
        type: ControlType.String,
        title: "Instructions",
        placeholder: "You are a helpful therapy assistant...",
        displayTextArea: true,
    },
    modelName: {
        type: ControlType.String,
        title: "Model Name",
        defaultValue: "gemini-2.5-flash-lite",
    },
    dictationModelName: {
        type: ControlType.String,
        title: "Dictation Model",
        defaultValue: "gemini-2.5-flash-lite",
        description: "Model to use for dictation responses",
    },
    // Colors
    backgroundColor: {
        type: ControlType.Color,
        title: "Bg Color",
        defaultValue: "#FFFFFF",
    },
    botBubbleColor: {
        type: ControlType.Color,
        title: "Bubble/Bar",
        defaultValue: "#FFFFFF",
    },
    textColor: {
        type: ControlType.Color,
        title: "Text Color",
        defaultValue: "#000000",
    },
    linkColor: {
        type: ControlType.Color,
        title: "Link Color",
        defaultValue: "#0066CC",
    },
    accentColorStart: {
        type: ControlType.Color,
        title: "Gold Start",
        defaultValue: "#FFC938",
    },
    accentColorEnd: {
        type: ControlType.Color,
        title: "Gold End",
        defaultValue: "#B86914",
    },
    userBubbleColor: {
        type: ControlType.Color,
        title: "User Bubble",
        defaultValue: "#F3F4F6",
    },
    showRightSidebar: {
        type: ControlType.Boolean,
        title: "Sidebar",
        defaultValue: true,
    },
})
